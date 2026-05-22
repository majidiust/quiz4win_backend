/**
 * Admin Notifications Edge Function — Quiz4Win
 *
 * POST /admin/notifications/broadcast   — Send broadcast (API #129)
 * GET  /admin/notifications/broadcasts  — List broadcasts (API #130)
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

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-notifications] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
