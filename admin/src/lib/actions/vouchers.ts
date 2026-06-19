"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/admin-auth/email";
import { voucherTemplate } from "@/lib/admin-auth/email-templates";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const VoucherSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  type: z.enum(["promo", "referral", "partner", "free_entry", "reward"]),
  reward_type: z.enum(["wallet_credit", "free_entry", "discount"]).optional(),
  reward_value: z.coerce.number().min(0).optional(),
  reward_description: z.string().trim().min(1).max(500),
  display_text: z.string().trim().min(1).max(500),
  usage_type: z.enum(["single_use_single_user", "multi_user_single_use", "multi_user_multi_use", "unlimited"]).default("multi_user_single_use"),
  max_redemptions: z.coerce.number().int().min(1).optional(),
  per_user_limit: z.coerce.number().int().min(1).optional(),
  valid_from: z.string().datetime({ offset: true }).optional(),
  valid_until: z.string().datetime({ offset: true }).optional(),
  kyc_required: z.boolean().default(false),
  min_wallet_balance_usd: z.coerce.number().min(0).optional(),
  partner_name: z.string().trim().max(200).optional(),
  partner_logo_url: z.string().url().optional(),
  partner_url: z.string().url().optional(),
  is_case_sensitive: z.boolean().default(false),
});

const UpdateVoucherSchema = VoucherSchema.partial().extend({ id: z.string().uuid() });

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createVoucher(input: z.infer<typeof VoucherSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = VoucherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("vouchers").insert({
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
    status: "active",
    redemption_count: 0,
    created_by: admin.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message ?? "Failed to create voucher" };

  revalidatePath("/vouchers");
  return { ok: true, message: "Voucher created" };
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

export async function updateVoucher(input: z.infer<typeof UpdateVoucherSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = UpdateVoucherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { id, ...rest } = parsed.data;
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("vouchers")
    .update({ ...rest, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["active", "paused"]);
  if (error) return { ok: false, message: error.message ?? "Failed to update voucher" };

  revalidatePath(`/vouchers/${id}`);
  revalidatePath("/vouchers");
  return { ok: true, message: "Voucher updated" };
}

/* ------------------------------------------------------------------ */
/* Toggle status (pause / resume)                                      */
/* ------------------------------------------------------------------ */

export async function toggleVoucherStatus(voucherId: string, newStatus: "active" | "paused"): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("vouchers")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", voucherId)
    .not("status", "eq", "cancelled");
  if (error) return { ok: false, message: "Failed to update voucher status" };

  revalidatePath(`/vouchers/${voucherId}`);
  revalidatePath("/vouchers");
  return { ok: true, message: newStatus === "active" ? "Voucher resumed" : "Voucher paused" };
}

/* ------------------------------------------------------------------ */
/* Cancel (irreversible)                                               */
/* ------------------------------------------------------------------ */

export async function cancelVoucher(voucherId: string, reason?: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("vouchers")
    .update({ status: "cancelled", cancellation_reason: reason ?? null, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", voucherId);
  if (error) return { ok: false, message: "Failed to cancel voucher" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "voucher_cancelled",
    target_type: "voucher",
    target_id: voucherId,
    details: { reason },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/vouchers/${voucherId}`);
  revalidatePath("/vouchers");
  return { ok: true, message: "Voucher cancelled permanently" };
}

/* ------------------------------------------------------------------ */
/* Issue voucher to a specific user                                    */
/* ------------------------------------------------------------------ */

const IssueSchema = z.object({
  voucherId: z.string().uuid(),
  userId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  sendEmail: z.boolean().default(true),
});

export async function issueVoucher(input: z.infer<typeof IssueSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = IssueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { voucherId, userId, note, sendEmail: shouldSendEmail } = parsed.data;
  const db = createSupabaseAdminClient();

  const { data: v } = await db.from("vouchers").select("*").eq("id", voucherId).single();
  if (!v || v.status !== "active") return { ok: false, message: "Voucher not found or not active" };

  const { data: userProfile } = await db.from("profiles").select("full_name, email").eq("id", userId).single();
  if (!userProfile) return { ok: false, message: "User not found" };

  const { data: existing } = await db.from("voucher_redemptions").select("id").eq("voucher_id", voucherId).eq("user_id", userId).maybeSingle();
  if (existing) return { ok: false, message: "User already has this voucher" };

  // reward_value is stored in USD dollars (R-02 / credit_wallet contract)
  const rewardUsd = v.reward_value ? Number(v.reward_value) : 0;
  const willApply = v.reward_type === "wallet_credit" && rewardUsd > 0;

  await db.from("voucher_redemptions").insert({
    voucher_id: voucherId,
    user_id: userId,
    redeemed_at: new Date().toISOString(),
    reward_applied: willApply,
    reward_value_applied_usd: willApply ? rewardUsd : null,
    reward_type: v.reward_type ?? null,
    reward_amount: willApply ? rewardUsd : null,
    note: note ?? null,
  });

  if (willApply) {
    // p_amount_cents is a historical misnomer — it takes dollars (see migration 20260619020000)
    await db.rpc("credit_wallet", { p_user_id: userId, p_amount_cents: rewardUsd, p_reference_id: voucherId, p_type: "voucher" });
  }

  if (shouldSendEmail && userProfile.email) {
    const tpl = voucherTemplate({
      name: userProfile.full_name ?? "there",
      voucherCode: v.code,
      voucherName: v.name,
      displayText: v.display_text,
      rewardDescription: v.reward_description,
      validUntil: v.valid_until,
    });
    await sendEmail({
      to: userProfile.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "voucher_issued_to_user",
    target_type: "user",
    target_id: userId,
    details: { voucher_id: voucherId, note },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/vouchers/${voucherId}`);
  return { ok: true, message: "Voucher issued to user" };
}
