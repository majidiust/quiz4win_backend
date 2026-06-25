/**
 * Admin AR Backgrounds Edge Function — Quiz4Win
 *
 * GET    /admin/ar-backgrounds        — list all (ordered by sort_order, created_at)
 * POST   /admin/ar-backgrounds        — upload image (multipart: file + name)
 * PATCH  /admin/ar-backgrounds/:id   — update name / is_active / sort_order
 * DELETE /admin/ar-backgrounds/:id   — delete from S3 and DB
 *
 * Rule compliance: R-01, R-03, R-15 (S3 upload via helper, public-read for host display).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { uploadObject, deleteObject } from "../_shared/s3.ts";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/ar-backgrounds\/?/, "").split("/").filter(Boolean);
  const bgId = parts[0] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/ar-backgrounds
    if (!bgId && req.method === "GET") {
      const { data, error } = await admin
        .from("ar_backgrounds")
        .select("id, name, url, s3_key, is_active, sort_order, uploaded_by, created_at, updated_at, admin_users!uploaded_by(name, email)")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) return errorResponse("failed_to_fetch", 500);
      return successResponse({ backgrounds: data ?? [] });
    }

    // POST /admin/ar-backgrounds — upload image
    if (!bgId && req.method === "POST") {
      const ct = req.headers.get("content-type") ?? "";
      if (!ct.includes("multipart/form-data")) return errorResponse("Content-Type must be multipart/form-data", 400);
      let fd: FormData;
      try { fd = await req.formData(); } catch { return errorResponse("invalid_multipart", 400); }

      const file = fd.get("file") as File | null;
      const name = (fd.get("name") as string | null)?.trim();

      if (!file) return errorResponse("file is required", 400);
      if (!name) return errorResponse("name is required", 400);
      if (file.size > MAX_BYTES) return errorResponse("File exceeds 10 MB limit", 413);
      const mimeType = file.type || "image/jpeg";
      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        return errorResponse("Invalid file type. Allowed: JPEG, PNG, WEBP, GIF", 415);
      }

      const rawExt = mimeType.split("/")[1];
      const ext = rawExt === "jpeg" ? "jpg" : rawExt;
      const key = `ar-backgrounds/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const buf = await file.arrayBuffer();
      const result = await uploadObject(key, buf, mimeType, "public-read");

      const { data, error } = await admin.from("ar_backgrounds").insert({
        name, url: result.publicUrl!, s3_key: key,
        is_active: true, sort_order: 0, uploaded_by: user.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select("id, name, url, is_active, sort_order, created_at").single();
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "ar_background_uploaded", target_type: "ar_background",
        target_id: data.id, details: { name, key },
        created_at: new Date().toISOString(),
      });
      return successResponse({ background: data }, 201);
    }

    // PATCH /admin/ar-backgrounds/:id
    if (bgId && req.method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;

      const { data, error } = await admin.from("ar_backgrounds").update(patch).eq("id", bgId)
        .select("id, name, is_active, sort_order").single();
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ background: data });
    }

    // DELETE /admin/ar-backgrounds/:id
    if (bgId && req.method === "DELETE") {
      const { data: row, error: fetchErr } = await admin.from("ar_backgrounds")
        .select("s3_key, name").eq("id", bgId).single();
      if (fetchErr || !row) return errorResponse("Background not found", 404);

      try { await deleteObject(row.s3_key); } catch (e) {
        console.error("[admin-ar-backgrounds] S3 delete failed:", e instanceof Error ? e.message : e);
      }
      const { error } = await admin.from("ar_backgrounds").delete().eq("id", bgId);
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "ar_background_deleted", target_type: "ar_background",
        target_id: bgId, details: { name: row.name },
        created_at: new Date().toISOString(),
      });
      return successResponse({ message: "Background deleted" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-ar-backgrounds] unhandled error:", err instanceof Error ? err.message : err);
    return errorResponse("Internal server error", 500);
  }
});
