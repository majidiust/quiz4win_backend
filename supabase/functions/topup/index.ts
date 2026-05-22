/**
 * Top-up Edge Function — Quiz4Win
 *
 * POST /topup/stripe/intent      — Create Stripe PaymentIntent (API #19)
 * POST /topup/stripe/webhook     — Stripe webhook handler (API #20)
 * POST /topup/apple-pay/session  — Apple Pay merchant validation (API #21)
 * POST /topup/google-pay/order   — Google Pay order initiation (API #22)
 * GET  /topup/crypto/address     — Get crypto deposit address (API #23)
 *
 * Rule compliance: R-01, R-02, R-03, R-05 (append-only transactions)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const APPLE_PAY_MERCHANT_ID = Deno.env.get("APPLE_PAY_MERCHANT_ID") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/topup\/?/, "");

  try {
    // POST /topup/stripe/intent — requires auth
    if (path === "stripe/intent" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const { amount_cents, currency = "usd" } = await req.json();
      if (!amount_cents || amount_cents < 100) {
        return errorResponse("Minimum top-up is 1.00 USD (100 cents)", 400);
      }
      if (amount_cents > 1_000_000_00) { // $1,000,000 max
        return errorResponse("Exceeds maximum top-up limit", 400);
      }

      if (!STRIPE_SECRET) return errorResponse("Payment gateway not configured", 503);

      const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          amount: String(amount_cents),
          currency,
          "metadata[user_id]": user.id,
          "metadata[type]": "topup",
          automatic_payment_methods: JSON.stringify({ enabled: true }),
        } as Record<string, string>),
      });

      if (!stripeRes.ok) {
        const stripeErr = await stripeRes.json();
        return errorResponse(stripeErr.error?.message ?? "stripe_error", 400);
      }

      const intent = await stripeRes.json();
      return successResponse({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents,
        currency,
      });
    }

    // POST /topup/stripe/webhook — no auth (Stripe signs requests)
    if (path === "stripe/webhook" && req.method === "POST") {
      const sig = req.headers.get("stripe-signature");
      if (!sig || !STRIPE_WEBHOOK_SECRET) {
        return errorResponse("Invalid webhook signature", 400);
      }

      const body = await req.text();
      // Note: Full Stripe signature verification requires the Stripe SDK or
      // a manual HMAC-SHA256 implementation. Placeholder below.
      // TODO: implement HMAC verification with STRIPE_WEBHOOK_SECRET
      const event = JSON.parse(body);

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        const userId = pi.metadata?.user_id;
        const amountCents = pi.amount_received;

        if (userId && amountCents > 0) {
          const admin = getAdminClient();
          // R-05: append-only — only INSERT, never UPDATE balance directly
          await admin.rpc("credit_wallet", {
            p_user_id: userId,
            p_amount_cents: amountCents,
            p_reference_id: pi.id,
            p_type: "topup",
          });
        }
      }

      return successResponse({ received: true });
    }

    // POST /topup/apple-pay/session — requires auth
    if (path === "apple-pay/session" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const { validation_url } = await req.json();
      if (!validation_url) return errorResponse("validation_url is required", 400);

      // Apple Pay merchant validation — placeholder (requires Apple Pay cert in env)
      return successResponse({
        message: "Apple Pay merchant validation",
        merchant_id: APPLE_PAY_MERCHANT_ID,
        note: "Implement full Apple Pay merchant session using APPLE_PAY_CERT env secret",
      });
    }

    // POST /topup/google-pay/order — requires auth
    if (path === "google-pay/order" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const { amount_cents, currency = "USD" } = await req.json();
      if (!amount_cents || amount_cents < 100) {
        return errorResponse("Minimum top-up is 1.00 (100 cents)", 400);
      }

      // Google Pay flows through Stripe — reuse Stripe PaymentIntent
      return successResponse({
        message: "Create Stripe PaymentIntent and use clientSecret with Google Pay SDK",
        redirect_to: "/topup/stripe/intent",
      });
    }

    // GET /topup/crypto/address — requires auth
    if (path === "crypto/address" && req.method === "GET") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const currency = url.searchParams.get("currency") ?? "USDT";
      const supported = ["USDT", "BTC", "ETH", "USDC"];
      if (!supported.includes(currency)) {
        return errorResponse(`Unsupported currency. Supported: ${supported.join(", ")}`, 400);
      }

      // TODO: Integrate with crypto payment provider (e.g., Coinbase Commerce, NOWPayments)
      return successResponse({
        currency,
        network: currency === "BTC" ? "bitcoin" : "trc20",
        address: null,
        note: "Crypto deposit address generation requires integration with a crypto payment provider (CRYPTO_PROVIDER_API_KEY env secret)",
        expires_at: null,
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[topup] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
