"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, type AdminRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }
const MOD: AdminRole[] = ["super_admin", "admin", "moderator"];
const FIN: AdminRole[] = ["super_admin", "admin", "finance"];

type DB = ReturnType<typeof createSupabaseAdminClient>;
const nowIso = () => new Date().toISOString();

// Best-effort audit: schema has details JSONB (NOT metadata) + target_type /
// target_id (renamed from entity_*) per migration 20260609000300. Errors are
// swallowed so an admin action does not fail just because the audit row fails.
async function audit(
  db: DB, adminId: string, action: string, targetType: string, targetId: string, details?: unknown,
) {
  try {
    await db.from("admin_audit_log").insert({
      admin_id: adminId, action, target_type: targetType, target_id: targetId,
      details: details ?? null, created_at: nowIso(),
    });
  } catch (e) { console.warn("[hosts] audit failed:", e); }
}

// Conditional UPDATE games SET host_id=... WHERE host_id IS NULL — returns
// true iff this call won the assignment race.
async function claimGameHost(db: DB, gameId: string, hostId: string): Promise<boolean> {
  // Host already opted in by requesting → approval lands them directly in
  // 'accepted' so they can start hosting without a redundant accept step.
  const { data } = await db.from("games")
    .update({ host_id: hostId, host_assignment_status: "accepted", updated_at: nowIso() })
    .eq("id", gameId).is("host_id", null).select("id").maybeSingle();
  return Boolean(data);
}

// ─── listApprovedHosts ───────────────────────────────────────────────────────
// Used by the admin-side game create/edit "pick a host" modal. Returns a
// minimal, RLS-safe projection of approved + active show_hosts. The optional
// `q` parameter does an ILIKE match on the display name.
export interface ApprovedHostRow {
  id: string;
  name: string;
  avatar_url: string | null;
  country: string | null;
  languages: string[] | null;
  shows_hosted: number | null;
}
export async function listApprovedHosts(
  q?: string, limit = 50,
): Promise<{ ok: boolean; hosts: ApprovedHostRow[]; error?: string }> {
  await requireAdmin(MOD);
  const db = createSupabaseAdminClient();
  let query = db.from("show_hosts")
    .select("id, name, avatar_url, country, languages, shows_hosted")
    .eq("application_status", "approved")
    .eq("status", "active")
    .order("shows_hosted", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  const term = q?.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  const { data, error } = await query;
  if (error) {
    console.error("[hosts] listApprovedHosts failed:", error.message);
    return { ok: false, hosts: [], error: error.message };
  }
  return { ok: true, hosts: (data ?? []) as ApprovedHostRow[] };
}

// ─── assignGameHost (used by create/edit-game flows) ─────────────────────────
// Idempotent: setting host_id to the same value is a no-op. Setting to NULL
// clears the assignment (DB trigger trg_close_stale_host_offers_on_assign
// does NOT fire on NOT NULL → NULL; that's by design, those rows stay).
// INV-17 conflict is enforced at the DB via check_host_schedule_conflict.
export async function assignGameHost(input: {
  gameId: string;
  hostId: string | null;
}): Promise<ActionResult> {
  const adm = await requireAdmin(MOD);
  const Schema = z.object({
    gameId: z.string().uuid(),
    hostId: z.string().uuid().nullable(),
  });
  const p = Schema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const { gameId, hostId } = p.data;
  const db = createSupabaseAdminClient();

  if (hostId) {
    // Verify the host is approved/active before claiming.
    const { data: h } = await db.from("show_hosts")
      .select("id, name, application_status, status")
      .eq("id", hostId).maybeSingle();
    if (!h || h.application_status !== "approved" || h.status !== "active") {
      return { ok: false, message: "Host is not approved or active" };
    }
    // INV-17 — overlapping commitment check (excludes self via p_game_id).
    const { data: conflict } = await db.rpc("check_host_schedule_conflict",
      { p_host_id: hostId, p_game_id: gameId });
    if (conflict === true) {
      return { ok: false, message: "Schedule conflict — host has another show in this window" };
    }
    // Take ownership: only set if current host_id is null OR same host.
    const { data: cur } = await db.from("games").select("host_id").eq("id", gameId).maybeSingle();
    if (!cur) return { ok: false, message: "Game not found" };
    if (cur.host_id && cur.host_id !== hostId) {
      return { ok: false, message: "Game already has a different host — unassign first" };
    }
    const { error } = await db.from("games").update({
      host_id: hostId,
      host_name: (h as { name: string }).name,
      // Direct admin assignment → host must accept/reject before going live.
      host_assignment_status: "pending",
      updated_at: nowIso(),
    }).eq("id", gameId);
    if (error) return { ok: false, message: error.message };
    await audit(db, adm.id, "game_host_assigned", "game", gameId, { host_id: hostId });
    await notifyHost(db, hostId, "host_invite",
      "You've been assigned a show",
      `An admin has assigned you as the host of an upcoming show.`,
      { game_id: gameId });
  } else {
    const { error } = await db.from("games").update({
      host_id: null, host_name: null,
      host_assignment_status: "unassigned",
      updated_at: nowIso(),
    }).eq("id", gameId);
    if (error) return { ok: false, message: error.message };
    await audit(db, adm.id, "game_host_unassigned", "game", gameId, {});
  }

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  return { ok: true, message: hostId ? "Host assigned" : "Host unassigned" };
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
  }).eq("id", fileId).select("id, host_id, file_type, url").single();
  if (error || !file) return { ok: false, message: "File not found" };
  // Propagate avatar URL to show_hosts so the host's public picture updates on approval.
  if (action === "approve" && file.file_type === "avatar" && file.url) {
    await db.from("show_hosts").update({ avatar_url: file.url, updated_at: nowIso() }).eq("id", file.host_id);
  }
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
    const claimed = await claimGameHost(db, r.game_id, r.host_id);
    if (!claimed) return { ok: false, message: "Game already has a host" };
    await db.from("host_game_requests").update({
      status: "approved", admin_note: adminNote ?? null,
      reviewed_by: adm.id, reviewed_at: nowIso(), updated_at: nowIso(),
    }).eq("id", requestId);
    // Stale-state cleanup is handled by trg_close_stale_host_offers_on_assign.
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
 * INV-16 atomic approve. Delegates the whole flow to the
 * `approve_host_earning_atomic` SECURITY DEFINER RPC (migration 20260609000300)
 * so the transactions row, the wallet credit, the show_hosts.total_earnings
 * increment and the host_earnings status flip all commit (or roll back)
 * together — partial-credit states are not possible.
 */
export async function approveHostEarning(input: z.infer<typeof EarningIdSchema>): Promise<ActionResult> {
  const adm = await requireAdmin(FIN);
  const p = EarningIdSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = createSupabaseAdminClient();

  const { data: result, error: rpcErr } = await db.rpc("approve_host_earning_atomic",
    { p_earning_id: p.data.earningId, p_admin_id: adm.id });
  if (rpcErr) {
    const msg = (rpcErr.message ?? "").toLowerCase();
    if (msg.includes("earning_not_found")) return { ok: false, message: "Earning not found" };
    if (msg.includes("only_pending_can_be_approved")) return { ok: false, message: "Only pending earnings can be approved" };
    if (msg.includes("host_has_no_auth_user")) return { ok: false, message: "Host has no linked auth user — cannot credit wallet" };
    return { ok: false, message: rpcErr.message ?? "Failed to approve earning" };
  }
  const r = (result ?? {}) as {
    earning_id: string; transaction_id: string; amount: number | string;
    currency: string; host_id: string;
  };

  await audit(db, adm.id, "host_earning_approved", "host_earning", p.data.earningId, { transaction_id: r.transaction_id });
  await notifyHost(db, r.host_id, "host_earning", "Earning approved",
    `Your earning of ${r.amount} ${r.currency ?? "USD"} has been approved and added to your wallet.`,
    { earning_id: p.data.earningId, transaction_id: r.transaction_id, amount: r.amount });

  revalidatePath(`/hosts/${r.host_id}`);
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


