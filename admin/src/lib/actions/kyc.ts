"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/s3";

const ReviewSchema = z.object({
  kyc_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  rejection_reason: z.string().trim().min(3).max(500).optional(),
});

export type ReviewKycInput = z.infer<typeof ReviewSchema>;

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Approve or reject a pending KYC submission. Mirrors the
 * POST /admin/users/:id/kyc/review Edge Function: updates the kyc_requests row,
 * syncs profiles.kyc_status, notifies the user, and writes an audit log entry.
 */
export async function reviewKyc(input: ReviewKycInput): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "support"]);
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { kyc_id, decision, rejection_reason } = parsed.data;
  if (decision === "reject" && !rejection_reason) {
    return { ok: false, message: "A rejection reason is required" };
  }

  const db = createSupabaseAdminClient();

  const { data: kyc, error: fetchErr } = await db
    .from("kyc_requests")
    .select("id, user_id, status")
    .eq("id", kyc_id)
    .maybeSingle();
  if (fetchErr) return { ok: false, message: "Failed to load submission" };
  if (!kyc) return { ok: false, message: "Submission not found" };
  if (kyc.status !== "pending") return { ok: false, message: "Submission is no longer pending" };

  const nextStatus = decision === "approve" ? "verified" : "rejected";
  const profileKyc = decision === "approve" ? "verified" : "rejected";
  const now = new Date().toISOString();

  const { error: updErr } = await db
    .from("kyc_requests")
    .update({
      status: nextStatus,
      rejection_reason: decision === "reject" ? (rejection_reason ?? null) : null,
      reviewed_by: admin.id,
      reviewed_at: now,
    })
    .eq("id", kyc_id);
  if (updErr) return { ok: false, message: "Failed to update submission" };

  await db.from("profiles").update({ kyc_status: profileKyc, updated_at: now }).eq("id", kyc.user_id);

  await db.from("notifications").insert({
    user_id: kyc.user_id,
    type: "kyc_update",
    title: decision === "approve" ? "KYC Approved" : "KYC Rejected",
    body:
      decision === "approve"
        ? "Your identity has been verified. You can now request withdrawals."
        : `Your KYC submission was rejected: ${rejection_reason}`,
    is_read: false,
    created_at: now,
  });

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: `kyc_${decision}d`,
    target_type: "user",
    target_id: kyc.user_id,
    details: { kyc_id, rejection_reason: rejection_reason ?? null },
    created_at: now,
  });

  revalidatePath("/kyc");
  revalidatePath(`/kyc/${kyc_id}`);
  revalidatePath(`/users/${kyc.user_id}`);

  return {
    ok: true,
    message: decision === "approve" ? "KYC approved" : "KYC rejected",
  };
}

/**
 * Create a short-lived presigned URL for a private KYC document stored in S3.
 * Returns null when the key is missing or signing fails.
 *
 * The stored value is an S3 object key (e.g. "kyc/<uid>/id_front.jpg") — no
 * leading slash and no host. URL is valid for 10 minutes.
 */
export async function signKycDocumentUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  await requireAdmin(["super_admin", "admin", "support"]);
  try {
    return await presignGet(key, 60 * 10);
  } catch {
    return null;
  }
}
