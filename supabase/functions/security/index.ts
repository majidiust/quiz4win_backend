/**
 * Security Edge Function — Quiz4Win
 *
 * POST /security/verify-recaptcha       — Server-side reCAPTCHA v3 verification
 * GET  /security/settings               — Current 2FA state for the user
 * POST /security/2fa/email/setup        — Email a 6-digit code to the user
 * POST /security/2fa/email/enable       — Verify code → enable email 2FA
 * POST /security/2fa/email/disable      — Verify code → disable email 2FA
 * POST /security/2fa/totp/setup         — Generate TOTP secret + otpauth URL
 * POST /security/2fa/totp/enable        — Verify TOTP code → enable TOTP
 * POST /security/2fa/totp/disable       — Verify TOTP code → disable TOTP
 *
 * Rule compliance:
 *   R-01: secrets, TOTP secrets and email OTPs are never logged. Email codes
 *         are stored as SHA-256 hashes; the plaintext is mailed and discarded.
 *   R-03: every 2FA endpoint validates the JWT before any DB write.
 *   R-04: writes go through the admin client; the user_security table grants
 *         SELECT only to the row owner via RLS.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { sendEmail, twoFactorCodeTemplate } from "../_shared/email.ts";
import {
  buildOtpAuthUrl,
  generateNumericCode,
  generateTotpSecret,
  sha256Hex,
  verifyTotp,
} from "../_shared/totp.ts";

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";
const MIN_SCORE = Number(Deno.env.get("RECAPTCHA_MIN_SCORE") ?? "0.5");

const EMAIL_CODE_TTL_MIN = 10;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

// One-shot startup banner so we can see, the moment the dispatcher boots, whether
// the secret is configured at all.
console.log(
  `[security] boot — RECAPTCHA_SECRET_KEY ${
    RECAPTCHA_SECRET ? `configured (len=${RECAPTCHA_SECRET.length})` : "MISSING"
  }, MIN_SCORE=${MIN_SCORE}`,
);

/** Short request id for correlating log lines of a single call. */
function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Fetch the user_security row for `userId`, creating it on first access so
 * downstream UPDATE statements always have a target row.
 */
// deno-lint-ignore no-explicit-any
async function getOrCreateSecurityRow(admin: any, userId: string) {
  const { data } = await admin
    .from("user_security")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;
  const { data: created, error } = await admin
    .from("user_security")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (error) throw new Error(`user_security_init_failed: ${error.message}`);
  return created;
}

/** Validate a 6-digit email OTP against the stored hash + expiry. */
async function verifyEmailCode(
  row: {
    email_code_hash: string | null;
    email_code_expires_at: string | null;
    email_code_attempts: number;
  },
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!row.email_code_hash || !row.email_code_expires_at) {
    return { ok: false, reason: "code_not_requested" };
  }
  if (new Date(row.email_code_expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "code_expired" };
  }
  if (row.email_code_attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: "code_locked" };
  }
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "code_invalid" };
  const incoming = await sha256Hex(code);
  if (incoming !== row.email_code_hash) return { ok: false, reason: "code_invalid" };
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/security\/?/, "");
  const id = rid();

  console.log(
    `[security ${id}] ${req.method} ${url.pathname} origin=${
      req.headers.get("origin") ?? "-"
    } ua=${(req.headers.get("user-agent") ?? "-").slice(0, 60)}`,
  );

  try {
    // POST /security/verify-recaptcha
    if (path === "verify-recaptcha" && req.method === "POST") {
      // 1. Parse body defensively — bad JSON should give a clear error, not 500.
      let body: { token?: unknown; action?: unknown };
      try {
        body = await req.json();
      } catch (err) {
        console.warn(`[security ${id}] invalid JSON body:`, err instanceof Error ? err.message : err);
        return errorResponse("invalid_json_body", 400);
      }

      const token = typeof body.token === "string" ? body.token : "";
      const action = typeof body.action === "string" ? body.action : "";

      console.log(
        `[security ${id}] verify-recaptcha received: token_present=${!!token} token_len=${token.length} action=${action || "(none)"}`,
      );

      if (!token) {
        console.warn(`[security ${id}] reject — token missing`);
        return errorResponse("token is required", 400);
      }

      if (!RECAPTCHA_SECRET) {
        console.error(`[security ${id}] reject — RECAPTCHA_SECRET_KEY not set in environment`);
        return errorResponse("reCAPTCHA not configured", 503);
      }

      // 2. Call Google siteverify.
      const formData = new FormData();
      formData.append("secret", RECAPTCHA_SECRET);
      formData.append("response", token);

      const startedAt = Date.now();
      let verifyRes: Response;
      try {
        verifyRes = await fetch(
          "https://www.google.com/recaptcha/api/siteverify",
          { method: "POST", body: formData },
        );
      } catch (err) {
        console.error(
          `[security ${id}] google siteverify network error:`,
          err instanceof Error ? err.message : err,
        );
        return errorResponse("recaptcha_network_error", 502);
      }

      const elapsed = Date.now() - startedAt;
      const rawBody = await verifyRes.text();
      console.log(
        `[security ${id}] google siteverify status=${verifyRes.status} elapsed_ms=${elapsed} body=${rawBody}`,
      );

      // 3. Parse Google's response.
      let result: {
        success?: boolean;
        score?: number;
        action?: string;
        hostname?: string;
        challenge_ts?: string;
        "error-codes"?: string[];
      };
      try {
        result = JSON.parse(rawBody);
      } catch (err) {
        console.error(
          `[security ${id}] google returned non-JSON body:`,
          err instanceof Error ? err.message : err,
        );
        return errorResponse("recaptcha_bad_response", 502);
      }

      if (!result.success) {
        const codes = result["error-codes"] ?? [];
        console.warn(`[security ${id}] reject — google success=false codes=${JSON.stringify(codes)}`);
        // Surface the google error codes to help the client distinguish
        // misconfigured secret vs invalid token.
        return new Response(
          JSON.stringify({ error: "recaptcha_failed", codes }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // 4. Enforce score + optional action match.
      const score: number = result.score ?? 0;
      if (score < MIN_SCORE) {
        console.warn(
          `[security ${id}] reject — score=${score} below min=${MIN_SCORE} action=${result.action ?? "-"}`,
        );
        return errorResponse("recaptcha_score_too_low", 400);
      }
      if (action && result.action !== action) {
        console.warn(
          `[security ${id}] reject — action mismatch expected=${action} got=${result.action ?? "-"}`,
        );
        return errorResponse("recaptcha_action_mismatch", 400);
      }

      console.log(
        `[security ${id}] OK — score=${score} action=${result.action ?? "-"} hostname=${result.hostname ?? "-"}`,
      );
      return successResponse({ success: true, score });
    }

    // ── 2FA & account-security routes ──────────────────────────────────────
    // All require a valid JWT (R-03). The user id always comes from the JWT
    // (never the body).
    if (
      path === "settings" ||
      path.startsWith("2fa/")
    ) {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const admin = getAdminClient();
      const row = await getOrCreateSecurityRow(admin, user.id);

      // GET /security/settings
      if (path === "settings" && req.method === "GET") {
        return successResponse({
          email_2fa_enabled: !!row.email_2fa_enabled,
          totp_enabled: !!row.totp_enabled,
        });
      }

      // POST /security/2fa/email/setup
      if (path === "2fa/email/setup" && req.method === "POST") {
        if (!user.email) return errorResponse("account_missing_email", 400);
        const code = generateNumericCode(6);
        const hash = await sha256Hex(code);
        const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60_000).toISOString();
        const { error: updErr } = await admin
          .from("user_security")
          .update({
            email_code_hash: hash,
            email_code_expires_at: expiresAt,
            email_code_attempts: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
        if (updErr) {
          console.error(`[security ${id}] email/setup update failed: ${updErr.message}`);
          return errorResponse("internal_error", 500);
        }
        // Pull display name for personalisation (best-effort).
        const { data: profile } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();
        const name = (profile?.full_name as string | null | undefined) ?? "";
        const purpose: "enable" | "disable" = row.email_2fa_enabled ? "disable" : "enable";
        const tpl = twoFactorCodeTemplate({ name, code, purpose, ttlMinutes: EMAIL_CODE_TTL_MIN });
        // Fire-and-forget; failure to dispatch is logged but does not break the API.
        sendEmail({ to: { email: user.email, name: name || undefined }, ...tpl }).catch((err) =>
          console.warn(`[security ${id}] 2fa email send failed:`, err),
        );
        console.log(`[security ${id}] email/setup — user=${user.id} purpose=${purpose} ttl=${EMAIL_CODE_TTL_MIN}m`);
        return successResponse({ message: "Code sent" });
      }

      // Shared verify-and-toggle helper for email/{enable,disable}
      const handleEmailToggle = async (enable: boolean): Promise<Response> => {
        const body = await req.json().catch(() => ({}));
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!code) return errorResponse("code is required", 400);
        const check = await verifyEmailCode(row, code);
        if (!check.ok) {
          await admin
            .from("user_security")
            .update({
              email_code_attempts: (row.email_code_attempts ?? 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id);
          return errorResponse(check.reason ?? "code_invalid", 400);
        }
        const { error: updErr } = await admin
          .from("user_security")
          .update({
            email_2fa_enabled: enable,
            email_code_hash: null,
            email_code_expires_at: null,
            email_code_attempts: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
        if (updErr) {
          console.error(`[security ${id}] email toggle failed: ${updErr.message}`);
          return errorResponse("internal_error", 500);
        }
        return successResponse({ enabled: enable });
      };

      if (path === "2fa/email/enable" && req.method === "POST") return handleEmailToggle(true);
      if (path === "2fa/email/disable" && req.method === "POST") return handleEmailToggle(false);

      // POST /security/2fa/totp/setup
      if (path === "2fa/totp/setup" && req.method === "POST") {
        if (!user.email) return errorResponse("account_missing_email", 400);
        const secret = generateTotpSecret();
        const { error: updErr } = await admin
          .from("user_security")
          .update({
            totp_secret: secret,
            totp_enabled: false, // not active until /enable verifies a code
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
        if (updErr) {
          console.error(`[security ${id}] totp/setup update failed: ${updErr.message}`);
          return errorResponse("internal_error", 500);
        }
        const otpauth_url = buildOtpAuthUrl(secret, user.email);
        console.log(`[security ${id}] totp/setup — user=${user.id} (secret stored, not yet enabled)`);
        return successResponse({ secret, otpauth_url });
      }

      // Shared verify-and-toggle helper for totp/{enable,disable}
      const handleTotpToggle = async (enable: boolean): Promise<Response> => {
        const body = await req.json().catch(() => ({}));
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!code) return errorResponse("code is required", 400);
        if (!row.totp_secret) return errorResponse("totp_not_initialised", 400);
        const ok = await verifyTotp(row.totp_secret, code);
        if (!ok) return errorResponse("code_invalid", 400);
        const patch: Record<string, unknown> = {
          totp_enabled: enable,
          updated_at: new Date().toISOString(),
        };
        // Clear the secret on disable so a future enable requires a fresh setup.
        if (!enable) patch.totp_secret = null;
        const { error: updErr } = await admin
          .from("user_security")
          .update(patch)
          .eq("user_id", user.id);
        if (updErr) {
          console.error(`[security ${id}] totp toggle failed: ${updErr.message}`);
          return errorResponse("internal_error", 500);
        }
        return successResponse({ enabled: enable });
      };

      if (path === "2fa/totp/enable" && req.method === "POST") return handleTotpToggle(true);
      if (path === "2fa/totp/disable" && req.method === "POST") return handleTotpToggle(false);
    }

    console.warn(`[security ${id}] no route matched — ${req.method} ${path}`);
    return errorResponse("Not found", 404);
  } catch (err) {
    console.error(
      `[security ${id}] unhandled error:`,
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : err,
    );
    return errorResponse("Internal server error", 500);
  }
});
