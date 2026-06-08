/**
 * Admin Sounds Edge Function — Quiz4Win
 *
 * GET    /admin/sounds        — List all sounds (filter: ?usage=&is_active=)
 * POST   /admin/sounds        — Upload new sound (multipart: file + name + usage)
 * PATCH  /admin/sounds/:id    — Update name / usage / is_active
 * DELETE /admin/sounds/:id    — Delete from S3 and DB
 *
 * Rule compliance: R-01, R-03 (JWT + admin role validated before any operation),
 *                  R-06 (imports only from _shared).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { uploadObject, deleteObject } from "../_shared/s3.ts";

const SOUND_USAGES = [
  "splash", "home", "home_before_start", "register", "game_details",
  "correct_answer", "incorrect_answer", "countdown", "pregame_music",
  "winner", "loser", "announcement", "livestream",
] as const;
type SoundUsage = typeof SOUND_USAGES[number];

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg",
  "audio/aac", "audio/mp4", "audio/x-m4a",
];
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/sounds\/?/, "").split("/").filter(Boolean);
  const soundId = parts[0] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/sounds
    if (!soundId && req.method === "GET") {
      const usage = url.searchParams.get("usage");
      const activeParam = url.searchParams.get("is_active");
      let q = admin
        .from("app_sounds")
        .select("id, name, usage, url, s3_key, mime_type, file_size_bytes, duration_seconds, is_active, uploaded_by, created_at, updated_at, admin_users!uploaded_by(name, email)")
        .order("created_at", { ascending: false });
      if (usage) q = q.eq("usage", usage);
      if (activeParam !== null) q = q.eq("is_active", activeParam === "true");
      const { data, error } = await q;
      if (error) return errorResponse("Failed to fetch sounds", 500);
      return successResponse({ sounds: data ?? [] });
    }

    // POST /admin/sounds — upload new sound
    if (!soundId && req.method === "POST") {
      const ct = req.headers.get("content-type") ?? "";
      if (!ct.includes("multipart/form-data")) return errorResponse("Content-Type must be multipart/form-data", 400);
      let fd: FormData;
      try { fd = await req.formData(); } catch { return errorResponse("invalid_multipart", 400); }

      const file = fd.get("file") as File | null;
      const name = (fd.get("name") as string | null)?.trim();
      const usage = (fd.get("usage") as string | null)?.trim() as SoundUsage | undefined;

      if (!file) return errorResponse("file is required", 400);
      if (!name) return errorResponse("name is required", 400);
      if (!usage || !SOUND_USAGES.includes(usage)) {
        return errorResponse(`usage must be one of: ${SOUND_USAGES.join(", ")}`, 400);
      }
      if (file.size > MAX_BYTES) return errorResponse("File exceeds 50 MB limit", 400);
      const mimeType = file.type || "audio/mpeg";
      if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
        return errorResponse("Invalid file type. Allowed: MP3, WAV, OGG, AAC, M4A", 400);
      }

      const rawExt = mimeType.split("/")[1];
      const ext = rawExt === "mpeg" ? "mp3" : rawExt === "x-m4a" ? "m4a" : rawExt;
      const key = `sounds/${usage}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const buf = await file.arrayBuffer();
      const result = await uploadObject(key, buf, mimeType, "public-read");

      const { data, error } = await admin.from("app_sounds").insert({
        name, usage, url: result.publicUrl!, s3_key: key,
        mime_type: mimeType, file_size_bytes: file.size,
        is_active: true, uploaded_by: user.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select("id, name, usage, url, is_active, created_at").single();
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "sound_uploaded", target_type: "app_sound",
        target_id: data.id, details: { name, usage, key },
        created_at: new Date().toISOString(),
      });
      return successResponse({ sound: data }, 201);
    }

    // PATCH /admin/sounds/:id
    if (soundId && req.method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (typeof body.usage === "string") {
        if (!SOUND_USAGES.includes(body.usage as SoundUsage)) {
          return errorResponse(`usage must be one of: ${SOUND_USAGES.join(", ")}`, 400);
        }
        patch.usage = body.usage;
      }
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

      const { data, error } = await admin.from("app_sounds").update(patch).eq("id", soundId)
        .select("id, name, usage, is_active").single();
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ sound: data });
    }

    // DELETE /admin/sounds/:id
    if (soundId && req.method === "DELETE") {
      const { data: row, error: fetchErr } = await admin.from("app_sounds")
        .select("s3_key, name").eq("id", soundId).single();
      if (fetchErr || !row) return errorResponse("Sound not found", 404);

      try { await deleteObject(row.s3_key); } catch (e) {
        console.error("[admin-sounds] S3 delete failed, continuing:", e instanceof Error ? e.message : e);
      }
      const { error } = await admin.from("app_sounds").delete().eq("id", soundId);
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "sound_deleted", target_type: "app_sound",
        target_id: soundId, details: { name: row.name },
        created_at: new Date().toISOString(),
      });
      return successResponse({ message: "Sound deleted" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-sounds] unhandled error:", err instanceof Error ? err.message : err);
    return errorResponse("Internal server error", 500);
  }
});
