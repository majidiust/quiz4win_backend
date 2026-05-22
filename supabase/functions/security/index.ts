/**
 * Security Edge Function — Quiz4Win
 *
 * POST /security/verify-recaptcha — Server-side reCAPTCHA v3 verification (API #9)
 *
 * Rule compliance: R-01 (secret from env only)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/security\/?/, "");

  try {
    // POST /security/verify-recaptcha
    if (path === "verify-recaptcha" && req.method === "POST") {
      const { token, action } = await req.json();
      if (!token) return errorResponse("token is required", 400);

      if (!RECAPTCHA_SECRET) {
        return errorResponse("reCAPTCHA not configured", 503);
      }

      const formData = new FormData();
      formData.append("secret", RECAPTCHA_SECRET);
      formData.append("response", token);

      const verifyRes = await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        { method: "POST", body: formData },
      );
      const result = await verifyRes.json();

      if (!result.success) {
        return errorResponse("recaptcha_failed", 400);
      }

      // Enforce minimum score (0.5 default) and optional action check
      const score: number = result.score ?? 0;
      const minScore = 0.5;
      if (score < minScore) {
        return errorResponse("recaptcha_score_too_low", 400);
      }
      if (action && result.action !== action) {
        return errorResponse("recaptcha_action_mismatch", 400);
      }

      return successResponse({ success: true, score });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[security] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
