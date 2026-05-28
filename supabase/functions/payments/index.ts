/**
 * Payments Edge Function — Quiz4Win
 *
 * POST /payments           — Initiate a payment (MasterCard, Apple, Crypto)
 * GET  /payments/:id       — Check payment status
 * POST /payments/:id/verify — Verify payment with gateway and credit wallet
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const REMITATION_ACCESS_KEY = Deno.env.get("REMITATION_ACCESS_KEY") ?? "";
const REMITATION_SECRET_KEY = Deno.env.get("REMITATION_SECRET_KEY") ?? "";
const REMITATION_BASE_URL = Deno.env.get("REMITATION_BASE_URL") ?? "https://api.merchant.remitation.com/api/plugin/payment-gateway";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.quiz4win.com";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean); // ["payments", ...] or ["payments", "id", "verify"]

  try {
    // ── 1. POST /payments (Initiate) ─────────────────────────────────────────
    if (pathParts.length === 1 && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse(authErr ?? "unauthorized", 401);

      const body = await req.json();
      const { method, amount_cents, currency = "EUR", productName, desc, extData } = body;

      if (!method || !["mastercard", "apple", "crypto"].includes(method)) {
        return errorResponse("invalid_method", 400);
      }
      if (!amount_cents || typeof amount_cents !== "number" || amount_cents <= 0) {
        return errorResponse("invalid_amount", 400);
      }

      const paymentId = crypto.randomUUID();
      const admin = getAdminClient();

      // Initiate provider flow
      if (method === "mastercard") {
        if (!REMITATION_ACCESS_KEY || !REMITATION_SECRET_KEY) {
          return errorResponse("payment_gateway_not_configured", 503);
        }

        // Remitation expects amount in units (not cents)
        const amountUnits = amount_cents / 100;
        const redirectUrl = `${APP_URL}/pay/return?id=${paymentId}`;

        const remitationRes = await fetch(`${REMITATION_BASE_URL}/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-access-key": REMITATION_ACCESS_KEY,
            "x-secret-key": REMITATION_SECRET_KEY,
          },
          body: JSON.stringify({
            amount: amountUnits,
            currency,
            productName: productName || "Wallet Top-up",
            desc: desc || `Top-up for ${user.email}`,
            extData: extData || {},
            redirectUrl,
            provider: "stripe",
          }),
        });

        if (!remitationRes.ok) {
          const errBody = await remitationRes.text();
          console.error("[payments] Remitation generate error:", errBody);
          return errorResponse("gateway_error", 502);
        }

        const gatewayData = await remitationRes.json();
        // gatewayData: { _id, shortId, providerTrackId, paymentLink, ... }

        // Store in payments table
        const { error: insErr } = await admin.from("payments").insert({
          id: paymentId,
          user_id: user.id,
          method: "mastercard",
          provider: "remitation",
          amount_cents,
          currency,
          status: "pending",
          provider_payment_id: gatewayData._id,
          provider_short_id: gatewayData.shortId,
          provider_response: gatewayData,
          payment_link: gatewayData.paymentLink,
          redirect_url: redirectUrl,
          client_ip: req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0],
          initiated_at: new Date().toISOString(),
        });

        if (insErr) {
          console.error("[payments] DB insert error:", insErr.message);
          return errorResponse("failed_to_initiate_payment", 500);
        }

        return successResponse({
          payment_id: paymentId,
          redirect_url: gatewayData.paymentLink,
        }, 201);
      }

      // Apple / Crypto Placeholders
      return errorResponse(`${method}_not_implemented`, 501);
    }

    // ── 2. GET /payments/:id (Status) ────────────────────────────────────────
    if (pathParts.length === 2 && req.method === "GET") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse(authErr ?? "unauthorized", 401);

      const paymentId = pathParts[1];
      const admin = getAdminClient();

      const { data, error } = await admin
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .eq("user_id", user.id)
        .single();

      if (error || !data) return errorResponse("payment_not_found", 404);

      return successResponse({
        id: data.id,
        status: data.status,
        amount_cents: data.amount_cents,
        currency: data.currency,
        method: data.method,
        transaction_id: data.transaction_id,
        completed_at: data.completed_at,
      });
    }

    // ── 3. POST /payments/:id/verify (Verification) ──────────────────────────
    if (pathParts.length === 3 && pathParts[2] === "verify" && req.method === "POST") {
      const paymentId = pathParts[1];
      const admin = getAdminClient();

      // 1. Fetch local payment record
      const { data: payment, error: fetchErr } = await admin
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .single();

      if (fetchErr || !payment) return errorResponse("payment_not_found", 404);

      // If already succeeded, return success early
      if (payment.status === "succeeded") {
        return successResponse({ status: "succeeded", transaction_id: payment.transaction_id });
      }

      // If terminal but not success, return current status
      if (["failed", "cancelled", "expired"].includes(payment.status)) {
        return successResponse({ status: payment.status });
      }

      // 2. Verify with Remitation (MasterCard only for now)
      if (payment.method === "mastercard") {
        const verifyRes = await fetch(`${REMITATION_BASE_URL}/${payment.provider_payment_id}`, {
          method: "GET",
          headers: {
            "x-access-key": REMITATION_ACCESS_KEY,
            "x-secret-key": REMITATION_SECRET_KEY,
          },
        });

        if (!verifyRes.ok) {
          console.error("[payments] Remitation verify failed:", await verifyRes.text());
          return errorResponse("gateway_verification_failed", 502);
        }

        const gatewayStatus = await verifyRes.json();
        // State values from spec / common patterns: successful, paid, completed
        const isSuccess = ["successful", "success", "paid", "completed"].includes(gatewayStatus.state?.toLowerCase());
        const isFailure = ["failed", "cancelled", "expired"].includes(gatewayStatus.state?.toLowerCase());

        if (isSuccess) {
          // 3. Atomically credit wallet via RPC
          const { data: txId, error: rpcErr } = await admin.rpc("complete_payment", {
            p_payment_id: paymentId,
            p_provider_response: gatewayStatus,
          });

          if (rpcErr) {
            console.error("[payments] RPC complete_payment error:", rpcErr.message);
            return errorResponse("failed_to_complete_payment", 500);
          }

          return successResponse({ status: "succeeded", transaction_id: txId });
        } else if (isFailure) {
          await admin.from("payments").update({
            status: gatewayStatus.state?.toLowerCase(),
            provider_response: gatewayStatus,
            verified_at: new Date().toISOString(),
          }).eq("id", paymentId);

          return successResponse({ status: gatewayStatus.state?.toLowerCase() });
        } else {
          // Still pending
          return successResponse({ status: "pending" });
        }
      }

      return errorResponse("verification_not_implemented", 501);
    }

    return errorResponse("not_found", 404);
  } catch (err) {
    console.error("[payments] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});
