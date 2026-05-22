/**
 * Wallet Edge Function — Quiz4Win
 *
 * GET /wallet/balance       — Fetch current wallet balance (API #17)
 * GET /wallet/transactions  — Paginated transaction history (API #18)
 *
 * Rule compliance: R-01, R-02 (monetary values as integer cents), R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/wallet\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /wallet/balance
    if (path === "balance" && req.method === "GET") {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("wallet_balance, currency")
        .eq("id", user.id)
        .single();

      if (error || !profile) return errorResponse("wallet_not_found", 404);

      return successResponse({
        balance: profile.wallet_balance ?? 0, // stored as integer cents (R-02)
        currency: profile.currency ?? "USD",
        formatted: `${((profile.wallet_balance ?? 0) / 100).toFixed(2)}`,
      });
    }

    // GET /wallet/transactions
    if (path === "transactions" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const type = url.searchParams.get("type"); // topup|withdrawal|prize|entry_fee|refund
      const offset = (page - 1) * limit;

      let query = supabase
        .from("transactions")
        .select("id, type, amount, currency, status, description, reference_id, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (type) {
        const types = type.split("|").filter(Boolean);
        if (types.length === 1) {
          query = query.eq("type", types[0]);
        } else {
          query = query.in("type", types);
        }
      }

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch transactions", 500);

      return successResponse({
        transactions: data ?? [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[wallet] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
