/**
 * Admin Dashboard Edge Function — Quiz4Win
 *
 * GET /admin/dashboard/summary — Real-time KPI snapshot (API #66)
 *
 * Rule compliance: R-01, R-03, admin-only
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/dashboard\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    if (path === "summary" && req.method === "GET") {
      // Run aggregate queries in parallel
      const [
        usersRes,
        activeGamesRes,
        todayTxRes,
        pendingWithdrawalsRes,
        pendingKycRes,
        openTicketsRes,
        amlFlagsRes,
      ] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }),
        admin.from("games").select("id", { count: "exact", head: true }).in("status", ["live", "active"]),
        admin.from("transactions").select("amount", { count: "exact" }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
        admin.from("withdrawals").select("id, amount", { count: "exact" }).eq("status", "pending"),
        admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
        admin.from("aml_flags").select("id", { count: "exact", head: true }).eq("status", "flagged"),
      ]);

      // Sum today's transactions (R-02: integer cents)
      const todayVolume = (todayTxRes.data ?? []).reduce((sum: number, tx: { amount: number }) => sum + (tx.amount ?? 0), 0);
      const pendingWithdrawalVolume = (pendingWithdrawalsRes.data ?? []).reduce((sum: number, w: { amount: number }) => sum + (w.amount ?? 0), 0);

      return successResponse({
        summary: {
          total_users: usersRes.count ?? 0,
          active_games: activeGamesRes.count ?? 0,
          today_transaction_count: todayTxRes.count ?? 0,
          today_transaction_volume_cents: todayVolume,
          pending_withdrawals: pendingWithdrawalsRes.count ?? 0,
          pending_withdrawal_volume_cents: pendingWithdrawalVolume,
          pending_kyc: pendingKycRes.count ?? 0,
          open_support_tickets: openTicketsRes.count ?? 0,
          aml_flags_pending: amlFlagsRes.count ?? 0,
          generated_at: new Date().toISOString(),
        },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-dashboard] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
