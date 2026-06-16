"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, type AdminRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }
const ALL: AdminRole[] = ["super_admin", "admin", "moderator", "finance"];
const MOD: AdminRole[] = ["super_admin", "admin", "moderator"];
const FIN: AdminRole[] = ["super_admin", "admin", "finance"];

type DB = ReturnType<typeof createSupabaseAdminClient>;
const nowIso = () => new Date().toISOString();

async function audit(
  db: DB, adminId: string, action: string, targetType: string, targetId: string, details?: unknown,
) {
  await db.from("admin_audit_log").insert({
    admin_id: adminId, action, target_type: targetType, target_id: targetId,
    metadata: details ?? null, created_at: nowIso(),
  });
}

async function notifyHost(
  db: DB, hostId: string,
  type: "host_application" | "host_invite" | "host_request" | "host_earning" | "host_payment_method" | "host_file" | "host_stream",
  title: string, body: string, data?: Record<string, unknown> | null,
) {
  try {
    const { data: h } = await db.from("show_hosts").select("auth_user_id").eq("id", hostId).maybeSingle();
    const userId = (h as { auth_user_id?: string | null } | null)?.auth_user_id;
    if (!userId) return;
    await db.from("notifications").insert({
      user_id: userId, type, title: title.slice(0, 200), body: body.slice(0, 2000),
      data: data ?? null, read: false, sent_via_push: false, created_at: nowIso(),
    });
  } catch (e) { console.warn("[hosts] notify failed:", e); }
}

// ─── Host status: approve / reject / suspend / reactivate ────────────────────

const HostActionSchema = z.object({
  hostId: z.string().uuid(),
  action: z.enum(["approve", "reject", "suspend", "reactivate"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function setHostStatus(input: z.infer<typeof HostActionSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const p = HostActionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const { hostId, action, reason } = p.data;
  const db = createSupabaseAdminClient();

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (action === "approve") {
    patch.application_status = "approved"; patch.approved_at = nowIso();
    patch.approved_by = adm.id; patch.status = "active";
    patch.rejection_reason = null; patch.suspension_reason = null;
  } else if (action === "reject") {
    patch.application_status = "rejected"; patch.rejected_at = nowIso();
    patch.rejection_reason = reason ?? null; patch.status = "inactive";
  } else if (action === "suspend") {
    patch.application_status = "suspended"; patch.suspended_at = nowIso();
    patch.suspension_reason = reason ?? null; patch.status = "inactive";
  } else {
    patch.application_status = "approved"; patch.suspended_at = null;
    patch.suspension_reason = null; patch.status = "active";
  }
  const { error } = await db.from("show_hosts").update(patch).eq("id", hostId);
  if (error) return { ok: false, message: "Failed to update host" };
  await audit(db, adm.id, `host_${action}`, "show_host", hostId, { reason });

  const COPY: Record<string, { title: string; body: string }> = {
    approve:    { title: "Application approved",  body: "Your host application has been approved. You can now request games and accept invitations." },
    reject:     { title: "Application rejected",  body: reason ? `Your application was rejected: ${reason}` : "Your application was rejected. You may re-apply." },
    suspend:    { title: "Account suspended",     body: reason ? `Your host account has been suspended: ${reason}` : "Your host account has been suspended." },
    reactivate: { title: "Account reactivated",   body: "Your host account is active again. Welcome back!" },
  };
  await notifyHost(db, hostId, "host_application", COPY[action].title, COPY[action].body, { action, reason });

  revalidatePath(`/hosts/${hostId}`); revalidatePath("/hosts");
  return { ok: true, message: COPY[action].title };
}

// ─── Files review ────────────────────────────────────────────────────────────

const FileActionSchema = z.object({
  fileId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function reviewHostFile(input: z.infer<typeof FileActionSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const p = FileActionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const { fileId, action, reason } = p.data;
  const db = createSupabaseAdminClient();

  const { data: file, error } = await db.from("host_uploaded_files").update({
    status: action === "approve" ? "approved" : "rejected",
    reviewed_by: adm.id, reviewed_at: nowIso(),
    rejection_reason: action === "reject" ? reason ?? null : null,
    updated_at: nowIso(),
  }).eq("id", fileId).select("id, host_id, file_type").single();
  if (error || !file) return { ok: false, message: "File not found" };
  await audit(db, adm.id, `host_file_${action}`, "host_uploaded_file", fileId, { reason });
  await notifyHost(db, file.host_id as string, "host_file",
    action === "approve" ? "File approved" : "File rejected",
    action === "approve"
      ? `Your ${(file.file_type as string).replaceAll("_", " ")} file has been approved.`
      : reason ? `Your file was rejected: ${reason}` : `Your file was rejected.`,
    { file_id: fileId, action, reason });
  revalidatePath(`/hosts/${file.host_id}`);
  return { ok: true, message: action === "approve" ? "File approved" : "File rejected" };
}

// ─── Game request review (INV-17 enforced via RPC) ───────────────────────────

const RequestActionSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  adminNote: z.string().max(500).optional().nullable(),
});

export async function reviewHostRequest(input: z.infer<typeof RequestActionSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const p = RequestActionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const { requestId, action, adminNote } = p.data;
  const db = createSupabaseAdminClient();

  const { data: r } = await db.from("host_game_requests")
    .select("id, host_id, game_id, status").eq("id", requestId).maybeSingle();
  if (!r) return { ok: false, message: "Request not found" };
  if (r.status !== "pending") return { ok: false, message: "Request already actioned" };

  if (action === "approve") {
    const { data: conflict } = await db.rpc("check_host_schedule_conflict",
      { p_host_id: r.host_id, p_game_id: r.game_id });
    if (conflict === true) return { ok: false, message: "Schedule conflict — host has another show in this window" };
    await db.from("host_game_requests").update({
      status: "approved", admin_note: adminNote ?? null,
      reviewed_by: adm.id, reviewed_at: nowIso(), updated_at: nowIso(),
    }).eq("id", requestId);
    await db.from("games").update({ host_id: r.host_id, updated_at: nowIso() }).eq("id", r.game_id);
  } else {
    await db.from("host_game_requests").update({
      status: "rejected", admin_note: adminNote ?? null,
      reviewed_by: adm.id, reviewed_at: nowIso(), updated_at: nowIso(),
    }).eq("id", requestId);
  }
  await audit(db, adm.id, `host_request_${action}`, "host_game_request", requestId, { admin_note: adminNote });

  const { data: g } = await db.from("games").select("title").eq("id", r.game_id).maybeSingle();
  const title = (g as { title?: string } | null)?.title ?? "the game";
  await notifyHost(db, r.host_id as string, "host_request",
    action === "approve" ? "Request approved" : "Request rejected",
    action === "approve"
      ? `Your request to host "${title}" has been approved. The game is now assigned to you.`
      : adminNote ? `Your request to host "${title}" was rejected: ${adminNote}` : `Your request to host "${title}" was rejected.`,
    { request_id: requestId, game_id: r.game_id, action });

  revalidatePath(`/hosts/${r.host_id}`);
  return { ok: true, message: action === "approve" ? "Request approved" : "Request rejected" };
}

// ─── Send / cancel invitation ────────────────────────────────────────────────

const InviteSendSchema = z.object({
  hostId: z.string().uuid(),
  gameId: z.string().uuid(),
  message: z.string().max(1000).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function sendHostInvitation(input: z.infer<typeof InviteSendSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const p = InviteSendSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const { hostId, gameId, message, expiresAt } = p.data;
  const db = createSupabaseAdminClient();

  const { data: h } = await db.from("show_hosts").select("application_status").eq("id", hostId).maybeSingle();
  if (!h) return { ok: false, message: "Host not found" };
  if (h.application_status !== "approved") return { ok: false, message: "Host is not approved" };
  const { data: g } = await db.from("games").select("id, mode, status, host_id, title, scheduled_at").eq("id", gameId).maybeSingle();
  if (!g) return { ok: false, message: "Game not found" };
  if (g.host_id) return { ok: false, message: "Game already has a host" };

  const { data: inv, error } = await db.from("host_invitations").insert({
    host_id: hostId, game_id: gameId, invited_by: adm.id, status: "sent",
    admin_message: message ?? null, expires_at: expiresAt ?? null,
    created_at: nowIso(), updated_at: nowIso(),
  }).select("id").single();
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("unique")) return { ok: false, message: "Host has already been invited to this game" };
    return { ok: false, message: error.message ?? "Failed to send invitation" };
  }
  await audit(db, adm.id, "host_invitation_sent", "host_invitation", inv.id, { host_id: hostId, game_id: gameId });
  await notifyHost(db, hostId, "host_invite",
    "New invitation",
    `You've been invited to host "${g.title}". Open invitations to accept or reject.`,
    { invitation_id: inv.id, game_id: gameId, scheduled_at: g.scheduled_at, message });
  revalidatePath(`/hosts/${hostId}`);
  return { ok: true, message: "Invitation sent" };
}

const InviteCancelSchema = z.object({ invitationId: z.string().uuid() });

export async function cancelHostInvitation(input: z.infer<typeof InviteCancelSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const p = InviteCancelSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();
  const { data: inv } = await db.from("host_invitations").select("status, host_id, game_id").eq("id", p.data.invitationId).maybeSingle();
  if (!inv) return { ok: false, message: "Invitation not found" };
  if (inv.status !== "sent") return { ok: false, message: "Only sent invitations can be cancelled" };
  await db.from("host_invitations").update({ status: "cancelled", updated_at: nowIso() }).eq("id", p.data.invitationId);
  await audit(db, adm.id, "host_invitation_cancelled", "host_invitation", p.data.invitationId, null);
  await notifyHost(db, inv.host_id as string, "host_invite", "Invitation cancelled",
    "An admin cancelled an invitation that was waiting for your response.",
    { invitation_id: p.data.invitationId, game_id: inv.game_id });
  revalidatePath(`/hosts/${inv.host_id}`);
  return { ok: true, message: "Invitation cancelled" };
}

// ─── Earnings — INV-16 atomic approve ────────────────────────────────────────

const EarningCreateSchema = z.object({
  hostId: z.string().uuid(),
  gameId: z.string().uuid(),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().min(3).max(8).default("USD"),
  note: z.string().max(500).optional().nullable(),
});

export async function createHostEarning(input: z.infer<typeof EarningCreateSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(FIN);
  const p = EarningCreateSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("host_earnings").insert({
    host_id: p.data.hostId, game_id: p.data.gameId, amount: p.data.amount,
    currency: p.data.currency, status: "pending", note: p.data.note ?? null,
    created_at: nowIso(), updated_at: nowIso(),
  }).select("id").single();
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("unique"))
      return { ok: false, message: "An earning already exists for this host + game" };
    return { ok: false, message: error.message ?? "Failed to create earning" };
  }
  await audit(db, adm.id, "host_earning_created", "host_earning", data.id, { amount: p.data.amount });
  revalidatePath(`/hosts/${p.data.hostId}`);
  return { ok: true, message: "Pending earning created" };
}

const EarningIdSchema = z.object({
  earningId: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});

/**
 * INV-16 atomic approve. NOT wrapped in a single DB transaction at the JS
 * layer; we mirror the order from the admin-hosts Edge Function:
 *   1. INSERT transactions(type='host_earning', status='completed')
 *   2. CALL increment_wallet_balance RPC
 *   3. UPDATE show_hosts.total_earnings (cumulative)
 *   4. UPDATE host_earnings (status='approved', transaction_id, approved_at)
 * Step (2) failing after (1) is logged so an admin can reconcile manually
 * (R-05 forbids deleting the transactions row).
 */
export async function approveHostEarning(input: z.infer<typeof EarningIdSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(FIN);
  const p = EarningIdSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();

  const { data: e } = await db.from("host_earnings").select("*").eq("id", p.data.earningId).maybeSingle();
  if (!e) return { ok: false, message: "Earning not found" };
  if (e.status !== "pending") return { ok: false, message: "Only pending earnings can be approved" };

  const { data: h } = await db.from("show_hosts").select("auth_user_id, total_earnings").eq("id", e.host_id).maybeSingle();
  if (!h || !h.auth_user_id) return { ok: false, message: "Host has no linked auth user — cannot credit wallet" };

  const { data: tx, error: txErr } = await db.from("transactions").insert({
    user_id: h.auth_user_id, type: "host_earning", amount: e.amount, status: "completed",
    description: `Host earning — game ${e.game_id}`, game_id: e.game_id, admin_id: adm.id,
    created_at: nowIso(),
  }).select("id").single();
  if (txErr || !tx) return { ok: false, message: "Failed to insert transaction" };

  const { error: walletErr } = await db.rpc("increment_wallet_balance",
    { p_user_id: h.auth_user_id, p_amount: e.amount });
  if (walletErr) console.error("[hosts] wallet credit failed after tx insert:", walletErr.message);

  await db.from("show_hosts").update({
    total_earnings: Number(h.total_earnings ?? 0) + Number(e.amount), updated_at: nowIso(),
  }).eq("id", e.host_id);

  await db.from("host_earnings").update({
    status: "approved", transaction_id: tx.id, approved_by: adm.id,
    approved_at: nowIso(), updated_at: nowIso(),
  }).eq("id", p.data.earningId);

  await audit(db, adm.id, "host_earning_approved", "host_earning", p.data.earningId, { transaction_id: tx.id });
  await notifyHost(db, e.host_id as string, "host_earning", "Earning approved",
    `Your earning of ${e.amount} ${e.currency ?? "USD"} has been approved and added to your wallet.`,
    { earning_id: p.data.earningId, transaction_id: tx.id, amount: e.amount });

  revalidatePath(`/hosts/${e.host_id}`);
  return { ok: true, message: "Earning approved and wallet credited" };
}

export async function cancelHostEarning(input: z.infer<typeof EarningIdSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(FIN);
  const p = EarningIdSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();
  const { data: e } = await db.from("host_earnings").select("status, host_id, amount, currency").eq("id", p.data.earningId).maybeSingle();
  if (!e) return { ok: false, message: "Earning not found" };
  if (e.status !== "pending") return { ok: false, message: "Only pending earnings can be cancelled" };
  await db.from("host_earnings").update({
    status: "cancelled", cancelled_reason: p.data.reason ?? null, updated_at: nowIso(),
  }).eq("id", p.data.earningId);
  await audit(db, adm.id, "host_earning_cancelled", "host_earning", p.data.earningId, { reason: p.data.reason });
  await notifyHost(db, e.host_id as string, "host_earning", "Earning cancelled",
    p.data.reason ? `A pending earning of ${e.amount} ${e.currency ?? "USD"} was cancelled: ${p.data.reason}`
                  : `A pending earning of ${e.amount} ${e.currency ?? "USD"} was cancelled.`);
  revalidatePath(`/hosts/${e.host_id}`);
  return { ok: true, message: "Earning cancelled" };
}

// ─── Payment-method verify / reject ──────────────────────────────────────────

const PMActionSchema = z.object({
  methodId: z.string().uuid(),
  action: z.enum(["verify", "reject"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function reviewHostPaymentMethod(input: z.infer<typeof PMActionSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(FIN);
  const p = PMActionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();
  const patch = {
    status: p.data.action === "verify" ? "active" : "rejected",
    verified_at: p.data.action === "verify" ? nowIso() : null,
    verified_by: adm.id,
    rejected_reason: p.data.action === "reject" ? p.data.reason ?? null : null,
    updated_at: nowIso(),
  };
  const { data, error } = await db.from("host_payment_methods").update(patch).eq("id", p.data.methodId).select("id, host_id, method_type").single();
  if (error || !data) return { ok: false, message: "Payment method not found" };
  await audit(db, adm.id, `host_payment_method_${p.data.action}`, "host_payment_method", p.data.methodId, { reason: p.data.reason });
  await notifyHost(db, data.host_id as string, "host_payment_method",
    p.data.action === "verify" ? "Payment method verified" : "Payment method rejected",
    p.data.action === "verify"
      ? `Your ${(data.method_type as string).replaceAll("_", " ")} payout method is now active.`
      : p.data.reason ? `Your method was rejected: ${p.data.reason}` : "Your method was rejected.",
    { payment_method_id: p.data.methodId });
  revalidatePath(`/hosts/${data.host_id}`);
  return { ok: true, message: p.data.action === "verify" ? "Method verified" : "Method rejected" };
}

// Used to silence unused-symbol warnings when admin imports the type set.
export type _AllRoles = typeof ALL;
