/**
 * Security Edge Function — Quiz4Win
 *
 * POST /security/verify-recaptcha — Server-side reCAPTCHA v3 verification (API #9)
 *
 * Rule compliance:
 *   R-01: the secret and the user token are NEVER logged — only their presence
 *         and length. The full Google response body is logged because it does
 *         not contain the secret.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";
const MIN_SCORE = Number(Deno.env.get("RECAPTCHA_MIN_SCORE") ?? "0.5");

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
