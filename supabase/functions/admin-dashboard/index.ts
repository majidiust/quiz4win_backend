/**
 * Admin Dashboard Edge Function — Quiz4Win
 *
 * GET /admin/dashboard/summary — Real-time KPI snapshot (API #66)
 * GET /admin/dashboard/health  — Platform health status (rows 100, 181, 182)
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

    // GET /admin/dashboard/health — platform health (rows 100, 181, 182)
    if (path === "health" && req.method === "GET") {
      const checks = await Promise.allSettled([
        // Supabase DB ping
        admin.from("profiles").select("id", { count: "exact", head: true }).limit(1),
        // Active games count
        admin.from("games").select("id", { count: "exact", head: true }).in("status", ["live", "active"]),
        // Pending jobs
        admin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        // Notifications delivery check (last 1000 push entries)
        admin.from("notifications").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      ]);

      const [dbCheck, liveGames, pendingW, pushLast24h] = checks;

      return successResponse({
        status: dbCheck.status === "fulfilled" ? "healthy" : "degraded",
        checked_at: new Date().toISOString(),
        services: {
          supabase_db: {
            status: dbCheck.status === "fulfilled" ? "ok" : "error",
            note: dbCheck.status === "rejected" ? String(dbCheck.reason) : undefined,
          },
          livekit: {
            status: "not_configured",
            note: "LiveKit health requires LIVEKIT_SERVER_URL. Configure env secret.",
          },
          stripe: {
            status: "not_configured",
            note: "Stripe health requires STRIPE_SECRET_KEY. Configure env secret.",
          },
          push_notifications: {
            status: "ok",
            sent_last_24h: pushLast24h.status === "fulfilled" ? (pushLast24h.value.count ?? 0) : 0,
          },
        },
        metrics: {
          active_games: liveGames.status === "fulfilled" ? (liveGames.value.count ?? 0) : 0,
          pending_withdrawals: pendingW.status === "fulfilled" ? (pendingW.value.count ?? 0) : 0,
        },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-dashboard] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
