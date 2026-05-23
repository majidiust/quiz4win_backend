/**
 * Admin Finance Edge Function — Quiz4Win
 *
 * GET  /admin/finance/withdrawals/pending      — Pending queue (API #114)
 * GET  /admin/finance/withdrawals/:id          — Detail (API #115)
 * POST /admin/finance/withdrawals/:id/approve  — Approve (API #116)
 * POST /admin/finance/withdrawals/:id/reject   — Reject (API #117)
 * POST /admin/finance/withdrawals/:id/complete — Complete (API #118)
 * GET  /admin/finance/transactions             — All transactions (API #119)
 * GET  /admin/finance/aml-flags                — AML flags (API #120)
 * POST /admin/finance/aml-flags/:id/review     — Review flag (API #121)
 * GET  /admin/finance/withdrawals/stats        — Queue stats (row 114)
 * GET  /admin/finance/aml-flags/stats          — AML stats (row 119)
 *
 * Rule compliance: R-01, R-02, R-03, R-05 (append-only), R-08
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/finance\/?/, "").split("/").filter(Boolean);
  const resource = parts[0] ?? null; // withdrawals | transactions | aml-flags
  const resourceId = parts[1] ?? null;
  const action = parts[2] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "finance"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/finance/transactions
    if (resource === "transactions" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const type = url.searchParams.get("type");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const offset = (page - 1) * limit;

      let query = admin.from("transactions").select("id, user_id, type, amount, currency, status, description, created_at, profiles!user_id(name, email)", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (type) query = query.eq("type", type);
      if (from) query = query.gte("created_at", from);
      if (to) query = query.lte("created_at", to);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch transactions", 500);
      return successResponse({ transactions: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/finance/aml-flags
    if (resource === "aml-flags" && !resourceId && req.method === "GET") {
      const { data, error } = await admin.from("aml_flags").select("*, transactions(amount, type, created_at), profiles!user_id(name, email)").eq("status", "flagged").order("created_at", { ascending: true });
      if (error) return errorResponse("Failed to fetch AML flags", 500);
      return successResponse({ flags: data ?? [] });
    }

    // GET /admin/finance/aml-flags/stats
    if (resource === "aml-flags" && resourceId === "stats" && req.method === "GET") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [openCount, escalatedCount, clearedCount, openSum, recent] = await Promise.all([
        admin.from("aml_flags").select("id", { count: "exact", head: true }).eq("status", "open"),
        admin.from("aml_flags").select("id", { count: "exact", head: true }).eq("status", "escalated"),
        admin.from("aml_flags").select("id", { count: "exact", head: true }).eq("status", "cleared"),
        admin.from("aml_flags").select("total_24h_usd").eq("status", "open"),
        admin.from("aml_flags").select("flagged_at, reviewed_at").gte("reviewed_at", since).not("reviewed_at", "is", null),
      ]);
      const totalOpenUsd = ((openSum.data ?? []) as Array<{ total_24h_usd: string | number }>).reduce((a, r) => a + Number(r.total_24h_usd ?? 0), 0);
      const reviewed = (recent.data ?? []) as Array<{ flagged_at: string; reviewed_at: string }>;
      const totalMs = reviewed.reduce((a, r) => a + (new Date(r.reviewed_at).getTime() - new Date(r.flagged_at).getTime()), 0);
      const avgResolutionSeconds = reviewed.length ? Math.round(totalMs / 1000 / reviewed.length) : 0;
      return successResponse({
        open: openCount.count ?? 0,
        escalated: escalatedCount.count ?? 0,
        cleared: clearedCount.count ?? 0,
        total_open_usd: Number(totalOpenUsd.toFixed(2)),
        avg_resolution_seconds: avgResolutionSeconds,
        resolved_30d: reviewed.length,
      });
    }

    // POST /admin/finance/aml-flags/:id/review
    if (resource === "aml-flags" && resourceId && action === "review" && req.method === "POST") {
      const { decision, notes } = await req.json();
      if (!["clear", "escalate"].includes(decision)) return errorResponse("decision must be clear or escalate", 400);

      const newStatus = decision === "clear" ? "cleared" : "escalated";
      const { error } = await admin.from("aml_flags").update({ status: newStatus, reviewed_by: user.id, reviewed_at: new Date().toISOString(), notes: notes ?? null }).eq("id", resourceId);
      if (error) return errorResponse(sanitizeError(error), 500);

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: `aml_flag_${decision}d`, target_type: "aml_flag", target_id: resourceId, details: { notes }, created_at: new Date().toISOString() });
      return successResponse({ message: `AML flag ${decision}d` });
    }

    // GET /admin/finance/withdrawals/stats
    if (resource === "withdrawals" && resourceId === "stats" && req.method === "GET") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [pending, processing, completed, rejected, pendingSum, recent] = await Promise.all([
        admin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        admin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "processing"),
        admin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "completed"),
        admin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "rejected"),
        admin.from("withdrawals").select("amount").eq("status", "pending"),
        admin.from("withdrawals").select("requested_at, completed_at").gte("completed_at", since).not("completed_at", "is", null),
      ]);
      const totalPendingUsd = ((pendingSum.data ?? []) as Array<{ amount: string | number }>).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      const completedRows = (recent.data ?? []) as Array<{ requested_at: string; completed_at: string }>;
      const totalMs = completedRows.reduce((a, r) => a + (new Date(r.completed_at).getTime() - new Date(r.requested_at).getTime()), 0);
      const avgProcessingSeconds = completedRows.length ? Math.round(totalMs / 1000 / completedRows.length) : 0;
      return successResponse({
        pending: pending.count ?? 0,
        processing: processing.count ?? 0,
        completed: completed.count ?? 0,
        rejected: rejected.count ?? 0,
        total_pending_usd: Number(totalPendingUsd.toFixed(2)),
        avg_processing_seconds: avgProcessingSeconds,
        completed_30d: completedRows.length,
      });
    }

    // GET /admin/finance/withdrawals/pending
    if (resource === "withdrawals" && resourceId === "pending" && req.method === "GET") {
      const { data, error } = await admin.from("withdrawals").select("*, profiles!user_id(name, email, kyc_status)").eq("status", "pending").order("requested_at", { ascending: true });
      if (error) return errorResponse("Failed to fetch pending withdrawals", 500);
      return successResponse({ withdrawals: data ?? [] });
    }

    // GET /admin/finance/withdrawals/:id
    if (resource === "withdrawals" && resourceId && resourceId !== "pending" && !action && req.method === "GET") {
      const { data, error } = await admin.from("withdrawals").select("*, profiles!user_id(name, email, kyc_status, nationality)").eq("id", resourceId).single();
      if (error || !data) return errorResponse("withdrawal_not_found", 404);
      return successResponse({ withdrawal: data });
    }

    // POST /admin/finance/withdrawals/:id/approve
    if (resource === "withdrawals" && resourceId && action === "approve" && req.method === "POST") {
      await admin.from("withdrawals").update({ status: "approved", processed_by: user.id, processed_at: new Date().toISOString() }).eq("id", resourceId).eq("status", "pending");
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "withdrawal_approved", target_type: "withdrawal", target_id: resourceId, created_at: new Date().toISOString() });
      return successResponse({ message: "Withdrawal approved" });
    }

    // POST /admin/finance/withdrawals/:id/reject
    if (resource === "withdrawals" && resourceId && action === "reject" && req.method === "POST") {
      const { reason } = await req.json();
      if (!reason) return errorResponse("reason is required", 400);

      const { data: w } = await admin.from("withdrawals").select("amount, user_id").eq("id", resourceId).single();
      if (!w) return errorResponse("withdrawal_not_found", 404);

      await admin.from("withdrawals").update({ status: "rejected", rejection_reason: reason, processed_by: user.id, processed_at: new Date().toISOString() }).eq("id", resourceId);
      // Refund wallet
      await admin.rpc("credit_wallet", { p_user_id: w.user_id, p_amount_cents: w.amount, p_reference_id: resourceId, p_type: "refund" });
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "withdrawal_rejected", target_type: "withdrawal", target_id: resourceId, details: { reason }, created_at: new Date().toISOString() });
      return successResponse({ message: "Withdrawal rejected and amount refunded" });
    }

    // POST /admin/finance/withdrawals/:id/complete
    if (resource === "withdrawals" && resourceId && action === "complete" && req.method === "POST") {
      const { transaction_ref } = await req.json().catch(() => ({}));
      await admin.from("withdrawals").update({ status: "completed", transaction_reference: transaction_ref ?? null, processed_at: new Date().toISOString() }).eq("id", resourceId).eq("status", "approved");
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "withdrawal_completed", target_type: "withdrawal", target_id: resourceId, created_at: new Date().toISOString() });
      return successResponse({ message: "Withdrawal marked as completed" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-finance] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
