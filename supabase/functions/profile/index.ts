/**
 * Profile Edge Function — Quiz4Win
 *
 * GET    /profile          — Get authenticated user profile (API #10)
 * PATCH  /profile          — Update display name / language (API #11)
 * POST   /profile/avatar   — Upload / replace profile picture (API #12)
 * DELETE /profile          — Permanently delete account (API #13)
 *
 * Rule compliance: R-01, R-03 (JWT validated before every operation)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/profile\/?/, "");

  // All endpoints require auth (R-03)
  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /profile
    if (!path && req.method === "GET") {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url, phone, date_of_birth, nationality, language, kyc_status, status, wallet_balance, referral_code, created_at")
        .eq("id", user.id)
        .single();

      if (error || !data) return errorResponse("profile_not_found", 404);
      return successResponse({ user: data });
    }

    // PATCH /profile
    if (!path && req.method === "PATCH") {
      const body = await req.json();
      const allowed: Record<string, unknown> = {};
      if (body.name !== undefined) allowed.name = body.name;
      if (body.language !== undefined) allowed.language = body.language;
      if (body.phone !== undefined) allowed.phone = body.phone;
      if (body.date_of_birth !== undefined) allowed.date_of_birth = body.date_of_birth;
      if (body.nationality !== undefined) allowed.nationality = body.nationality;

      if (Object.keys(allowed).length === 0) {
        return errorResponse("No updatable fields provided", 400);
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({ ...allowed, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("id, name, email, avatar_url, language, updated_at")
        .single();

      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ user: data });
    }

    // POST /profile/avatar
    if (path === "avatar" && req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }

      const formData = await req.formData();
      const file = formData.get("avatar") as File | null;
      if (!file) return errorResponse("avatar file is required", 400);

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        return errorResponse("Only JPEG, PNG, and WebP are allowed", 400);
      }

      const maxBytes = 5 * 1024 * 1024; // 5 MB
      if (file.size > maxBytes) return errorResponse("File too large (max 5 MB)", 400);

      const ext = file.type.split("/")[1];
      const filePath = `avatars/${user.id}/avatar.${ext}`;
      const arrayBuffer = await file.arrayBuffer();

      const admin = getAdminClient();
      const { error: uploadErr } = await admin.storage
        .from("user-avatars")
        .upload(filePath, arrayBuffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadErr) return errorResponse(sanitizeError(uploadErr), 500);

      const { data: { publicUrl } } = admin.storage
        .from("user-avatars")
        .getPublicUrl(filePath);

      await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id);

      return successResponse({ avatar_url: publicUrl });
    }

    // DELETE /profile
    if (!path && req.method === "DELETE") {
      const admin = getAdminClient();

      // Soft-delete: set status to 'deleted', anonymize PII
      await admin.from("profiles").update({
        status: "deleted",
        name: "[deleted]",
        email: null,
        phone: null,
        avatar_url: null,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);

      // Hard-delete from Supabase Auth (removes login capability)
      await admin.auth.admin.deleteUser(user.id);

      return successResponse({ message: "Account deleted" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[profile] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
