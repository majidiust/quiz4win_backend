/**
 * Admin Hosts Edge Function — Quiz4Win
 *
 * All routes require an authenticated admin (validateAdminAccess: super_admin /
 * admin / moderator; finance role granted to earnings + payment-method actions).
 *
 * Routes (under /admin/hosts/*):
 *   GET    /admin/hosts                              — list hosts (filterable)
 *   GET    /admin/hosts/:id                          — host detail + counts
 *   POST   /admin/hosts/:id/approve                  — application_status → approved
 *   POST   /admin/hosts/:id/reject                   — application_status → rejected
 *   POST   /admin/hosts/:id/suspend                  — application_status → suspended
 *   POST   /admin/hosts/:id/reactivate               — suspended → approved
 *   GET    /admin/hosts/:id/files                    — list files
 *   POST   /admin/hosts/files/:fileId/approve        — approve file
 *   POST   /admin/hosts/files/:fileId/reject         — reject file
 *   GET    /admin/hosts/requests                     — list game requests
 *   POST   /admin/hosts/requests/:id/approve         — approve (INV-17, assigns host)
 *   POST   /admin/hosts/requests/:id/reject          — reject
 *   GET    /admin/hosts/invitations                  — list invitations
 *   POST   /admin/hosts/invitations                  — send invitation
 *   POST   /admin/hosts/invitations/:id/cancel       — cancel
 *   GET    /admin/hosts/earnings                     — list earnings
 *   POST   /admin/hosts/earnings                     — create pending earning
 *   POST   /admin/hosts/earnings/:id/approve         — INV-16 atomic approve
 *   POST   /admin/hosts/earnings/:id/cancel          — cancel pending
 *   GET    /admin/hosts/payment-methods              — list payment methods
 *   POST   /admin/hosts/payment-methods/:id/verify   — mark active
 *   POST   /admin/hosts/payment-methods/:id/reject   — mark rejected
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateAdminAccess } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { notifyHost, formatAmount } from "../_shared/host_notifications.ts";

const SUB_RESOURCES = new Set(["files", "requests", "invitations", "earnings", "payment-methods"]);
const APP_STATUSES = new Set(["pending", "approved", "rejected", "suspended"]);
const nowIso = () => new Date().toISOString();

// deno-lint-ignore no-explicit-any
type DB = any;

async function audit(db: DB, actorId: string, action: string, targetType: string, targetId: string, details?: unknown) {
  try {
    await db.from("admin_audit_log").insert({
      admin_id: actorId, action, target_type: targetType, target_id: targetId,
      details: details ?? null, created_at: nowIso(),
    });
  } catch (_) { /* audit best-effort */ }
}

// Sets games.host_id only if it is still NULL; returns true iff this call won
// the race. Used by request-approve to defeat double-assignment.
async function claimGameHost(db: DB, gameId: string, hostId: string): Promise<boolean> {
  const { data } = await db.from("games").update({ host_id: hostId, updated_at: nowIso() })
    .eq("id", gameId).is("host_id", null).select("id").maybeSingle();
  return Boolean(data);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const auth = await validateAdminAccess(req, ["super_admin", "admin", "moderator", "finance"]);
  if (!auth.access) return errorResponse(auth.error ?? "Forbidden", auth.status);
  const actorId = auth.access.actorId;

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/hosts\/?/, "").split("/").filter(Boolean);
  const db = getAdminClient();

  try {
    // ── List/detail of host accounts ─────────────────────────────────────────
    if (parts.length === 0 && req.method === "GET") {
      const status = url.searchParams.get("application_status");
      const search = url.searchParams.get("q");
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "25"));
      let q = db.from("show_hosts").select("*", { count: "exact" })
        .order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
      if (status && APP_STATUSES.has(status)) q = q.eq("application_status", status);
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, count, error } = await q;
      if (error) return errorResponse("failed_to_list_hosts", 500);
      return successResponse({ hosts: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // ── Sub-resources (files/requests/invitations/earnings/payment-methods) ──
    if (parts.length > 0 && SUB_RESOURCES.has(parts[0])) {
      return await handleSubResource(req, parts, actorId, db);
    }

    // ── Host-by-id routes ────────────────────────────────────────────────────
    const hostId = parts[0];
    const action = parts[1];

    if (parts.length === 1 && req.method === "GET") {
      const { data: host } = await db.from("show_hosts").select("*").eq("id", hostId).maybeSingle();
      if (!host) return errorResponse("host_not_found", 404);
      const [reqCount, invCount, earnSum, fileCount] = await Promise.all([
        db.from("host_game_requests").select("id", { count: "exact", head: true }).eq("host_id", hostId),
        db.from("host_invitations").select("id", { count: "exact", head: true }).eq("host_id", hostId),
        db.from("host_earnings").select("amount, status").eq("host_id", hostId),
        db.from("host_uploaded_files").select("id", { count: "exact", head: true }).eq("host_id", hostId),
      ]);
      const totals = (earnSum.data ?? []).reduce((a: Record<string, number>, r: { status: string; amount: string | number }) => {
        a[r.status] = (a[r.status] ?? 0) + Number(r.amount ?? 0);
        return a;
      }, {});
      return successResponse({
        host, counts: {
          requests: reqCount.count ?? 0, invitations: invCount.count ?? 0,
          files: fileCount.count ?? 0,
        },
        earnings_totals: totals,
      });
    }

    if (parts.length === 2 && req.method === "POST" &&
        ["approve", "reject", "suspend", "reactivate"].includes(action)) {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      if (action === "approve") {
        patch.application_status = "approved"; patch.approved_at = nowIso();
        patch.approved_by = actorId; patch.status = "active";
        patch.rejection_reason = null; patch.suspension_reason = null;
      } else if (action === "reject") {
        patch.application_status = "rejected"; patch.rejected_at = nowIso();
        patch.rejection_reason = reason; patch.status = "inactive";
      } else if (action === "suspend") {
        patch.application_status = "suspended"; patch.suspended_at = nowIso();
        patch.suspension_reason = reason; patch.status = "inactive";
      } else {
        patch.application_status = "approved"; patch.suspended_at = null;
        patch.suspension_reason = null; patch.status = "active";
      }
      const { data, error } = await db.from("show_hosts").update(patch).eq("id", hostId).select("*").single();
      if (error || !data) return errorResponse("host_not_found", 404);
      await audit(db, actorId, `host_${action}`, "show_host", hostId, { reason });

      const NOTIFY_COPY: Record<string, { title: string; body: string }> = {
        approve:    { title: "Application approved",  body: "Your host application has been approved. You can now request games and accept invitations." },
        reject:     { title: "Application rejected",  body: reason ? `Your application was rejected: ${reason}` : "Your application was rejected. You may re-apply." },
        suspend:    { title: "Account suspended",     body: reason ? `Your host account has been suspended: ${reason}` : "Your host account has been suspended." },
        reactivate: { title: "Account reactivated",   body: "Your host account is active again. Welcome back!" },
      };
      const copy = NOTIFY_COPY[action];
      if (copy) {
        void notifyHost(db, { hostId, type: "host_application", title: copy.title, body: copy.body, data: { action, reason } });
      }
      return successResponse({ host: data });
    }

    if (parts.length === 2 && parts[1] === "files" && req.method === "GET") {
      const { data, error } = await db.from("host_uploaded_files").select("*")
        .eq("host_id", hostId).order("created_at", { ascending: false });
      if (error) return errorResponse("failed_to_list_files", 500);
      return successResponse({ files: data ?? [] });
    }

    return errorResponse("not_found", 404);
  } catch (err) {
    console.error("[admin-hosts] unhandled:", err);
    return errorResponse(sanitizeError(err), 500);
  }
});

async function handleSubResource(req: Request, parts: string[], actorId: string, db: DB): Promise<Response> {
  const resource = parts[0];
  const method = req.method;

  // ── /admin/hosts/files/:id/(approve|reject) ──────────────────────────────
  if (resource === "files" && parts.length === 3 && method === "POST") {
    const fileId = parts[1]; const act = parts[2];
    if (!["approve", "reject"].includes(act)) return errorResponse("invalid_action", 400);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
    const patch: Record<string, unknown> = {
      status: act === "approve" ? "approved" : "rejected",
      reviewed_by: actorId, reviewed_at: nowIso(), updated_at: nowIso(),
      rejection_reason: act === "reject" ? reason : null,
    };
    const { data, error } = await db.from("host_uploaded_files").update(patch).eq("id", fileId).select("*").single();
    if (error || !data) return errorResponse("file_not_found", 404);
    await audit(db, actorId, `host_file_${act}`, "host_uploaded_file", fileId, { reason });
    const fr = data as { host_id: string; file_type: string; url?: string | null };
    // When an avatar file is approved, propagate the URL onto show_hosts so the
    // host's public profile picture updates without a manual PATCH /host/me.
    if (act === "approve" && fr.file_type === "avatar" && fr.url) {
      await db.from("show_hosts").update({ avatar_url: fr.url, updated_at: nowIso() }).eq("id", fr.host_id);
    }
    void notifyHost(db, {
      hostId: fr.host_id,
      type: "host_file",
      title: act === "approve" ? "File approved" : "File rejected",
      body: act === "approve"
        ? `Your ${fr.file_type.replaceAll("_", " ")} file has been approved.`
        : reason ? `Your ${fr.file_type.replaceAll("_", " ")} file was rejected: ${reason}`
                 : `Your ${fr.file_type.replaceAll("_", " ")} file was rejected.`,
      data: { file_id: fileId, file_type: fr.file_type, action: act, reason },
    });
    return successResponse({ file: data });
  }

  // ── /admin/hosts/requests ────────────────────────────────────────────────
  if (resource === "requests") {
    if (parts.length === 1 && method === "GET") {
      const status = new URL(req.url).searchParams.get("status");
      let q = db.from("host_game_requests")
        .select("*, games(id, title, scheduled_at, status), show_hosts!host_id(id, name)")
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return errorResponse("failed_to_list_requests", 500);
      return successResponse({ requests: data ?? [] });
    }
    if (parts.length === 3 && method === "POST") {
      const reqId = parts[1]; const act = parts[2];
      if (!["approve", "reject"].includes(act)) return errorResponse("invalid_action", 400);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const note = typeof body.admin_note === "string" ? body.admin_note.slice(0, 500) : null;
      const { data: r } = await db.from("host_game_requests").select("*").eq("id", reqId).maybeSingle();
      if (!r || r.status !== "pending") return errorResponse("request_not_actionable", 409);
      if (act === "approve") {
        const { data: conflict } = await db.rpc("check_host_schedule_conflict",
          { p_host_id: r.host_id, p_game_id: r.game_id });
        if (conflict === true) return errorResponse("schedule_conflict", 409);
        const claimed = await claimGameHost(db, r.game_id, r.host_id);
        if (!claimed) return errorResponse("game_already_has_host", 409);
        await db.from("host_game_requests").update({ status: "approved", admin_note: note,
          reviewed_by: actorId, reviewed_at: nowIso(), updated_at: nowIso() }).eq("id", reqId);
        // The trg_close_stale_host_offers_on_assign trigger cancels the other
        // pending requests + sent invitations for this game automatically.
      } else {
        await db.from("host_game_requests").update({ status: "rejected", admin_note: note,
          reviewed_by: actorId, reviewed_at: nowIso(), updated_at: nowIso() }).eq("id", reqId);
      }
      await audit(db, actorId, `host_request_${act}`, "host_game_request", reqId, { admin_note: note });
      const { data: game } = await db.from("games").select("title").eq("id", r.game_id).maybeSingle();
      const gameTitle = (game as { title?: string } | null)?.title ?? "the game";
      void notifyHost(db, {
        hostId: r.host_id,
        type: "host_request",
        title: act === "approve" ? "Request approved" : "Request rejected",
        body: act === "approve"
          ? `Your request to host "${gameTitle}" has been approved. The game is now assigned to you.`
          : note ? `Your request to host "${gameTitle}" was rejected: ${note}`
                 : `Your request to host "${gameTitle}" was rejected.`,
        data: { request_id: reqId, game_id: r.game_id, action: act, admin_note: note },
      });
      return successResponse({ ok: true, status: act === "approve" ? "approved" : "rejected" });
    }
  }

  // ── /admin/hosts/invitations ─────────────────────────────────────────────
  if (resource === "invitations") {
    if (parts.length === 1 && method === "GET") {
      const status = new URL(req.url).searchParams.get("status");
      let q = db.from("host_invitations")
        .select("*, games(id, title, scheduled_at, status), show_hosts!host_id(id, name)")
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return errorResponse("failed_to_list_invitations", 500);
      return successResponse({ invitations: data ?? [] });
    }
    if (parts.length === 1 && method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const hostId = body.host_id as string; const gameId = body.game_id as string;
      const message = typeof body.message === "string" ? body.message.slice(0, 1000) : null;
      const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;
      if (!hostId || !gameId) return errorResponse("host_id_and_game_id_required", 400);
      const { data: h } = await db.from("show_hosts").select("application_status").eq("id", hostId).maybeSingle();
      if (!h) return errorResponse("host_not_found", 404);
      if (h.application_status !== "approved") return errorResponse("host_not_approved", 409);
      const { data: g } = await db.from("games").select("id, mode, status, host_id").eq("id", gameId).maybeSingle();
      if (!g) return errorResponse("game_not_found", 404);
      if (g.host_id) return errorResponse("game_already_has_host", 409);
      const { data, error } = await db.from("host_invitations").insert({
        host_id: hostId, game_id: gameId, invited_by: actorId, status: "sent",
        admin_message: message, expires_at: expiresAt,
        created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (error) {
        if ((error.message ?? "").toLowerCase().includes("unique")) return errorResponse("already_invited", 409);
        return errorResponse(sanitizeError(error), 400);
      }
      await audit(db, actorId, "host_invitation_sent", "host_invitation", data.id, { host_id: hostId, game_id: gameId });
      const { data: gm } = await db.from("games").select("title, scheduled_at").eq("id", gameId).maybeSingle();
      const gTitle = (gm as { title?: string } | null)?.title ?? "a game";
      void notifyHost(db, {
        hostId,
        type: "host_invite",
        title: "New invitation",
        body: `You've been invited to host "${gTitle}". Open invitations to accept or reject.`,
        data: { invitation_id: data.id, game_id: gameId, scheduled_at: (gm as { scheduled_at?: string } | null)?.scheduled_at ?? null, message },
      });
      return successResponse({ invitation: data }, 201);
    }
    if (parts.length === 3 && parts[2] === "cancel" && method === "POST") {
      const invId = parts[1];
      const { data: inv } = await db.from("host_invitations").select("status, host_id, game_id").eq("id", invId).maybeSingle();
      if (!inv) return errorResponse("invitation_not_found", 404);
      if (inv.status !== "sent") return errorResponse("only_sent_can_be_cancelled", 409);
      await db.from("host_invitations").update({ status: "cancelled", updated_at: nowIso() }).eq("id", invId);
      await audit(db, actorId, "host_invitation_cancelled", "host_invitation", invId, null);
      void notifyHost(db, {
        hostId: inv.host_id,
        type: "host_invite",
        title: "Invitation cancelled",
        body: "An admin cancelled an invitation that was waiting for your response.",
        data: { invitation_id: invId, game_id: inv.game_id, action: "cancelled" },
      });
      return successResponse({ ok: true });
    }
  }

  // ── /admin/hosts/earnings ────────────────────────────────────────────────
  if (resource === "earnings") {
    if (parts.length === 1 && method === "GET") {
      const status = new URL(req.url).searchParams.get("status");
      const hostId = new URL(req.url).searchParams.get("host_id");
      let q = db.from("host_earnings")
        .select("*, games(id, title, ended_at), show_hosts!host_id(id, name)")
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      if (hostId) q = q.eq("host_id", hostId);
      const { data, error } = await q;
      if (error) return errorResponse("failed_to_list_earnings", 500);
      return successResponse({ earnings: data ?? [] });
    }
    if (parts.length === 1 && method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const hostId = body.host_id as string; const gameId = body.game_id as string;
      const amount = Number(body.amount); const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
      if (!hostId || !gameId || !Number.isFinite(amount) || amount < 0) return errorResponse("invalid_input", 400);
      const { data, error } = await db.from("host_earnings").insert({
        host_id: hostId, game_id: gameId, amount, status: "pending", note,
        created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (error) {
        if ((error.message ?? "").toLowerCase().includes("unique")) return errorResponse("earning_already_exists_for_game", 409);
        return errorResponse(sanitizeError(error), 400);
      }
      await audit(db, actorId, "host_earning_created", "host_earning", data.id, { amount });
      return successResponse({ earning: data }, 201);
    }
    if (parts.length === 3 && parts[2] === "approve" && method === "POST") {
      // INV-16 atomic approve — single SECURITY DEFINER RPC owns the full flow:
      // SELECT FOR UPDATE on host_earnings, INSERT transactions row, debit
      // profiles.wallet_balance, increment show_hosts.total_earnings, and
      // promote host_earnings to approved (with transaction_id). Any failure
      // rolls the entire block back, so partial-credit states cannot happen.
      const id = parts[1];
      const { data: result, error: rpcErr } = await db.rpc("approve_host_earning_atomic",
        { p_earning_id: id, p_admin_id: actorId });
      if (rpcErr) {
        const msg = (rpcErr.message ?? "").toLowerCase();
        if (msg.includes("earning_not_found")) return errorResponse("earning_not_found", 404);
        if (msg.includes("only_pending_can_be_approved")) return errorResponse("only_pending_can_be_approved", 409);
        if (msg.includes("host_has_no_auth_user")) return errorResponse("host_has_no_auth_user", 409);
        return errorResponse(sanitizeError(rpcErr), 500);
      }
      const r = (result ?? {}) as {
        earning_id: string; transaction_id: string; amount: number | string;
        currency: string; host_id: string;
      };
      const { data: updated } = await db.from("host_earnings").select("*").eq("id", id).maybeSingle();
      await audit(db, actorId, "host_earning_approved", "host_earning", id, { transaction_id: r.transaction_id });
      void notifyHost(db, {
        hostId: r.host_id,
        type: "host_earning",
        title: "Earning approved",
        body: `Your earning of ${formatAmount(r.amount, r.currency ?? "USD")} has been approved and added to your wallet.`,
        data: { earning_id: id, transaction_id: r.transaction_id, amount: r.amount, currency: r.currency ?? "USD" },
      });
      return successResponse({ earning: updated, transaction_id: r.transaction_id });
    }
    if (parts.length === 3 && parts[2] === "cancel" && method === "POST") {
      const id = parts[1];
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
      const { data: e } = await db.from("host_earnings").select("status, host_id, amount, currency").eq("id", id).maybeSingle();
      if (!e) return errorResponse("earning_not_found", 404);
      if (e.status !== "pending") return errorResponse("only_pending_can_be_cancelled", 409);
      await db.from("host_earnings").update({
        status: "cancelled", cancelled_reason: reason, updated_at: nowIso(),
      }).eq("id", id);
      await audit(db, actorId, "host_earning_cancelled", "host_earning", id, { reason });
      void notifyHost(db, {
        hostId: e.host_id,
        type: "host_earning",
        title: "Earning cancelled",
        body: reason
          ? `A pending earning of ${formatAmount(e.amount, e.currency ?? "USD")} was cancelled: ${reason}`
          : `A pending earning of ${formatAmount(e.amount, e.currency ?? "USD")} was cancelled.`,
        data: { earning_id: id, reason, amount: e.amount, currency: e.currency ?? "USD" },
      });
      return successResponse({ ok: true });
    }
  }

  // ── /admin/hosts/payment-methods ─────────────────────────────────────────
  if (resource === "payment-methods") {
    if (parts.length === 1 && method === "GET") {
      const hostId = new URL(req.url).searchParams.get("host_id");
      let q = db.from("host_payment_methods").select("*, show_hosts!host_id(id, name)")
        .order("created_at", { ascending: false });
      if (hostId) q = q.eq("host_id", hostId);
      const { data, error } = await q;
      if (error) return errorResponse("failed_to_list_methods", 500);
      return successResponse({ methods: data ?? [] });
    }
    if (parts.length === 3 && method === "POST" && ["verify", "reject"].includes(parts[2])) {
      const id = parts[1]; const act = parts[2];
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
      const patch: Record<string, unknown> = {
        status: act === "verify" ? "active" : "rejected",
        verified_at: act === "verify" ? nowIso() : null,
        verified_by: actorId, rejected_reason: act === "reject" ? reason : null,
        updated_at: nowIso(),
      };
      const { data, error } = await db.from("host_payment_methods").update(patch).eq("id", id).select("*").single();
      if (error || !data) return errorResponse("method_not_found", 404);
      await audit(db, actorId, `host_payment_method_${act}`, "host_payment_method", id, { reason });
      const pm = data as { host_id: string; method_type: string };
      void notifyHost(db, {
        hostId: pm.host_id,
        type: "host_payment_method",
        title: act === "verify" ? "Payment method verified" : "Payment method rejected",
        body: act === "verify"
          ? `Your ${pm.method_type.replaceAll("_", " ")} payout method is now active.`
          : reason ? `Your ${pm.method_type.replaceAll("_", " ")} method was rejected: ${reason}`
                   : `Your ${pm.method_type.replaceAll("_", " ")} method was rejected.`,
        data: { payment_method_id: id, method_type: pm.method_type, action: act, reason },
      });
      return successResponse({ method: data });
    }
  }

  return errorResponse("not_found", 404);
}

export {};
