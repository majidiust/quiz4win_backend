/**
 * Monetization helper — Quiz4Win
 *
 * Single source of truth for the admin-controlled monetization presentation
 * layer (Option A). The stored ledger is ALWAYS canonical USD; this module only
 * decides which cash-flows are allowed and how amounts are displayed/entered:
 *
 *   none — withdrawals blocked (App Store / Google Play review-safe: no cash-out)
 *   coin — virtual currency; amounts entered/displayed in coins, converted to
 *          canonical USD at the admin FX rate (micro-USD per coin)
 *   usd  — real money, 1:1 (default / current behaviour)
 *
 * Rule compliance: R-02 — the FX rate is a scaled INTEGER (micro-USD per coin,
 * 1 USD = 1,000,000 micros) and conversions use integer rounding; no floats are
 * persisted in the money path.
 */

export type MonetizationMode = "none" | "coin" | "usd";

export interface MonetizationConfig {
  mode: MonetizationMode;
  rateMicros: number; // micro-USD per 1 coin (1 USD = 1_000_000 micros)
  coinName: string;
  coinSymbol: string;
}

export const USD_MICROS = 1_000_000;

const DEFAULTS: MonetizationConfig = {
  mode: "usd",
  rateMicros: 10_000, // 100 coins = $1.00
  coinName: "Coins",
  coinSymbol: "C",
};

function normalizeMode(v: unknown): MonetizationMode {
  return v === "none" || v === "coin" ? v : "usd";
}

/**
 * Read the monetization config from app_config. Fails open to `usd` defaults on
 * any error so a config/DB hiccup never blocks legitimate withdrawals.
 */
// deno-lint-ignore no-explicit-any
export async function readMonetization(admin: any): Promise<MonetizationConfig> {
  try {
    const { data } = await admin
      .from("app_config")
      .select("key, value")
      .in("key", ["monetization_mode", "coin_usd_rate_micros", "coin_name", "coin_symbol"]);

    const map: Record<string, string> = {};
    for (const row of (data ?? [])) map[row.key as string] = row.value as string;

    const rate = parseInt(map.coin_usd_rate_micros ?? "", 10);
    return {
      mode: normalizeMode(map.monetization_mode),
      rateMicros: Number.isFinite(rate) && rate > 0 ? rate : DEFAULTS.rateMicros,
      coinName: (map.coin_name ?? "").trim() || DEFAULTS.coinName,
      coinSymbol: (map.coin_symbol ?? "").trim() || DEFAULTS.coinSymbol,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Convert a coin amount to canonical USD (number with 2-dp precision) at the
 * given rate. Uses integer rounding (round-half-up) to cents.
 *   usd = round(coins * rateMicros / 10_000) / 100
 */
export function coinsToUsd(coinAmount: number, rateMicros: number): number {
  const cents = Math.round((coinAmount * rateMicros) / (USD_MICROS / 100));
  return cents / 100;
}

/** Inverse of {@link coinsToUsd}: canonical USD → coins (2-dp), for display. */
export function usdToCoins(usd: number, rateMicros: number): number {
  if (rateMicros <= 0) return 0;
  const coins = (usd * USD_MICROS) / rateMicros;
  return Math.round(coins * 100) / 100;
}
