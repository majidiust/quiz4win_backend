/**
 * Centralised IP rate limiter for Quiz4Win Edge Functions (R-17).
 *
 * Redis-backed fixed-window counter. Applied once in the `_server.ts`
 * dispatcher so EVERY API route is covered by default — there is no
 * per-function wiring to forget. Abuse-sensitive write endpoints keep their
 * own stricter SECURITY DEFINER RPC limiters (e.g. host-applications,
 * early-birds) as a second, longer-window layer of defence.
 *
 * Algorithm: atomic INCR + EXPIRE-on-first-hit Lua script. The first request
 * in a window sets the key TTL; subsequent requests only INCR. When the TTL
 * lapses the key disappears and the window resets. This is race-free under
 * concurrency because INCR/EXPIRE run inside a single Redis EVAL.
 *
 * Fail-open: if Redis is unreachable the limiter ALLOWS the request rather
 * than blocking legitimate traffic on an infra hiccup (matches the existing
 * `public-early-birds` rate-limit posture).
 *
 * Rule compliance:
 *   R-01: never logs the client IP value or the Redis URL.
 *   R-04/R-14: no database access — Redis only.
 */

import { evalScript, getRedis } from "./redis.ts";

export interface RateLimitRule {
  /** Max requests allowed per IP within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Seconds until the current window resets (Retry-After on a 429). */
  resetSec: number;
}

// ─── Tiers ───────────────────────────────────────────────────────────────────
// Tuned per route-class. Windows are 60s so limits read as "requests/minute".
const TIERS = {
  /** Login / abuse-prone unauthenticated writes (brute-force surface). */
  strict:   { limit: 20,  windowSec: 60 },
  /** Unauthenticated public read APIs (`public-*`). */
  public:   { limit: 60,  windowSec: 60 },
  /** Authenticated end-user APIs (wallet, profile, host, …). */
  default:  { limit: 120, windowSec: 60 },
  /** Admin panel APIs (`admin-*`) — authenticated staff, bulk operations. */
  admin:    { limit: 300, windowSec: 60 },
  /** Realtime gameplay — high request rate during a live show. */
  realtime: { limit: 600, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

// Explicit per-service overrides. Anything not listed falls back to the
// prefix rules in `resolveRule` (admin-* → admin, public-* → public, else default).
const SERVICE_TIER: Record<string, keyof typeof TIERS> = {
  "auth": "strict",
  "public-host-applications": "strict",
  "public-early-birds": "strict",
  "game-session": "realtime",
  "games": "realtime",
};

/** Resolve the limit rule for a resolved service name. */
export function resolveRule(service: string): RateLimitRule {
  const explicit = SERVICE_TIER[service];
  if (explicit) return TIERS[explicit];
  if (service.startsWith("admin-")) return TIERS.admin;
  if (service.startsWith("public-")) return TIERS.public;
  return TIERS.default;
}

/**
 * Best-effort client IP from the proxy headers nginx sets
 * (`X-Forwarded-For` first hop, then `X-Real-IP`). Returns "unknown" when
 * absent so a missing header still shares a single bucket rather than
 * bypassing the limiter entirely.
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Atomic fixed-window counter. KEYS[1]=bucket key, ARGV[1]=windowSec.
// Returns [currentCount, ttlSeconds].
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

/**
 * Check (and consume) one unit of the rate-limit budget for `bucket`.
 * `bucket` should already be namespaced by caller (e.g. "service:ip").
 * Fails open (allowed=true) if Redis errors.
 */
export async function checkRateLimit(
  bucket: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  try {
    const client = await getRedis();
    const key = `q4w:rl:${bucket}`;
    const res = (await evalScript(
      client,
      FIXED_WINDOW_LUA,
      [key],
      [String(rule.windowSec)],
    )) as [number, number];

    const count = Number(res?.[0] ?? 0);
    let ttl = Number(res?.[1] ?? rule.windowSec);
    if (!Number.isFinite(ttl) || ttl < 0) ttl = rule.windowSec;

    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetSec: ttl,
    };
  } catch (err) {
    console.error("[rate-limit] check failed, failing open:", err instanceof Error ? err.message : String(err));
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetSec: rule.windowSec };
  }
}

/** Standard rate-limit response headers (added to every routed response). */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.resetSec),
  };
}
