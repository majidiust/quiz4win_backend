/**
 * Admin Config Edge Function — Quiz4Win
 *
 * GET   /admin/config                   — Get all config (API #146)
 * PATCH /admin/config                   — Update config values (API #147)
 * POST  /admin/config/maintenance       — Toggle maintenance mode (API #148)
 * POST  /admin/config/tos               — Publish new ToS version (API #149)
 * POST  /admin/config/help-articles     — Manage help articles (API #150)
 *
 * Rule compliance: R-01, R-03, super_admin only for sensitive actions
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/config\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/config
    if (!path && req.method === "GET") {
      const { data, error } = await admin.from("app_config").select("key, value, description, updated_at").order("key");
      if (error) return errorResponse("Failed to fetch config", 500);
      const config: Record<string, unknown> = {};
      for (const row of (data ?? [])) config[row.key] = row.value;
      return successResponse({ config, raw: data ?? [] });
    }

    // PATCH /admin/config — update key-value pairs
    if (!path && req.method === "PATCH") {
      const body = await req.json();
      if (!body || typeof body !== "object") return errorResponse("Request body must be a JSON object of key:value pairs", 400);

      const updates = Object.entries(body as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }));

      const { error } = await admin.from("app_config").upsert(updates, { onConflict: "key" });
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "config_updated", target_type: "app_config", details: { keys: Object.keys(body) }, created_at: new Date().toISOString() });
      return successResponse({ message: `Updated ${updates.length} config key(s)` });
    }

    // POST /admin/config/maintenance
    if (path === "maintenance" && req.method === "POST") {
      const { enabled, message } = await req.json();
      if (typeof enabled !== "boolean") return errorResponse("enabled (boolean) is required", 400);

      await admin.from("app_config").upsert([
        { key: "maintenance_mode", value: String(enabled), updated_at: new Date().toISOString(), updated_by: user.id },
        ...(message ? [{ key: "maintenance_message", value: message, updated_at: new Date().toISOString(), updated_by: user.id }] : []),
      ], { onConflict: "key" });

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: enabled ? "maintenance_enabled" : "maintenance_disabled", target_type: "app_config", created_at: new Date().toISOString() });
      return successResponse({ message: `Maintenance mode ${enabled ? "enabled" : "disabled"}` });
    }

    // POST /admin/config/tos — publish new ToS version
    if (path === "tos" && req.method === "POST") {
      const { version, content, effective_date } = await req.json();
      if (!version || !content || !effective_date) return errorResponse("version, content, and effective_date are required", 400);

      // Mark all existing versions as not current
      await admin.from("tos_versions").update({ is_current: false }).eq("is_current", true);

      const { data, error } = await admin.from("tos_versions").insert({ version, content, effective_date, is_current: true, created_by: user.id, created_at: new Date().toISOString() }).select("id, version, effective_date").single();
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "tos_published", target_type: "tos_version", target_id: data.id, details: { version }, created_at: new Date().toISOString() });
      return successResponse({ tos: data }, 201);
    }

    // POST /admin/config/help-articles — create or update help article
    if (path === "help-articles" && req.method === "POST") {
      const { id, title, category, content, excerpt, is_published = true, sort_order = 0 } = await req.json();
      if (!title || !content) return errorResponse("title and content are required", 400);

      const payload = { title, category: category ?? "general", content, excerpt: excerpt ?? content.substring(0, 200), is_published, sort_order, updated_at: new Date().toISOString(), updated_by: user.id };

      let data: unknown;
      let error: unknown;

      if (id) {
        const res = await admin.from("help_articles").update(payload).eq("id", id).select("id, title, category, is_published").single();
        data = res.data;
        error = res.error;
      } else {
        const res = await admin.from("help_articles").insert({ ...payload, created_at: new Date().toISOString() }).select("id, title, category, is_published").single();
        data = res.data;
        error = res.error;
      }

      if (error) return errorResponse(sanitizeError(error as Error), 500);
      return successResponse({ article: data }, id ? 200 : 201);
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-config] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
