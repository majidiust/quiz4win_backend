/**
 * Public Early Birds Edge Function — Quiz4Win
 *
 * POST /public-early-birds
 *   Mobile app early-access sign-up (iOS + Android).
 *   No authentication required.
 *
 *   Body:
 *     platform:     "ios" | "android"   (required)
 *     name:         string              (required, 1–120 chars)
 *     email:        string              (required) — for iOS this is the user's
 *                                          Apple ID (email-format identifier)
 *                                          shared via Sign in with Apple.
 *     country_name: string              (optional, ≤ 100 chars) full country name
 *     country_code: string              (optional, exactly 2 chars) ISO 3166-1 alpha-2
 *
 * Behaviour:
 *   1. Validate + rate-limit per IP (5/10min, 10/hr) via SECURITY DEFINER RPC.
 *   2. Insert row (unique on (platform, lower(email)) — duplicates return 409).
 *   3. Send a branded welcome email (best-effort; failure does not roll back
 *      the sign-up).
 *
 * Rule compliance:
 *   R-01: ip_address never returned in any response.
 *   R-04: anon Supabase client only — no service-role bypass.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";
import { sendEmail, earlyBirdWelcomeTemplate } from "../_shared/email.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORMS = new Set(["ios", "android"]);

interface EarlyBirdBody {
  platform?: unknown;
  name?: unknown;
  email?: unknown;
  country_name?: unknown;
  country_code?: unknown;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-early-birds\/?/, "");

  if (req.method !== "POST" || tail.length > 0) {
    return errorResponse("not_found", 404);
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: EarlyBirdBody;
  try {
    body = (await req.json()) as EarlyBirdBody;
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const countryName = typeof body.country_name === "string" ? body.country_name.trim() : null;
  const countryCode = typeof body.country_code === "string" ? body.country_code.trim().toUpperCase() : null;

  if (!PLATFORMS.has(platform)) {
    return errorResponse("platform_invalid", 400);
  }
  if (!name || name.length < 1 || name.length > 120) {
    return errorResponse("name_invalid", 400);
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return errorResponse("email_invalid", 400);
  }
  if (countryName !== null && countryName.length > 100) {
    return errorResponse("country_name_invalid", 400);
  }
  if (countryCode !== null && countryCode.length !== 2) {
    return errorResponse("country_code_invalid", 400);
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const clientIp = getClientIp(req) ?? "unknown";
  const supabase = getPublicClient();

  const { data: allowed, error: rlErr } = await supabase.rpc(
    "check_early_bird_rate_limit",
    { p_ip: clientIp },
  );
  if (rlErr) {
    console.error("[public-early-birds] rate-limit RPC error:", rlErr.message);
    // Fail open — don't block legitimate users on infra error.
  }
  if (allowed === false) {
    return errorResponse("rate_limited", 429, { "Retry-After": "600" });
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  // We generate the row id client-side so we don't need RETURNING — anon
  // has INSERT but no SELECT policy on this table (PII), and PostgREST's
  // `.select(...).single()` shape would otherwise force a RETURNING clause
  // that gets denied by RLS.
  const earlyBirdId = crypto.randomUUID();
  const { error } = await supabase
    .from("early_birds")
    .insert({
      id: earlyBirdId,
      platform,
      name,
      email,
      ip_address: clientIp,
      country: countryName,
      country_code: countryCode,
    });

  if (error) {
    console.error("[public-early-birds] insert error:", error.message);
    if (error.message?.toLowerCase().includes("unique") || error.message?.toLowerCase().includes("duplicate")) {
      return errorResponse("already_signed_up", 409);
    }
    return errorResponse("failed_to_sign_up", 500);
  }

  // ── Welcome email (best-effort) ────────────────────────────────────────────
  // We do not await this so a slow email provider doesn't delay the response,
  // but we still surface failures in the logs.
  (async () => {
    try {
      const tpl = earlyBirdWelcomeTemplate({ name, platform: platform as "ios" | "android" });
      await sendEmail({
        to: { email, name },
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      // Mark sent — uses anon client, which can't UPDATE; this is best-effort
      // bookkeeping that requires a service-role admin action to reconcile, so
      // we simply log success and move on. The audit timestamp on the row's
      // welcome_email_sent_at column will be updated by a background job (or
      // can be left null — the admin UI can resend on demand later).
    } catch (e) {
      console.error("[public-early-birds] welcome email error:", (e as Error).message);
    }
  })();

  return successResponse({ ok: true, early_bird_id: earlyBirdId }, 201);
});
