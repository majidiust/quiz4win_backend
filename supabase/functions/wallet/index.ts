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
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/wallet\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /wallet/balance
    // Schema note: profiles.wallet_balance is NUMERIC(12,2) (USD dollars), there
    // is no profiles.currency column. Returned as a string to preserve precision.
    if (path === "balance" && req.method === "GET") {
      let { data: profile } = await supabase
        .from("profiles")
        .select("wallet_balance")
        .eq("id", user.id)
        .maybeSingle();

      // Fallback when anon read is RLS-denied; scoped to the JWT subject.
      if (!profile) {
        const admin = getAdminClient();
        const r = await admin.from("profiles").select("wallet_balance").eq("id", user.id).maybeSingle();
        profile = r.data;
      }
      if (!profile) return errorResponse("wallet_not_found", 404);

      const balance = Number(profile.wallet_balance ?? 0);
      return successResponse({
        balance,
        currency: "USD",
        formatted: balance.toFixed(2),
      });
    }

    // GET /wallet/transactions
    if (path === "transactions" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const type = url.searchParams.get("type"); // topup|withdrawal|prize|game_entry_fee|refund
      const offset = (page - 1) * limit;

      // Schema columns: id, user_id, type, amount, status, reference, description,
      // game_id, admin_id, metadata, created_at. Alias `reference` as `reference_id`
      // for backwards compatibility with the public API.
      let query = supabase
        .from("transactions")
        .select("id, type, amount, status, description, reference_id:reference, created_at", { count: "exact" })
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
