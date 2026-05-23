/**
 * Admin Notifications Edge Function — Quiz4Win
 *
 * POST   /admin/notifications/broadcast                — Send broadcast (API #129)
 * GET    /admin/notifications/broadcasts                — List broadcasts (API #130)
 * GET    /admin/notifications/broadcasts/:id            — Broadcast detail (row 157)
 * DELETE /admin/notifications/broadcasts/:id            — Cancel scheduled (row 158)
 * GET    /admin/notifications/broadcasts/:id/recipients — Per-user delivery (row 159)
 * GET    /admin/notifications                           — Admin alert inbox (row 173)
 * PATCH  /admin/notifications/:id/read                 — Mark alert read (row 174)
 * GET    /admin/notifications/thresholds               — Alert threshold config (row 175)
 * PATCH  /admin/notifications/thresholds               — Update threshold config (row 175)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/notifications\/?/, "");
  const pathParts = path.split("/").filter(Boolean);

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // POST /admin/notifications/broadcast
    if (path === "broadcast" && req.method === "POST") {
      const { title, body, type = "broadcast", segment, push_enabled = false } = await req.json();
      if (!title || !body) return errorResponse("title and body are required", 400);

      // Fetch target users (all or by segment)
      let userQuery = admin.from("profiles").select("id");
      if (segment?.status) userQuery = userQuery.eq("status", segment.status);
      if (segment?.kyc_status) userQuery = userQuery.eq("kyc_status", segment.kyc_status);

      const { data: users, error: usersErr } = await userQuery;
      if (usersErr) return errorResponse("Failed to fetch target users", 500);

      // Record broadcast
      const { data: broadcast, error: bcErr } = await admin
        .from("notification_broadcasts")
        .insert({ title, body, type, segment: segment ?? null, recipient_count: users?.length ?? 0, push_enabled, sent_by: user.id, sent_at: new Date().toISOString() })
        .select("id, title, recipient_count, sent_at")
        .single();

      if (bcErr) return errorResponse(sanitizeError(bcErr), 500);

      // Batch-insert in-app notifications (max 1000 per call to avoid timeout)
      const batchSize = 1000;
      const rows = (users ?? []).map((u: { id: string }) => ({
        user_id: u.id,
        type,
        title,
        body,
        is_read: false,
        created_at: new Date().toISOString(),
      }));

      for (let i = 0; i < rows.length; i += batchSize) {
        await admin.from("notifications").insert(rows.slice(i, i + batchSize));
      }

      // TODO: If push_enabled, enqueue push notifications via FCM/APNs
      return successResponse({ broadcast, message: `Broadcast sent to ${rows.length} users` }, 201);
    }

    // GET /admin/notifications/broadcasts
    if (path === "broadcasts" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;

      const { data, error, count } = await admin
        .from("notification_broadcasts")
        .select("id, title, body, type, recipient_count, push_enabled, sent_at, admin_users!sent_by(name, email)", { count: "exact" })
        .order("sent_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to list broadcasts", 500);
      return successResponse({ broadcasts: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/notifications/broadcasts/:id — detail (row 157)
    if (pathParts[0] === "broadcasts" && pathParts[1] && !pathParts[2] && req.method === "GET") {
      const broadcastId = pathParts[1];
      const { data: broadcast, error } = await admin.from("notification_broadcasts").select("*, admin_users!sent_by(name, email)").eq("id", broadcastId).single();
      if (error || !broadcast) return errorResponse("broadcast_not_found", 404);

      // Delivery counts derived from notifications table by matching title/body/created_at proximity
      const [delivered, read] = await Promise.all([
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("title", broadcast.title).eq("type", broadcast.type).gte("created_at", broadcast.sent_at),
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("title", broadcast.title).eq("type", broadcast.type).gte("created_at", broadcast.sent_at).eq("is_read", true),
      ]);
      return successResponse({
        broadcast,
        stats: {
          recipients: broadcast.recipient_count ?? 0,
          delivered: delivered.count ?? 0,
          read: read.count ?? 0,
          failed: Math.max(0, (broadcast.recipient_count ?? 0) - (delivered.count ?? 0)),
        },
      });
    }

    // DELETE /admin/notifications/broadcasts/:id — cancel scheduled (row 158)
    if (pathParts[0] === "broadcasts" && pathParts[1] && !pathParts[2] && req.method === "DELETE") {
      const broadcastId = pathParts[1];
      const { data: bc } = await admin.from("notification_broadcasts").select("id, scheduled_at, sent_at, status").eq("id", broadcastId).single();
      if (!bc) return errorResponse("broadcast_not_found", 404);
      if (bc.status === "sent" || bc.sent_at) return errorResponse("Cannot cancel: broadcast already sent", 400);

      await admin.from("notification_broadcasts").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: user.id }).eq("id", broadcastId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "broadcast_cancelled", target_type: "notification_broadcast", target_id: broadcastId, created_at: new Date().toISOString() });
      return successResponse({ message: "Scheduled broadcast cancelled" });
    }

    // GET /admin/notifications/broadcasts/:id/recipients — per-user delivery (row 159)
    if (pathParts[0] === "broadcasts" && pathParts[1] && pathParts[2] === "recipients" && req.method === "GET") {
      const broadcastId = pathParts[1];
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "100"));
      const offset = (page - 1) * limit;

      const { data: bc } = await admin.from("notification_broadcasts").select("title, type, sent_at").eq("id", broadcastId).single();
      if (!bc) return errorResponse("broadcast_not_found", 404);

      const { data, error, count } = await admin
        .from("notifications")
        .select("user_id, is_read, read_at, created_at, profiles!user_id(name, email)", { count: "exact" })
        .eq("title", bc.title)
        .eq("type", bc.type)
        .gte("created_at", bc.sent_at ?? new Date(0).toISOString())
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to fetch recipients", 500);
      return successResponse({ recipients: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/notifications — admin alert inbox (row 173)
    if (!path && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;
      const unreadOnly = url.searchParams.get("unread") === "true";
      let q = admin.from("admin_alerts").select("id, type, title, message, severity, is_read, read_at, created_at, metadata", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (unreadOnly) q = q.eq("is_read", false);
      const { data, error, count } = await q;
      if (error) {
        // Table may not exist yet — return empty gracefully
        return successResponse({ alerts: [], pagination: { page, limit, total: 0 }, note: "admin_alerts table not yet created" });
      }
      return successResponse({ alerts: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // PATCH /admin/notifications/:id/read — mark alert read (row 174)
    if (pathParts[0] && pathParts[1] === "read" && req.method === "PATCH") {
      const alertId = pathParts[0];
      const { error } = await admin.from("admin_alerts").update({ is_read: true, read_at: new Date().toISOString(), read_by: user.id }).eq("id", alertId);
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ message: "Alert marked as read" });
    }

    // GET /admin/notifications/thresholds — alert threshold config (row 175)
    if (path === "thresholds" && req.method === "GET") {
      const { data, error } = await admin.from("app_config").select("value").eq("key", "admin_alert_thresholds").maybeSingle();
      if (error) return errorResponse("Failed to fetch thresholds", 500);
      const defaults = { pending_withdrawals_alert: 50, aml_flags_alert: 10, open_tickets_alert: 100, failed_payments_rate_pct: 5 };
      const config = data?.value ? { ...defaults, ...JSON.parse(data.value) } : defaults;
      return successResponse({ thresholds: config });
    }

    // PATCH /admin/notifications/thresholds — update (row 175)
    if (path === "thresholds" && req.method === "PATCH") {
      const updates = await req.json();
      const { data: existing } = await admin.from("app_config").select("value").eq("key", "admin_alert_thresholds").maybeSingle();
      const current = existing?.value ? JSON.parse(existing.value) : {};
      const merged = { ...current, ...updates };
      await admin.from("app_config").upsert({ key: "admin_alert_thresholds", value: JSON.stringify(merged), updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
      return successResponse({ thresholds: merged });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-notifications] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
