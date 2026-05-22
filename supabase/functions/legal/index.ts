/**
 * Legal Edge Function — Quiz4Win
 *
 * GET  /legal/tos         — Get Terms of Service (API #50) — public
 * GET  /legal/privacy     — Get Privacy Policy (API #51) — public
 * POST /legal/tos/accept  — Accept current ToS version (API #52) — auth
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/legal\/?/, "");

  const admin = getAdminClient();

  try {
    // GET /legal/tos — public
    if (path === "tos" && req.method === "GET") {
      const { data, error } = await admin
        .from("tos_versions")
        .select("id, version, content, effective_date, created_at")
        .eq("is_current", true)
        .single();

      if (error || !data) {
        return successResponse({
          version: "1.0",
          effective_date: "2026-01-01",
          content: "Terms of Service content will be managed via the admin console.",
        });
      }

      return successResponse({ tos: data });
    }

    // GET /legal/privacy — public
    if (path === "privacy" && req.method === "GET") {
      const { data, error } = await admin
        .from("app_config")
        .select("value")
        .eq("key", "privacy_policy")
        .single();

      if (error || !data) {
        return successResponse({
          version: "1.0",
          effective_date: "2026-01-01",
          content: "Privacy Policy content will be managed via the admin console.",
        });
      }

      return successResponse({ privacy_policy: data.value });
    }

    // POST /legal/tos/accept — auth required
    if (path === "tos/accept" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      // Get current ToS version
      const { data: tos } = await admin
        .from("tos_versions")
        .select("id, version")
        .eq("is_current", true)
        .single();

      if (!tos) return errorResponse("No current ToS version found", 404);

      // Check if already accepted
      const { data: existing } = await admin
        .from("tos_acceptances")
        .select("id")
        .eq("user_id", user.id)
        .eq("tos_version_id", tos.id)
        .single();

      if (existing) {
        return successResponse({ message: "Already accepted", version: tos.version });
      }

      const { error: insertErr } = await admin
        .from("tos_acceptances")
        .insert({
          user_id: user.id,
          tos_version_id: tos.id,
          accepted_at: new Date().toISOString(),
          ip_address: req.headers.get("x-forwarded-for") ?? "unknown",
        });

      if (insertErr) return errorResponse(sanitizeError(insertErr), 500);
      return successResponse({ message: "Terms of Service accepted", version: tos.version }, 201);
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[legal] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
