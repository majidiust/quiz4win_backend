/**
 * Withdrawals Edge Function — Quiz4Win
 *
 * POST /withdrawals/request            — Submit withdrawal request (API #24)
 * GET  /withdrawals/:withdrawal_id     — Get withdrawal status (API #25)
 * GET  /withdrawals                    — List all withdrawals (API #26)
 *
 * Rule compliance: R-01, R-02, R-03, R-05 (append-only)
 * INV-05 (updated): KYC required ONLY for withdrawals > 1,000 EUR.
 * INV-15: Withdrawals debit earnings_balance (not wallet_balance).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

const MIN_WITHDRAWAL = 10;    // €10.00 minimum
const MAX_WITHDRAWAL = 10_000; // €10,000 maximum
const KYC_THRESHOLD  = 1_000; // €1,000 — KYC required above this (INV-05 updated)

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
      const body = await req.json().catch(() => ({}));
      const { amount, method, account_details } = body as Record<string, unknown>;

      const amountNum = typeof amount === "number" ? amount
                      : typeof amount === "string" ? parseFloat(amount as string)
                      : NaN;

      if (!amountNum || isNaN(amountNum) || amountNum < MIN_WITHDRAWAL) {
        return errorResponse(`minimum_withdrawal_${MIN_WITHDRAWAL}`, 400);
      }
      if (amountNum > MAX_WITHDRAWAL) {
        return errorResponse(`maximum_withdrawal_${MAX_WITHDRAWAL}`, 400);
      }
      if (!method || !account_details) {
        return errorResponse("method_and_account_details_required", 400);
      }

      // Fetch earnings balance + KYC status in one query.
      const admin = getAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("kyc_status, earnings_balance")
        .eq("id", user.id)
        .single();

      if (!profile) return errorResponse("profile_not_found", 404);

      // INV-05 (updated): KYC required only for amounts > KYC_THRESHOLD EUR.
      if (amountNum > KYC_THRESHOLD && profile.kyc_status !== "verified") {
        return errorResponse("kyc_required", 403);
      }

      const earningsDollars = Number(profile.earnings_balance ?? 0);
      if (amountNum > earningsDollars) {
        return errorResponse("insufficient_earnings", 400);
      }

      // Create the withdrawal record.
      const { data: withdrawal, error: wErr } = await admin
        .from("withdrawals")
        .insert({
          user_id:         user.id,
          amount:          amountNum,   // NUMERIC(12,2) dollars
          method,
          account_details,
          status:          "pending",
          requested_at:    new Date().toISOString(),
        })
        .select("id, amount, status, requested_at")
        .single();

      if (wErr) return errorResponse(sanitizeError(wErr), 500);

      // Debit earnings_balance atomically (R-05: append-only transaction row).
      const now = new Date().toISOString();
      await admin
        .from("profiles")
        .update({ earnings_balance: (earningsDollars - amountNum).toFixed(2), updated_at: now })
        .eq("id", user.id);

      await admin.from("transactions").insert({
        user_id:     user.id,
        type:        "withdrawal",
        amount:      amountNum.toFixed(2),
        status:      "pending",
        reference:   withdrawal.id,
        description: `Withdrawal request`,
        created_at:  now,
      });

      const { data: updated } = await admin
        .from("profiles")
        .select("earnings_balance")
        .eq("id", user.id)
        .maybeSingle();

      return successResponse({
        withdrawal,
        earnings_balance: Number(updated?.earnings_balance ?? 0),
        kyc_bypassed: amountNum <= KYC_THRESHOLD,
      }, 201);
    }

    // GET /withdrawals/:withdrawal_id
    if (rawPath && rawPath !== "request" && req.method === "GET") {
      const withdrawalId = rawPath;
      const { data, error } = await supabase
        .from("withdrawals")
        .select("id, amount, method, status, requested_at, completed_at, rejection_reason")
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
        .select("id, amount, method, status, requested_at, completed_at, rejection_reason", { count: "exact" })
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
