/**
 * Notifications Edge Function — Quiz4Win
 *
 * GET   /notifications                    — List notifications (API #38)
 * PATCH /notifications/read               — Mark read (API #39)
 * PUT   /notifications/preferences        — Update preferences (API #40)
 * POST  /notifications/push-token         — Register push token (API #41)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/notifications\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /notifications — list paginated inbox
    if (!path && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const unreadOnly = url.searchParams.get("unread_only") === "true";
      const offset = (page - 1) * limit;

      // Schema column is `read` (not `is_read`). Alias for the public response.
      let query = supabase
        .from("notifications")
        .select("id, type, title, body, data, is_read:read, sent_via_push, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (unreadOnly) query = query.eq("read", false);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch notifications", 500);

      return successResponse({
        notifications: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    // PATCH /notifications/read — mark one or all as read
    if (path === "read" && req.method === "PATCH") {
      const body = await req.json();
      const notificationId = body.notification_id; // if absent, mark all read
      const admin = getAdminClient();

      if (notificationId) {
        await admin.from("notifications").update({ read: true }).eq("id", notificationId).eq("user_id", user.id);
      } else {
        await admin.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
      }

      return successResponse({ message: notificationId ? "Notification marked as read" : "All notifications marked as read" });
    }

    // PUT /notifications/preferences
    if (path === "preferences" && req.method === "PUT") {
      const prefs = await req.json();
      // Schema columns on public.notification_preferences.
      const allowed = ["game_reminders", "promotions", "kyc_updates", "system"];

      const updateData: Record<string, boolean> = {};
      for (const key of allowed) {
        if (typeof prefs[key] === "boolean") updateData[key] = prefs[key];
      }

      if (Object.keys(updateData).length === 0) {
        return errorResponse("No valid preference fields provided", 400);
      }

      const admin = getAdminClient();
      const { error } = await admin
        .from("notification_preferences")
        .upsert({ user_id: user.id, ...updateData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ message: "Preferences updated", preferences: updateData });
    }

    // POST /notifications/push-token
    // Schema: push_tokens(user_id, token, platform CHECK in ('ios','android'),
    //                     device_id UNIQUE NOT NULL, created_at). No is_active /
    //         updated_at columns; conflict key is device_id, not token.
    if (path === "push-token" && req.method === "POST") {
      const { token, platform, device_id } = await req.json();
      if (!token || !platform || !device_id) {
        return errorResponse("token, platform and device_id are required", 400);
      }

      const validPlatforms = ["ios", "android"];
      if (!validPlatforms.includes(platform)) {
        return errorResponse(`Invalid platform. Supported: ${validPlatforms.join(", ")}`, 400);
      }

      const admin = getAdminClient();
      const { error } = await admin
        .from("push_tokens")
        .upsert({ user_id: user.id, token, platform, device_id }, { onConflict: "device_id" });

      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ message: "Push token registered" }, 201);
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[notifications] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
