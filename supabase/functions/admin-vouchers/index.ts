/**
 * Admin Vouchers Edge Function — Quiz4Win
 *
 * POST   /admin/vouchers                                    — Create (API #159)
 * GET    /admin/vouchers                                    — List (API #160)
 * GET    /admin/vouchers/:id                               — Detail (API #161)
 * PATCH  /admin/vouchers/:id                               — Update (API #162)
 * PATCH  /admin/vouchers/:id/status                        — Pause/resume (API #163)
 * DELETE /admin/vouchers/:id                               — Cancel (API #164)
 * GET    /admin/vouchers/:id/stats                         — Stats (API #165)
 * GET    /admin/vouchers/:id/redemptions                   — Redemptions (API #166)
 * GET    /admin/vouchers/:id/attempts                      — Attempt log (API #167)
 * POST   /admin/shows/:show_id/announce-voucher            — Announce (API #168)
 * DELETE /admin/shows/:show_id/announce-voucher/:ann_id    — Cancel announcement (API #169)
 * POST   /admin/users/:user_id/issue-voucher               — Issue to user (API #170)
 * GET    /admin/vouchers/:id/redemptions/export            — Redemptions CSV (row 156)
 *
 * Rule compliance: R-01, R-02, R-03, R-05
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const rawPath = url.pathname;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // POST /admin/shows/:show_id/announce-voucher
    const announceMatch = rawPath.match(/\/admin\/shows\/([^/]+)\/announce-voucher$/);
    if (announceMatch && req.method === "POST") {
      const showId = announceMatch[1];
      const { voucher_id, show_duration_sec = 300 } = await req.json();
      if (!voucher_id) return errorResponse("voucher_id is required", 400);

      const expiresAt = new Date(Date.now() + show_duration_sec * 1000).toISOString();
      const { data, error } = await admin.from("voucher_announcements").insert({ voucher_id, game_id: showId, announced_at: new Date().toISOString(), expires_at: expiresAt, is_active: true, announced_by: user.id }).select("id, voucher_id, expires_at").single();
      if (error) return errorResponse(sanitizeError(error), 500);
      // TODO: broadcast via Supabase Realtime + LiveKit data channel
      return successResponse({ announcement: data }, 201);
    }

    // DELETE /admin/shows/:show_id/announce-voucher/:ann_id
    const cancelAnnounceMatch = rawPath.match(/\/admin\/shows\/([^/]+)\/announce-voucher\/([^/]+)$/);
    if (cancelAnnounceMatch && req.method === "DELETE") {
      const annId = cancelAnnounceMatch[2];
      await admin.from("voucher_announcements").update({ is_active: false }).eq("id", annId);
      return successResponse({ message: "Announcement cancelled" });
    }

    // POST /admin/users/:user_id/issue-voucher
    const issueMatch = rawPath.match(/\/admin\/users\/([^/]+)\/issue-voucher$/);
    if (issueMatch && req.method === "POST") {
      const targetUserId = issueMatch[1];
      const { voucher_id, note } = await req.json();
      if (!voucher_id) return errorResponse("voucher_id is required", 400);

      // Look up voucher
      const { data: v } = await admin.from("vouchers").select("id, status, reward_type, reward_amount").eq("id", voucher_id).single();
      if (!v || v.status !== "active") return errorResponse("Voucher not found or not active", 400);

      // Check not already issued
      const { data: existing } = await admin.from("voucher_redemptions").select("id").eq("voucher_id", voucher_id).eq("user_id", targetUserId).single();
      if (existing) return errorResponse("User already has this voucher", 409);

      await admin.from("voucher_redemptions").insert({ voucher_id, user_id: targetUserId, redeemed_at: new Date().toISOString(), reward_type: v.reward_type, reward_amount: v.reward_amount, issued_by_admin: user.id, note: note ?? null });

      if (v.reward_type === "wallet_credit" && v.reward_amount > 0) {
        await admin.rpc("credit_wallet", { p_user_id: targetUserId, p_amount_cents: v.reward_amount, p_reference_id: voucher_id, p_type: "voucher" });
      }

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "voucher_issued_to_user", target_type: "user", target_id: targetUserId, details: { voucher_id, note }, created_at: new Date().toISOString() });
      return successResponse({ message: "Voucher issued to user" }, 201);
    }

    // Admin voucher CRUD — /admin/vouchers[/:id[/action]]
    const parts = rawPath.replace(/^\/admin\/vouchers\/?/, "").split("/").filter(Boolean);
    const voucherId = parts[0] ?? null;
    const vAction = parts[1] ?? null;

    // POST /admin/vouchers — create
    if (!voucherId && req.method === "POST") {
      const body = await req.json();
      if (!body.code || !body.reward_type || !body.reward_amount) return errorResponse("code, reward_type, and reward_amount are required", 400);
      const { data, error } = await admin.from("vouchers").insert({ ...body, code: body.code.toUpperCase(), status: "active", redemption_count: 0, created_by: user.id, created_at: new Date().toISOString() }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ voucher: data }, 201);
    }

    // GET /admin/vouchers — list
    if (!voucherId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const status = url.searchParams.get("status");
      const offset = (page - 1) * limit;
      let query = admin.from("vouchers").select("id, code, status, reward_type, reward_amount, redemption_count, max_redemptions, valid_until, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to list vouchers", 500);
      return successResponse({ vouchers: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/vouchers/:id
    if (voucherId && !vAction && req.method === "GET") {
      const { data, error } = await admin.from("vouchers").select("*").eq("id", voucherId).single();
      if (error || !data) return errorResponse("voucher_not_found", 404);
      return successResponse({ voucher: data });
    }

    // PATCH /admin/vouchers/:id
    if (voucherId && !vAction && req.method === "PATCH") {
      const body = await req.json();
      const { data, error } = await admin.from("vouchers").update({ ...body, updated_at: new Date().toISOString() }).eq("id", voucherId).in("status", ["active", "paused"]).select("*").single();
      if (error || !data) return errorResponse(data ? sanitizeError(error!) : "voucher_not_found_or_cancelled", 400);
      return successResponse({ voucher: data });
    }

    // PATCH /admin/vouchers/:id/status — pause/resume
    if (voucherId && vAction === "status" && req.method === "PATCH") {
      const { status } = await req.json();
      if (!["active", "paused"].includes(status)) return errorResponse("status must be active or paused", 400);
      const { data, error } = await admin.from("vouchers").update({ status, updated_at: new Date().toISOString() }).eq("id", voucherId).not("status", "eq", "cancelled").select("id, status").single();
      if (error || !data) return errorResponse("voucher_not_found_or_cancelled", 404);
      return successResponse({ voucher: data });
    }

    // DELETE /admin/vouchers/:id — cancel (irreversible)
    if (voucherId && !vAction && req.method === "DELETE") {
      await admin.from("vouchers").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", voucherId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "voucher_cancelled", target_type: "voucher", target_id: voucherId, created_at: new Date().toISOString() });
      return successResponse({ message: "Voucher cancelled permanently" });
    }

    // GET /admin/vouchers/:id/stats
    if (voucherId && vAction === "stats" && req.method === "GET") {
      const [vRes, redemptionsRes] = await Promise.all([
        admin.from("vouchers").select("*").eq("id", voucherId).single(),
        admin.from("voucher_redemptions").select("redeemed_at, reward_amount").eq("voucher_id", voucherId),
      ]);
      if (!vRes.data) return errorResponse("voucher_not_found", 404);
      const redemptions = redemptionsRes.data ?? [];
      const totalValue = redemptions.reduce((s: number, r: { reward_amount: number }) => s + (r.reward_amount ?? 0), 0);
      return successResponse({ voucher: vRes.data, stats: { total_redemptions: redemptions.length, total_value_distributed_cents: totalValue } });
    }

    // GET /admin/vouchers/:id/redemptions/export — CSV (row 156)
    const redemptionsExportMatch = rawPath.match(/\/admin\/vouchers\/([^/]+)\/redemptions\/export$/);
    if (redemptionsExportMatch && req.method === "GET") {
      const vId = redemptionsExportMatch[1];
      const { data, error } = await admin.from("voucher_redemptions").select("id, voucher_id, user_id, redeemed_at, reward_type, reward_amount, issued_by_admin, note, profiles!user_id(name, email)").eq("voucher_id", vId).order("redeemed_at", { ascending: false }).limit(50000);
      if (error) return errorResponse("Failed to export redemptions", 500);
      type Row = { id: string; voucher_id: string; user_id: string; redeemed_at: string; reward_type: string; reward_amount: number; issued_by_admin: string | null; note: string | null; profiles: { name: string; email: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "redemption_id", value: (r) => r.id },
        { header: "voucher_id", value: (r) => r.voucher_id },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "reward_type", value: (r) => r.reward_type },
        { header: "reward_amount_cents", value: (r) => r.reward_amount },
        { header: "redeemed_at", value: (r) => r.redeemed_at },
        { header: "issued_by_admin", value: (r) => r.issued_by_admin },
        { header: "note", value: (r) => r.note },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "voucher_redemptions_exported", target_type: "voucher", target_id: vId, details: { count: rows.length }, created_at: new Date().toISOString() });
      return csvResponse(csv, `voucher-${vId}-redemptions-${todayStamp()}.csv`);
    }

    // GET /admin/vouchers/:id/redemptions
    if (voucherId && vAction === "redemptions" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await admin.from("voucher_redemptions").select("*, profiles!user_id(name, email)", { count: "exact" }).eq("voucher_id", voucherId).order("redeemed_at", { ascending: false }).range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to fetch redemptions", 500);
      return successResponse({ redemptions: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/vouchers/:id/attempts
    if (voucherId && vAction === "attempts" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await admin.from("voucher_attempt_log").select("*, profiles!user_id(name, email)", { count: "exact" }).eq("voucher_id", voucherId).order("attempted_at", { ascending: false }).range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to fetch attempt log", 500);
      return successResponse({ attempts: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-vouchers] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
