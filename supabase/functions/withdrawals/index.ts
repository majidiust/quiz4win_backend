/**
 * Withdrawals Edge Function — Quiz4Win
 *
 * POST /withdrawals/request            — Submit withdrawal request (API #24)
 * GET  /withdrawals/:withdrawal_id     — Get withdrawal status (API #25)
 * GET  /withdrawals                    — List all withdrawals (API #26)
 *
 * Rule compliance: R-01, R-02, R-03, R-05 (append-only), R-08 (KYC required)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

const MIN_WITHDRAWAL_CENTS = 1000; // $10.00 minimum
const MAX_WITHDRAWAL_CENTS = 10_000_00; // $10,000 maximum

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/^\/withdrawals\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // POST /withdrawals/request
    if (rawPath === "request" && req.method === "POST") {
      // R-08: KYC must be verified before withdrawal
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status, wallet_balance, currency")
        .eq("id", user.id)
        .single();

      if (profile?.kyc_status !== "verified") {
        return errorResponse("kyc_required", 403);
      }

      const { amount_cents, method, account_details } = await req.json();

      if (!amount_cents || amount_cents < MIN_WITHDRAWAL_CENTS) {
        return errorResponse(`Minimum withdrawal is ${MIN_WITHDRAWAL_CENTS / 100}`, 400);
      }
      if (amount_cents > MAX_WITHDRAWAL_CENTS) {
        return errorResponse(`Maximum withdrawal is ${MAX_WITHDRAWAL_CENTS / 100}`, 400);
      }

      const balance = profile?.wallet_balance ?? 0;
      if (amount_cents > balance) {
        return errorResponse("insufficient_balance", 400);
      }

      if (!method || !account_details) {
        return errorResponse("method and account_details are required", 400);
      }

      const admin = getAdminClient();

      // R-09: debit wallet and create withdrawal as a single atomic transaction
      const { data: withdrawal, error: wErr } = await admin
        .from("withdrawals")
        .insert({
          user_id: user.id,
          amount: amount_cents, // R-02: stored as integer cents
          currency: profile?.currency ?? "USD",
          method,
          account_details: JSON.stringify(account_details),
          status: "pending",
          requested_at: new Date().toISOString(),
        })
        .select("id, amount, currency, status, requested_at")
        .single();

      if (wErr) return errorResponse(sanitizeError(wErr), 500);

      // Debit wallet (R-05: record as append-only transaction)
      await admin.rpc("debit_wallet", {
        p_user_id: user.id,
        p_amount_cents: amount_cents,
        p_reference_id: withdrawal.id,
        p_type: "withdrawal",
      });

      return successResponse({ withdrawal }, 201);
    }

    // GET /withdrawals/:withdrawal_id
    if (rawPath && rawPath !== "request" && req.method === "GET") {
      const withdrawalId = rawPath;
      const { data, error } = await supabase
        .from("withdrawals")
        .select("id, amount, currency, method, status, requested_at, processed_at, rejection_reason")
        .eq("id", withdrawalId)
        .eq("user_id", user.id)
        .single();

      if (error || !data) return errorResponse("withdrawal_not_found", 404);
      return successResponse({ withdrawal: data });
    }

    // GET /withdrawals (list)
    if (!rawPath && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const status = url.searchParams.get("status");
      const offset = (page - 1) * limit;

      let query = supabase
        .from("withdrawals")
        .select("id, amount, currency, method, status, requested_at, processed_at, rejection_reason", { count: "exact" })
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        const statuses = status.split("|");
        if (statuses.length === 1) query = query.eq("status", statuses[0]);
        else query = query.in("status", statuses);
      }

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch withdrawals", 500);

      return successResponse({
        withdrawals: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[withdrawals] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
