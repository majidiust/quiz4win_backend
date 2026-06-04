"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ----------------------------- WITHDRAWALS ----------------------------- */

const ApproveSchema = z.object({ id: z.string().uuid(), note: z.string().trim().max(500).optional() });
const RejectSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) });
const CompleteSchema = z.object({
  id: z.string().uuid(),
  transaction_reference: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
});

async function loadWithdrawal(id: string) {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("withdrawals")
    .select("id, user_id, amount, status, method")
    .eq("id", id)
    .maybeSingle();
  return { db, data, error };
}

export async function approveWithdrawal(input: z.infer<typeof ApproveSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = ApproveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { db, data: w, error } = await loadWithdrawal(parsed.data.id);
  if (error || !w) return { ok: false, message: "Withdrawal not found" };
  if (w.status !== "pending") return { ok: false, message: "Only pending withdrawals can be approved" };

  const now = new Date().toISOString();
  const { error: updErr } = await db
    .from("withdrawals")
    .update({
      status: "processing",
      reviewed_by: admin.id,
      reviewed_at: now,
      internal_note: parsed.data.note ?? null,
    })
    .eq("id", parsed.data.id)
    .eq("status", "pending");
  if (updErr) return { ok: false, message: "Failed to approve" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "withdrawal_approved",
    target_type: "withdrawal",
    target_id: parsed.data.id,
    details: { note: parsed.data.note ?? null },
    created_at: now,
  });
  revalidatePaths(parsed.data.id);
  return { ok: true, message: "Withdrawal moved to processing" };
}

export async function rejectWithdrawal(input: z.infer<typeof RejectSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { db, data: w, error } = await loadWithdrawal(parsed.data.id);
  if (error || !w) return { ok: false, message: "Withdrawal not found" };
  if (!["pending", "processing"].includes(w.status)) {
    return { ok: false, message: "Withdrawal can no longer be rejected" };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await db
    .from("withdrawals")
    .update({
      status: "rejected",
      rejection_reason: parsed.data.reason,
      reviewed_by: admin.id,
      reviewed_at: now,
    })
    .eq("id", parsed.data.id);
  if (updErr) return { ok: false, message: "Failed to reject" };

  // Refund the held amount back to earnings_balance (INV-15: withdrawals debit
  // earnings, so rejections refund to earnings — not wallet).
  const amountStr = String(w.amount);
  const { data: profile } = await db.from("profiles").select("earnings_balance").eq("id", w.user_id).maybeSingle();
  if (profile) {
    const nextBalance = Number.parseFloat(String(profile.earnings_balance ?? "0")) + Number.parseFloat(amountStr);
    await db.from("profiles").update({ earnings_balance: nextBalance.toFixed(2), updated_at: now }).eq("id", w.user_id);
  }
  await db.from("transactions").insert({
    user_id: w.user_id,
    type: "refund",
    amount: amountStr,
    status: "completed",
    description: `Refund to earnings: withdrawal rejected (${parsed.data.reason})`,
    created_at: now,
  });

  await db.from("notifications").insert({
    user_id: w.user_id,
    type: "withdrawal_rejected",
    title: "Withdrawal rejected",
    body: `Your withdrawal request was rejected: ${parsed.data.reason}. The amount has been returned to your earnings balance.`,
    is_read: false,
    created_at: now,
  });

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "withdrawal_rejected",
    target_type: "withdrawal",
    target_id: parsed.data.id,
    details: { reason: parsed.data.reason, refunded_amount: amountStr },
    created_at: now,
  });
  revalidatePaths(parsed.data.id);
  return { ok: true, message: "Withdrawal rejected and refunded" };
}

export async function completeWithdrawal(input: z.infer<typeof CompleteSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = CompleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { db, data: w, error } = await loadWithdrawal(parsed.data.id);
  if (error || !w) return { ok: false, message: "Withdrawal not found" };
  if (w.status !== "processing") return { ok: false, message: "Only processing withdrawals can be marked completed" };

  const now = new Date().toISOString();
  const { error: updErr } = await db
    .from("withdrawals")
    .update({
      status: "completed",
      transaction_reference: parsed.data.transaction_reference,
      internal_note: parsed.data.note ?? null,
      completed_at: now,
    })
    .eq("id", parsed.data.id)
    .eq("status", "processing");
  if (updErr) return { ok: false, message: "Failed to mark completed" };

  await db.from("notifications").insert({
    user_id: w.user_id,
    type: "withdrawal_completed",
    title: "Withdrawal sent",
    body: `Your withdrawal has been processed. Reference: ${parsed.data.transaction_reference}`,
    is_read: false,
    created_at: now,
  });
  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "withdrawal_completed",
    target_type: "withdrawal",
    target_id: parsed.data.id,
    details: { transaction_reference: parsed.data.transaction_reference },
    created_at: now,
  });
  revalidatePaths(parsed.data.id);
  return { ok: true, message: "Withdrawal marked as completed" };
}

function revalidatePaths(id: string) {
  revalidatePath("/finance/withdrawals");
  revalidatePath(`/finance/withdrawals/${id}`);
  revalidatePath("/dashboard");
}

/* ----------------------------- PAYMENTS ------------------------------- */

const ReconcileSchema = z.object({ id: z.string().uuid() });

export async function reconcilePayment(input: z.infer<typeof ReconcileSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = ReconcileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data: p, error } = await db.from("payments").select("id, status").eq("id", parsed.data.id).maybeSingle();
  if (error || !p) return { ok: false, message: "Payment not found" };
  if (p.status === "succeeded") return { ok: false, message: "Payment is already succeeded" };

  // Call the public verify endpoint which re-queries the gateway
  const apiBase = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://api.quiz4win.com";
  try {
    const res = await fetch(`${apiBase}/payments/${parsed.data.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const result = await res.json();
    if (!res.ok) {
      return { ok: false, message: result.error || "Verification failed at gateway" };
    }

    await db.from("admin_audit_log").insert({
      admin_id: admin.id,
      action: "payment_reconciled",
      target_type: "payment",
      target_id: parsed.data.id,
      details: { outcome: result.data?.status },
      created_at: new Date().toISOString(),
    });

    revalidatePath("/finance/payments");
    revalidatePath(`/finance/payments/${parsed.data.id}`);

    if (result.data?.status === "succeeded") {
      return { ok: true, message: "Payment verified and credited successfully" };
    } else {
      return { ok: true, message: `Status confirmed: ${result.data?.status}` };
    }
  } catch (err) {
    console.error("[finance][reconcile] fetch failed:", err);
    return { ok: false, message: "Failed to reach payment gateway" };
  }
}

/* -------------------------------- AML --------------------------------- */

const AmlReviewSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["clear", "escalate"]),
  note: z.string().trim().min(3).max(500),
});

export async function reviewAmlFlag(input: z.infer<typeof AmlReviewSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "finance"]);
  const parsed = AmlReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data: flag } = await db.from("aml_flags").select("id, status").eq("id", parsed.data.id).maybeSingle();
  if (!flag) return { ok: false, message: "Flag not found" };
  if (flag.status !== "open") return { ok: false, message: "Flag has already been reviewed" };

  const nextStatus = parsed.data.decision === "clear" ? "cleared" : "escalated";
  const now = new Date().toISOString();
  const { error } = await db
    .from("aml_flags")
    .update({ status: nextStatus, review_note: parsed.data.note, reviewed_by: admin.id, reviewed_at: now })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, message: "Failed to review flag" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: `aml_flag_${parsed.data.decision}d`,
    target_type: "aml_flag",
    target_id: parsed.data.id,
    details: { note: parsed.data.note },
    created_at: now,
  });
  revalidatePath("/finance/aml");
  return { ok: true, message: parsed.data.decision === "clear" ? "Flag cleared" : "Flag escalated" };
}
