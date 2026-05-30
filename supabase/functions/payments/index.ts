/**
 * Payments Edge Function — Quiz4Win
 *
 * Public routes:
 *   POST /payments                  — Initiate a payment (mastercard | crypto | apple)
 *   GET  /payments/:id              — Read payment status (JWT, owner-only)
 *   POST /payments/:id/verify       — Re-query gateway and credit wallet (no auth)
 *   POST /payments/webhook/:method  — Gateway callback (Remitation -> us)
 *
 * Gateway: Remitation
 *   - MasterCard:  POST <base>/payment-gateway/generate    + x-access-key / x-secret-key
 *   - Crypto:      POST <base>/crypto-payment-gateway      + x-access-key / x-secret-key (different keys!)
 *
 * Apple Pay is a placeholder (501).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const REMITATION_BASE = Deno.env.get("REMITATION_BASE_URL")
  ?? "https://api.merchant.remitation.com/api/plugin";

const MC_ACCESS_KEY     = Deno.env.get("REMITATION_ACCESS_KEY") ?? "";
const MC_SECRET_KEY     = Deno.env.get("REMITATION_SECRET_KEY") ?? "";
const CRYPTO_ACCESS_KEY = Deno.env.get("REMITATION_CRYPTO_ACCESS_KEY") ?? "";
const CRYPTO_SECRET_KEY = Deno.env.get("REMITATION_CRYPTO_SECRET_KEY") ?? "";

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.quiz4win.com";
const API_URL = Deno.env.get("API_URL") ?? "https://api.quiz4win.com";

const MC_URL     = `${REMITATION_BASE}/payment-gateway`;
const CRYPTO_URL = `${REMITATION_BASE}/crypto-payment-gateway`;

const SUCCESS_STATES = new Set(["successful", "success", "paid", "completed", "finished", "settled", "confirmed"]);
const FAILURE_STATES = new Set(["failed", "cancelled", "canceled", "expired", "refunded"]);

function classify(state: string | undefined): "succeeded" | "failed" | "pending" {
  const s = (state ?? "").toLowerCase();
  if (SUCCESS_STATES.has(s)) return "succeeded";
  if (FAILURE_STATES.has(s)) return "failed";
  return "pending";
}

function clientIp(req: Request): string | null {
  return req.headers.get("x-real-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (parts.length === 1 && req.method === "POST") return await initiate(req);
    if (parts.length === 2 && req.method === "GET") return await readStatus(req, parts[1]);
    if (parts.length === 3 && parts[2] === "verify" && req.method === "POST") return await verify(parts[1]);
    if (parts.length === 3 && parts[1] === "webhook" && req.method === "POST") return await webhook(req, parts[2]);
    return errorResponse("not_found", 404);
  } catch (err) {
    console.error("[payments] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});

async function initiate(req: Request): Promise<Response> {
  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse(authErr ?? "unauthorized", 401);

  const body = await req.json();
  const { method, amount_cents, currency, productName, desc, extData, crypto: cryptoCoin } = body;

  if (!method || !["mastercard", "apple", "crypto"].includes(method)) return errorResponse("invalid_method", 400);
  if (!amount_cents || typeof amount_cents !== "number" || amount_cents <= 0) return errorResponse("invalid_amount", 400);

  const paymentId = crypto.randomUUID();
  const admin = getAdminClient();
  const ip = clientIp(req);

  if (method === "mastercard") return await initiateMastercard({
    paymentId, user, admin, amount_cents, currency: currency ?? "EUR", productName, desc, extData, ip,
  });
  if (method === "crypto") return await initiateCrypto({
    paymentId, user, admin, amount_cents, fiat: currency ?? "USD", cryptoCoin: cryptoCoin ?? "USDTTRC20", desc, ip,
  });
  return errorResponse(`${method}_not_implemented`, 501);
}

async function initiateMastercard(args: {
  paymentId: string; user: { id: string; email?: string }; admin: ReturnType<typeof getAdminClient>;
  amount_cents: number; currency: string; productName?: string; desc?: string; extData?: unknown; ip: string | null;
}): Promise<Response> {
  if (!MC_ACCESS_KEY || !MC_SECRET_KEY) return errorResponse("payment_gateway_not_configured", 503);

  const redirectUrl = `${APP_URL}/pay/return?id=${args.paymentId}`;
  const res = await fetch(`${MC_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-key": MC_ACCESS_KEY, "x-secret-key": MC_SECRET_KEY },
    body: JSON.stringify({
      amount: args.amount_cents / 100,
      currency: args.currency,
      productName: args.productName || "Wallet Top-up",
      desc: args.desc || `Top-up for ${args.user.email ?? args.user.id}`,
      extData: args.extData || {},
      redirectUrl,
      provider: "stripe",
    }),
  });

  if (!res.ok) {
    console.error("[payments][mc] generate failed:", res.status, await res.text());
    return errorResponse("gateway_error", 502);
  }
  const raw = await res.json();
  const pg = raw?.data?.paymentGateway;
  const paymentLink: string | undefined = pg?.paymentInfo?.paymentLink;
  if (!raw?.success || !pg || !paymentLink) {
    console.error("[payments][mc] unexpected response:", JSON.stringify(raw).slice(0, 500));
    return errorResponse("gateway_error", 502);
  }

  const { error: insErr } = await args.admin.from("payments").insert({
    id: args.paymentId, user_id: args.user.id, method: "mastercard", provider: "remitation_stripe",
    amount_cents: args.amount_cents, currency: args.currency, status: "pending",
    provider_payment_id: pg._id, provider_short_id: pg.shortId, provider_response: raw,
    payment_link: paymentLink, redirect_url: redirectUrl,
    client_ip: args.ip, initiated_at: new Date().toISOString(),
  });
  if (insErr) { console.error("[payments][mc] insert:", insErr.message); return errorResponse("failed_to_initiate_payment", 500); }

  return successResponse({ payment_id: args.paymentId, method: "mastercard", redirect_url: paymentLink }, 201);
}


async function initiateCrypto(args: {
  paymentId: string; user: { id: string; email?: string }; admin: ReturnType<typeof getAdminClient>;
  amount_cents: number; fiat: string; cryptoCoin: string; desc?: string; ip: string | null;
}): Promise<Response> {
  if (!CRYPTO_ACCESS_KEY || !CRYPTO_SECRET_KEY) return errorResponse("crypto_gateway_not_configured", 503);

  const amountFiat = args.amount_cents / 100;
  const callbackUrl = `${API_URL}/payments/webhook/crypto`;

  const res = await fetch(CRYPTO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-key": CRYPTO_ACCESS_KEY, "x-secret-key": CRYPTO_SECRET_KEY },
    body: JSON.stringify({
      amount: String(amountFiat),
      crypto: args.cryptoCoin,
      fiat: args.fiat.toUpperCase(),
      desc: args.desc || `Wallet top-up for ${args.user.email ?? args.user.id}`,
      url: callbackUrl,
      id: args.paymentId,
    }),
  });

  if (!res.ok) {
    console.error("[payments][crypto] generate failed:", res.status, await res.text());
    return errorResponse("gateway_error", 502);
  }
  const raw = await res.json();
  const d = raw?.data;
  if (!raw?.success || !d?.payAddress) {
    console.error("[payments][crypto] unexpected response:", JSON.stringify(raw).slice(0, 500));
    return errorResponse("gateway_error", 502);
  }

  const { error: insErr } = await args.admin.from("payments").insert({
    id: args.paymentId, user_id: args.user.id, method: "crypto", provider: "remitation_crypto",
    amount_cents: args.amount_cents, currency: args.fiat.toUpperCase(), status: "pending",
    provider_payment_id: d._id, provider_short_id: d.externalPaymentId,
    provider_response: raw,
    pay_address: d.payAddress, pay_amount: d.payAmount, pay_currency: d.payCurrency,
    qr_url: d.qr, expires_at: d.expirationEstimateDate,
    redirect_url: `${APP_URL}/pay/return?id=${args.paymentId}`,
    client_ip: args.ip, initiated_at: new Date().toISOString(),
  });
  if (insErr) { console.error("[payments][crypto] insert:", insErr.message); return errorResponse("failed_to_initiate_payment", 500); }

  return successResponse({
    payment_id: args.paymentId, method: "crypto",
    redirect_url: `${APP_URL}/pay/return?id=${args.paymentId}`,
    crypto: {
      address: d.payAddress, amount: d.payAmount, currency: d.payCurrency,
      network: d.network, qr_url: d.qr, expires_at: d.expirationEstimateDate,
      fiat_amount: d.priceAmount, fiat_currency: d.priceCurrency,
    },
  }, 201);
}

async function readStatus(req: Request, paymentId: string): Promise<Response> {
  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse(authErr ?? "unauthorized", 401);

  const admin = getAdminClient();
  const { data, error } = await admin.from("payments").select("*").eq("id", paymentId).eq("user_id", user.id).single();
  if (error || !data) return errorResponse("payment_not_found", 404);

  return successResponse({
    id: data.id, status: data.status, method: data.method,
    amount_cents: data.amount_cents, currency: data.currency,
    transaction_id: data.transaction_id, completed_at: data.completed_at,
    payment_link: data.payment_link,
    pay_address: data.pay_address, pay_amount: data.pay_amount, pay_currency: data.pay_currency,
    qr_url: data.qr_url, expires_at: data.expires_at,
  });
}

async function verify(paymentId: string): Promise<Response> {
  const admin = getAdminClient();
  const { data: payment, error } = await admin.from("payments").select("*").eq("id", paymentId).single();
  if (error || !payment) return errorResponse("payment_not_found", 404);

  // Public-safe view used to enrich every response from this endpoint
  const publicView = {
    method: payment.method,
    amount_cents: payment.amount_cents,
    currency: payment.currency,
    pay_address: payment.pay_address,
    pay_amount: payment.pay_amount,
    pay_currency: payment.pay_currency,
    qr_url: payment.qr_url,
    expires_at: payment.expires_at,
  };

  if (payment.status === "succeeded") return successResponse({ status: "succeeded", transaction_id: payment.transaction_id, ...publicView });
  if (["failed", "cancelled", "expired"].includes(payment.status)) return successResponse({ status: payment.status, ...publicView });

  let state: string | undefined;
  let providerData: unknown = null;
  if (payment.method === "mastercard") {
    const res = await fetch(`${MC_URL}/${payment.provider_payment_id}`, {
      method: "GET",
      headers: { "x-access-key": MC_ACCESS_KEY, "x-secret-key": MC_SECRET_KEY },
    });
    if (!res.ok) { console.error("[payments][mc] verify failed:", await res.text()); return errorResponse("gateway_verification_failed", 502); }
    providerData = await res.json();
    const d = (providerData as { data?: { paymentGateway?: { state?: string }; state?: string } })?.data;
    state = d?.paymentGateway?.state ?? d?.state;
  } else if (payment.method === "crypto") {
    const res = await fetch(`${CRYPTO_URL}/${payment.provider_payment_id}`, {
      method: "GET",
      headers: { "x-access-key": CRYPTO_ACCESS_KEY, "x-secret-key": CRYPTO_SECRET_KEY },
    });
    if (!res.ok) { console.error("[payments][crypto] verify failed:", await res.text()); return errorResponse("gateway_verification_failed", 502); }
    providerData = await res.json();
    const d = (providerData as { data?: { status?: string; state?: string } })?.data;
    state = d?.status ?? d?.state;
  } else {
    return errorResponse("verification_not_implemented", 501);
  }

  const outcome = classify(state);
  const result = await applyOutcome(paymentId, outcome, providerData);
  // Merge the public view into the outcome response
  const body = await result.json();
  return successResponse({ ...body, ...publicView }, result.status);
}

async function webhook(req: Request, method: string): Promise<Response> {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorResponse("invalid_payload", 400);

  // Remitation echoes our local id in `id` (we sent it as `id` for crypto, or `extData.orderId` for MC)
  const data = (body.data ?? body) as Record<string, unknown>;
  const paymentId = (body.id ?? data.id ?? data.externalPaymentId) as string | undefined;
  if (!paymentId) {
    console.warn("[payments][webhook] missing id, body=", JSON.stringify(body).slice(0, 300));
    return errorResponse("invalid_payload", 400);
  }

  const state = (body.status ?? body.state ?? data.status ?? data.state) as string | undefined;
  console.log(`[payments][webhook] method=${method} id=${paymentId} state=${state}`);
  return await applyOutcome(paymentId, classify(state), body);
}

async function applyOutcome(
  paymentId: string,
  outcome: "succeeded" | "failed" | "pending",
  providerData: unknown,
): Promise<Response> {
  const admin = getAdminClient();
  if (outcome === "succeeded") {
    const { data: txId, error } = await admin.rpc("complete_payment", {
      p_payment_id: paymentId, p_provider_response: providerData,
    });
    if (error) { console.error("[payments] complete_payment:", error.message); return errorResponse("failed_to_complete_payment", 500); }
    return successResponse({ status: "succeeded", transaction_id: txId });
  }
  if (outcome === "failed") {
    await admin.from("payments").update({
      status: "failed", provider_response: providerData, verified_at: new Date().toISOString(),
    }).eq("id", paymentId);
    return successResponse({ status: "failed" });
  }
  return successResponse({ status: "pending" });
}
