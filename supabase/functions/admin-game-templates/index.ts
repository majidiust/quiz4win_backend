/**
 * Admin Game Templates Edge Function — Quiz4Win
 *
 * GET    /admin/game-templates                              — List templates
 * GET    /admin/game-templates/:id                          — Template detail
 * POST   /admin/game-templates                              — Create
 * PATCH  /admin/game-templates/:id                          — Update
 * DELETE /admin/game-templates/:id                          — Soft-delete
 * PATCH  /admin/game-templates/:id/activate                 — Set is_active = true
 * PATCH  /admin/game-templates/:id/deactivate               — Set is_active = false
 * POST   /admin/game-templates/:id/generate-now             — Manually trigger creation
 * GET    /admin/game-templates/:id/current-game             — Active game
 * GET    /admin/game-templates/:id/last-game                — Last completed game
 * GET    /admin/game-templates/:id/history                  — Past generated games
 * POST   /admin/game-templates/:id/asset                    — Upload icon/thumbnail/poster
 *
 * Rule compliance: R-01, R-03, R-04 (admin role gate + audit log).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { uploadObject } from "../_shared/s3.ts";

const ASSET_FIELDS = ["icon", "thumbnail_url", "poster_url", "host_avatar_url"] as const;
type AssetField = typeof ASSET_FIELDS[number];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

// Whitelist of columns admin can set via create/update.
const WRITABLE_FIELDS = [
  "name", "description", "icon", "thumbnail_url", "poster_url",
  "cron_expression", "cron_description", "duration_minutes", "start_buffer_seconds",
  "mode", "category", "difficulty", "language", "target_languages",
  "entry_fee", "prize_pool", "prize_pool_currency",
  "max_players", "questions_count", "time_per_question", "allowed_wrong_answers",
  "prize_breakdown", "prize_distribution", "rules", "tags", "is_featured",
  "question_category", "question_difficulty", "question_language",
  "host_id", "host_name", "host_avatar_url", "host_title",
  "enable_streaming",
  "ai_enabled", "ai_avatar_id", "ai_sound_id", "ai_duration", "ai_language",
  "sponsor", "accent_color", "glow_color", "gradient_colors",
] as const;

function pickWritable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE_FIELDS) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  // ai_enabled forces enable_streaming = true server-side (invariant: AI presenter
  // always needs a LiveKit room).
  if (out.ai_enabled === true) out.enable_streaming = true;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/game-templates\/?/, "").split("/").filter(Boolean);
  const id = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/game-templates
    if (!id && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const isActiveParam = url.searchParams.get("is_active");
      const offset = (page - 1) * limit;

      let q = admin.from("game_templates")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (isActiveParam !== null) q = q.eq("is_active", isActiveParam === "true");

      const { data, error, count } = await q;
      if (error) return errorResponse("Failed to list templates", 500);
      return successResponse({
        templates: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    // GET /admin/game-templates/:id
    if (id && !action && req.method === "GET") {
      const { data, error } = await admin.from("game_templates").select("*").eq("id", id).is("deleted_at", null).single();
      if (error || !data) return errorResponse("template_not_found", 404);
      return successResponse({ template: data });
    }

    // POST /admin/game-templates
    if (!id && req.method === "POST") {
      const body = await req.json();
      const required = ["name", "cron_expression", "questions_count"];
      for (const f of required) if (body[f] === undefined) return errorResponse(`${f} is required`, 400);

      const insert = { ...pickWritable(body), created_by: user.id };
      const { data, error } = await admin.from("game_templates").insert(insert).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_created",
        target_type: "game_template", target_id: data.id,
        created_at: new Date().toISOString(),
      });
      return successResponse({ template: data }, 201);
    }

    // PATCH /admin/game-templates/:id
    if (id && !action && req.method === "PATCH") {
      const body = await req.json();
      const update = pickWritable(body);
      if (Object.keys(update).length === 0) return errorResponse("No writable fields supplied", 400);

      const { data, error } = await admin.from("game_templates")
        .update(update).eq("id", id).is("deleted_at", null).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      if (!data) return errorResponse("template_not_found", 404);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_updated",
        target_type: "game_template", target_id: id,
        details: { fields: Object.keys(update) },
        created_at: new Date().toISOString(),
      });
      return successResponse({ template: data });
    }

    // DELETE /admin/game-templates/:id  — soft delete (and deactivate)
    if (id && !action && req.method === "DELETE") {
      const { data, error } = await admin.from("game_templates")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id).is("deleted_at", null).select("id").single();
      if (error || !data) return errorResponse("template_not_found", 404);
      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_deleted",
        target_type: "game_template", target_id: id,
        created_at: new Date().toISOString(),
      });
      return successResponse({ message: "Template deleted" });
    }

    // PATCH /admin/game-templates/:id/activate
    if (id && action === "activate" && req.method === "PATCH") {
      const { data, error } = await admin.from("game_templates")
        .update({ is_active: true }).eq("id", id).is("deleted_at", null).select("id, is_active").single();
      if (error || !data) return errorResponse("template_not_found", 404);

      // Spec §2: immediately create the next upcoming game on activation so
      // users can register in advance. Best-effort — overlap (existing
      // upcoming/open) just returns NULL and does not fail activation.
      let firstGameId: string | null = null;
      const { data: gid, error: genErr } = await admin.rpc("generate_game_from_template", {
        p_template_id: id, p_skip_overlap: false,
      });
      if (genErr) {
        console.warn(`[admin-game-templates] activate: generate failed template=${id}: ${genErr.message ?? genErr}`);
      } else {
        firstGameId = (gid as string | null) ?? null;
      }

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_activated",
        target_type: "game_template", target_id: id,
        details: { first_game_id: firstGameId },
        created_at: new Date().toISOString(),
      });
      return successResponse({ message: "Template activated", is_active: true, first_game_id: firstGameId });
    }

    // PATCH /admin/game-templates/:id/deactivate
    if (id && action === "deactivate" && req.method === "PATCH") {
      const { data, error } = await admin.from("game_templates")
        .update({ is_active: false }).eq("id", id).is("deleted_at", null).select("id, is_active").single();
      if (error || !data) return errorResponse("template_not_found", 404);
      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_deactivated",
        target_type: "game_template", target_id: id,
        created_at: new Date().toISOString(),
      });
      return successResponse({ message: "Template deactivated", is_active: false });
    }

    // POST /admin/game-templates/:id/generate-now
    if (id && action === "generate-now" && req.method === "POST") {
      const { skip_overlap = false } = await req.json().catch(() => ({}));
      const { data: gameId, error } = await admin.rpc("generate_game_from_template", {
        p_template_id: id,
        p_skip_overlap: !!skip_overlap,
      });
      if (error) return errorResponse(sanitizeError(error), 400);
      if (!gameId) return errorResponse("template_already_has_active_game", 409);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_generated_now",
        target_type: "game_template", target_id: id,
        details: { game_id: gameId, skip_overlap: !!skip_overlap },
        created_at: new Date().toISOString(),
      });
      return successResponse({ game_id: gameId }, 201);
    }

    // GET /admin/game-templates/:id/current-game
    if (id && action === "current-game" && req.method === "GET") {
      const { data: tpl } = await admin.from("game_templates").select("current_game_id").eq("id", id).is("deleted_at", null).single();
      if (!tpl) return errorResponse("template_not_found", 404);
      if (!tpl.current_game_id) return successResponse({ game: null });
      const { data: game } = await admin.from("games").select("*").eq("id", tpl.current_game_id).single();
      return successResponse({ game: game ?? null });
    }

    // GET /admin/game-templates/:id/last-game
    if (id && action === "last-game" && req.method === "GET") {
      const { data: tpl } = await admin.from("game_templates").select("last_completed_game_id").eq("id", id).is("deleted_at", null).single();
      if (!tpl) return errorResponse("template_not_found", 404);
      if (!tpl.last_completed_game_id) return successResponse({ game: null });
      const { data: game } = await admin.from("games").select("*").eq("id", tpl.last_completed_game_id).single();
      return successResponse({ game: game ?? null });
    }

    // GET /admin/game-templates/:id/history
    if (id && action === "history" && req.method === "GET") {
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const { data, error } = await admin.from("games")
        .select("id, title, status, scheduled_at, started_at, ended_at, total_participants, created_at")
        .eq("template_id", id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return errorResponse("Failed to fetch history", 500);
      return successResponse({ games: data ?? [] });
    }

    // POST /admin/game-templates/:id/asset — upload icon/thumbnail/poster/host_avatar
    if (id && action === "asset" && req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }
      let formData: FormData;
      try { formData = await req.formData(); }
      catch { return errorResponse("invalid_multipart", 400); }

      const field = String(formData.get("field") ?? "").trim() as AssetField;
      const file = formData.get("file") as File | null;
      if (!ASSET_FIELDS.includes(field)) {
        return errorResponse(`field must be one of: ${ASSET_FIELDS.join(", ")}`, 400);
      }
      if (!file) return errorResponse("file is required", 400);
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return errorResponse("Only JPEG, PNG, WebP, and SVG are allowed", 400);
      }
      if (file.size > MAX_ASSET_BYTES) return errorResponse("File too large (max 10 MB)", 400);

      const { data: tpl } = await admin.from("game_templates").select("id").eq("id", id).is("deleted_at", null).single();
      if (!tpl) return errorResponse("template_not_found", 404);

      const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
      const key = `game-templates/${id}/${field}-${Date.now()}.${ext}`;
      const buf = await file.arrayBuffer();

      let publicUrl: string | null;
      try {
        const result = await uploadObject(key, buf, file.type, "public-read");
        publicUrl = result.publicUrl;
      } catch (err) {
        return errorResponse(sanitizeError(err), 500);
      }
      if (!publicUrl) return errorResponse("upload_failed", 500);

      const { error: updErr } = await admin
        .from("game_templates")
        .update({ [field]: publicUrl })
        .eq("id", id);
      if (updErr) return errorResponse(sanitizeError(updErr), 500);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "game_template_asset_uploaded",
        target_type: "game_template", target_id: id,
        details: { field, key },
        created_at: new Date().toISOString(),
      });
      return successResponse({ field, url: publicUrl });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-game-templates] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
