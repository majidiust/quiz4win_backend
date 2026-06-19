"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

const PromoSchema = z.object({
  code: z.string().trim().min(2).max(50),
  campaign_name: z.string().trim().min(1).max(200),
  bonus_amount: z.coerce.number().min(0),
  max_uses: z.coerce.number().int().min(1).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

export async function createPromoCode(input: z.infer<typeof PromoSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = PromoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { code, campaign_name, bonus_amount, max_uses, expires_at } = parsed.data;
  const db = createSupabaseAdminClient();

  // Use the admin's own user ID as owner_id (the FK points to profiles)
  const { error } = await db.from("referral_codes").insert({
    code: code.toUpperCase(),
    owner_id: admin.id,
    type: "promo",
    campaign_name,
    bonus_amount: String(bonus_amount),
    max_uses: max_uses ?? null,
    expires_at: expires_at ?? null,
    use_count: 0,
    created_at: new Date().toISOString(),
  });

  if (error) return { ok: false, message: error.message ?? "Failed to create promo code" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "promo_code_created",
    target_type: "referral_code",
    target_id: code.toUpperCase(),
    details: { campaign_name, bonus_amount, max_uses },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/referrals");
  return { ok: true, message: "Promo code created" };
}

export async function setReferralCodeEligibility(code: string, eligibilityDays: number): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!Number.isInteger(eligibilityDays) || eligibilityDays < 0) {
    return { ok: false, message: "eligibility_days must be a non-negative integer" };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("referral_codes")
    .update({ eligibility_days: eligibilityDays === 0 ? null : eligibilityDays })
    .eq("code", code);

  if (error) return { ok: false, message: "Failed to update eligibility window" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "referral_eligibility_updated",
    target_type: "referral_code",
    target_id: code,
    details: { eligibility_days: eligibilityDays },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/referrals");
  return { ok: true, message: `Eligibility window updated (${eligibilityDays === 0 ? "global default" : `${eligibilityDays} days`})` };
}

export async function disablePromoCode(code: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  // Disable by capping max_uses to current use_count (effectively exhausted)
  const { data: existing } = await db.from("referral_codes").select("use_count").eq("code", code).maybeSingle();
  if (!existing) return { ok: false, message: "Promo code not found" };

  const { error } = await db
    .from("referral_codes")
    .update({ max_uses: existing.use_count, expires_at: new Date().toISOString() })
    .eq("code", code);

  if (error) return { ok: false, message: "Failed to disable promo code" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "promo_code_disabled",
    target_type: "referral_code",
    target_id: code,
    created_at: new Date().toISOString(),
  });

  revalidatePath("/referrals");
  return { ok: true, message: "Promo code disabled" };
}
