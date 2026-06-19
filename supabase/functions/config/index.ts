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
  "feature_host_applications",
  "monetization_mode",
  "coin_usd_rate_micros",
  "coin_name",
  "coin_symbol",
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
          feature_host_applications: true,
          monetization_mode: "usd",
          supported_currencies: ["USD", "EUR", "GBP"],
          supported_locales: ["en", "ar", "fr"],
          livekit_server_url: Deno.env.get("LIVEKIT_SERVER_URL") ?? null,
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

      // Inject the LiveKit server URL from the environment — it is a public
      // WebSocket endpoint the mobile client needs; not a secret (R-01).
      const livekitUrl = Deno.env.get("LIVEKIT_SERVER_URL");
      if (livekitUrl) config["livekit_server_url"] = livekitUrl;

      // Monetization presentation layer (Option A). Always expose the mode;
      // nest coin metadata only in `coin` mode so `none`/`usd` clients get a
      // clean payload. The stored ledger is unaffected — this is display/policy
      // only. The FX rate is integer micro-USD per coin (R-02).
      const monMode = typeof config.monetization_mode === "string" ? config.monetization_mode : "usd";
      const coinName = typeof config.coin_name === "string" ? config.coin_name : "Coins";
      const coinSymbol = typeof config.coin_symbol === "string" ? String(config.coin_symbol) : "C";
      const rateMicros = Number(config.coin_usd_rate_micros ?? 0) || 0;
      delete config.coin_name;
      delete config.coin_symbol;
      delete config.coin_usd_rate_micros;
      config.monetization_mode = monMode;
      if (monMode === "coin") {
        config.coin = {
          name: coinName,
          symbol: coinSymbol,
          usd_rate_micros: rateMicros,
          usd_rate: (rateMicros / 1_000_000).toFixed(6),
        };
      }

      return successResponse({ config });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[config] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
