/**
 * Config Edge Function — Quiz4Win
 *
 * GET /config/app — App config / feature flags (API #55) — public
 *
 * Rule compliance: R-01
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getAdminClient } from "../_shared/supabase.ts";

// Keys safe to expose to the client
const PUBLIC_CONFIG_KEYS = [
  "maintenance_mode",
  "min_app_version_ios",
  "min_app_version_android",
  "feature_live_shows",
  "feature_crypto_topup",
  "feature_referrals",
  "feature_vouchers",
  "max_game_entry_fee",
  "min_withdrawal_amount",
  "supported_currencies",
  "supported_locales",
  "stripe_publishable_key",
  "recaptcha_site_key",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/config\/?/, "");

  try {
    // GET /config/app — public, no auth required
    if (path === "app" && req.method === "GET") {
      const admin = getAdminClient();

      const { data, error } = await admin
        .from("app_config")
        .select("key, value")
        .in("key", PUBLIC_CONFIG_KEYS);

      if (error) {
        // Return safe defaults if DB not reachable
        return successResponse({
          maintenance_mode: false,
          feature_live_shows: true,
          feature_crypto_topup: false,
          feature_referrals: true,
          feature_vouchers: true,
          supported_currencies: ["USD", "EUR", "GBP"],
          supported_locales: ["en", "ar", "fr"],
        });
      }

      // Convert array to key-value object
      const config: Record<string, unknown> = {};
      for (const row of (data ?? [])) {
        // Parse JSON values where applicable
        try {
          config[row.key] = JSON.parse(row.value as string);
        } catch {
          config[row.key] = row.value;
        }
      }

      return successResponse({ config });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[config] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
