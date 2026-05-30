"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ----------------------------- STATUS ----------------------------- */

const StatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "suspended", "banned"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

export async function updateUserStatus(
  input: z.infer<typeof StatusSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = StatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { id, status, reason } = parsed.data;
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("profiles")
    .update({
      status,
      suspension_reason: status !== "active" ? (reason ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, message: "Failed to update status" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: `user_status_changed_to_${status}`,
    target_type: "user",
    target_id: id,
    details: { reason },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/users/${id}`);
  revalidatePath("/users");
  return { ok: true, message: `User ${status === "active" ? "reactivated" : status}` };
}

/* ----------------------------- WALLET ----------------------------- */

const WalletSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["credit", "debit"]),
  amount: z.number().positive().max(100_000),
  reason: z.string().trim().min(3).max(500),
});

export async function adjustWallet(
  input: z.infer<typeof WalletSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = WalletSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { id, type, amount, reason } = parsed.data;
  const db = createSupabaseAdminClient();

  // Read current balance first (for debit guard)
  const { data: profile, error: profileErr } = await db
    .from("profiles")
    .select("wallet_balance")
    .eq("id", id)
    .maybeSingle();

  if (profileErr || !profile) return { ok: false, message: "User not found" };

  const currentBalance = parseFloat(String(profile.wallet_balance ?? "0"));
  const delta = type === "credit" ? amount : -amount;
  const newBalance = currentBalance + delta;

  if (newBalance < 0) return { ok: false, message: "Insufficient wallet balance for debit" };

  const { error: updateErr } = await db
    .from("profiles")
    .update({ wallet_balance: newBalance.toFixed(2), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) return { ok: false, message: "Failed to update wallet" };

  // Append-only transaction record (R-05)
  await db.from("transactions").insert({
    user_id: id,
    type: "admin_adjustment",
    amount: amount.toFixed(2),
    status: "completed",
    description: `Admin ${type}: ${reason}`,
    created_at: new Date().toISOString(),
  });

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: `wallet_${type}`,
    target_type: "user",
    target_id: id,
    details: { amount, reason },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/users/${id}`);
  return { ok: true, message: `Wallet ${type} of $${amount.toFixed(2)} applied` };
}

/* ----------------------------- NOTIFY ----------------------------- */

const NotifySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
});

export async function sendNotification(
  input: z.infer<typeof NotifySchema>,
): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = NotifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { id, title, body } = parsed.data;
  const db = createSupabaseAdminClient();
  const { sendFcmToTokens, isFcmConfigured } = await import("@/lib/fcm");

  // Push tokens for this user (may be empty).
  const { data: tokens } = await db.from("push_tokens").select("token").eq("user_id", id);
  const deviceTokens = (tokens ?? []).map((t) => t.token).filter(Boolean);

  let delivered = 0, failed = 0, invalidTokens: string[] = [];
  if (deviceTokens.length > 0 && isFcmConfigured()) {
    try {
      const res = await sendFcmToTokens(deviceTokens, { title, body, data: { type: "system" } });
      delivered = res.delivered; failed = res.failed; invalidTokens = res.invalidTokens;
      if (invalidTokens.length > 0) {
        await db.from("push_tokens").delete().in("token", invalidTokens);
      }
    } catch (err) {
      console.error("[users][notify] fcm error:", (err as Error).message);
    }
  }

  // In-app inbox row (schema column is `read`, type CHECK allows 'system').
  const { error } = await db.from("notifications").insert({
    user_id: id,
    type: "system",
    title,
    body,
    read: false,
    sent_via_push: delivered > 0,
    created_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: `Push sent (${delivered}/${deviceTokens.length}) but inbox insert failed` };

  if (deviceTokens.length === 0) return { ok: true, message: "Inbox notification sent (no push devices registered)" };
  return { ok: true, message: `Notification sent — push delivered to ${delivered}/${deviceTokens.length} devices${failed > 0 ? ` (${failed} failed)` : ""}` };
}
