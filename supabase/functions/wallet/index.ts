/**
 * Wallet Edge Function — Quiz4Win
 *
 * GET  /wallet/balance        — All three balances (wallet, earnings, score) (API #17)
 * GET  /wallet/transactions   — Paginated money transaction history (API #18)
 * POST /wallet/transfer       — Transfer earnings_balance → wallet_balance (API #19)
 * GET  /wallet/score-history  — Paginated score_events ledger (API #20)
 *
 * Rule compliance: R-01, R-02 (monetary values as NUMERIC dollars), R-03
 * INV-15: earnings never auto-credited to wallet — transfer is explicit.
 * INV-16: once transferred, money is play-only (not withdrawable).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/wallet\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /wallet/balance — returns all three balances
    if (path === "balance" && req.method === "GET") {
      let { data: profile } = await supabase
        .from("profiles")
        .select("wallet_balance, earnings_balance, score_balance")
        .eq("id", user.id)
        .maybeSingle();

      // Fallback when anon read is RLS-denied; scoped to the JWT subject.
      if (!profile) {
        const admin = getAdminClient();
        const r = await admin
          .from("profiles")
          .select("wallet_balance, earnings_balance, score_balance")
          .eq("id", user.id)
          .maybeSingle();
        profile = r.data;
      }
      if (!profile) return errorResponse("wallet_not_found", 404);

      const walletBalance   = Number(profile.wallet_balance   ?? 0);
      const earningsBalance = Number(profile.earnings_balance ?? 0);
      const scoreBalance    = Number(profile.score_balance    ?? 0);
      return successResponse({
        wallet_balance:   walletBalance,
        earnings_balance: earningsBalance,
        score_balance:    scoreBalance,
        // legacy field — kept for backward compat
        balance:   walletBalance,
        currency:  "EUR",
        formatted: walletBalance.toFixed(2),
      });
    }

    // GET /wallet/transactions — paginated money ledger
    if (path === "transactions" && req.method === "GET") {
      const page   = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
      const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const type   = url.searchParams.get("type");
      const offset = (page - 1) * limit;

      let query = supabase
        .from("transactions")
        .select("id, type, amount, status, description, reference_id:reference, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (type) {
        const types = type.split("|").filter(Boolean);
        query = types.length === 1 ? query.eq("type", types[0]) : query.in("type", types);
      }

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch transactions", 500);

      return successResponse({
        transactions: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    // POST /wallet/transfer — transfer earnings → wallet (INV-15 / INV-16)
    if (path === "transfer" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const amount = typeof body.amount === "number" ? body.amount
                   : typeof body.amount === "string" ? parseFloat(body.amount)
                   : NaN;

      if (!amount || isNaN(amount) || amount <= 0) {
        return errorResponse("invalid_amount", 400);
      }

      const admin = getAdminClient();
      const { data: txId, error: rpcErr } = await admin
        .rpc("transfer_earnings_to_wallet", { p_user_id: user.id, p_amount: amount });

      if (rpcErr) {
        if (rpcErr.message?.includes("insufficient_earnings")) {
          return errorResponse("insufficient_earnings", 400);
        }
        console.error("[wallet][transfer] rpc error:", rpcErr.message);
        return errorResponse("transfer_failed", 500);
      }

      // Return updated balances.
      const { data: updated } = await admin
        .from("profiles")
        .select("wallet_balance, earnings_balance")
        .eq("id", user.id)
        .maybeSingle();

      return successResponse({
        wallet_balance:   Number(updated?.wallet_balance   ?? 0),
        earnings_balance: Number(updated?.earnings_balance ?? 0),
        transaction_id:   txId,
      });
    }

    // GET /wallet/score-history — paginated score events ledger
    if (path === "score-history" && req.method === "GET") {
      const page   = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
      const limit  = Math.min(50,  Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const offset = (page - 1) * limit;

      // score_balance from profile (current total).
      let profileData = null as Record<string, unknown> | null;
      { const r = await supabase.from("profiles").select("score_balance").eq("id", user.id).maybeSingle();
        if (r.data) profileData = r.data as Record<string, unknown>;
        else {
          const admin = getAdminClient();
          const r2 = await admin.from("profiles").select("score_balance").eq("id", user.id).maybeSingle();
          profileData = r2.data as Record<string, unknown> | null;
        }
      }

      const { data: events, error, count } = await supabase
        .from("score_events")
        .select("id, game_id, points, reason, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to fetch score history", 500);

      return successResponse({
        score_balance: Number(profileData?.score_balance ?? 0),
        events:        events ?? [],
        pagination:    { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[wallet] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
