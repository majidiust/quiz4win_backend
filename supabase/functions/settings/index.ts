/**
 * Settings Edge Function — Quiz4Win
 *
 * GET   /settings — Get user settings (API #48)
 * PATCH /settings — Update settings (API #49)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

const UPDATABLE_SETTINGS = [
  "language",
  "theme",
  "sound_enabled",
  "haptics_enabled",
  "notifications_enabled",
  "marketing_emails",
  "timezone",
  "currency_display",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/settings\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /settings
    if (!path && req.method === "GET") {
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        // Auto-create default settings row
        const admin = getAdminClient();
        const defaults = {
          user_id: user.id,
          language: "en",
          theme: "system",
          sound_enabled: true,
          haptics_enabled: true,
          notifications_enabled: true,
          marketing_emails: false,
          timezone: "UTC",
          currency_display: "USD",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { data: created, error: createErr } = await admin
          .from("user_settings")
          .upsert(defaults, { onConflict: "user_id" })
          .select("*")
          .single();

        if (createErr) return errorResponse(sanitizeError(createErr), 500);
        return successResponse({ settings: created });
      }

      return successResponse({ settings: data });
    }

    // PATCH /settings — partial update
    if (!path && req.method === "PATCH") {
      const body = await req.json();
      const updates: Record<string, unknown> = {};

      for (const key of UPDATABLE_SETTINGS) {
        if (body[key] !== undefined) {
          updates[key] = body[key];
        }
      }

      if (Object.keys(updates).length === 0) {
        return errorResponse(`No valid settings fields. Updatable: ${UPDATABLE_SETTINGS.join(", ")}`, 400);
      }

      const admin = getAdminClient();
      const { data, error } = await admin
        .from("user_settings")
        .upsert({ user_id: user.id, ...updates, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .select("*")
        .single();

      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ settings: data });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[settings] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
