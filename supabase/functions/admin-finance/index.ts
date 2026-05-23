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
 * GET  /admin/finance/withdrawals/export       — Withdrawals CSV (row 116)
 * GET  /admin/finance/transactions/export      — Transactions CSV (row 117)
 * GET  /admin/finance/aml-flags/export         — AML CSV (row 120)
 * POST /admin/finance/withdrawals/bulk-approve  — Bulk approve withdrawals (row 115)
 *
 * Rule compliance: R-01, R-02, R-03, R-05 (append-only), R-08
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

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
    // POST /admin/finance/withdrawals/bulk-approve — batch approve (row 115)
    if (resource === "withdrawals" && resourceId === "bulk-approve" && req.method === "POST") {
      const { withdrawal_ids } = await req.json();
      if (!Array.isArray(withdrawal_ids) || withdrawal_ids.length === 0) return errorResponse("withdrawal_ids array is required", 400);
      if (withdrawal_ids.length > 100) return errorResponse("Maximum 100 withdrawals per batch", 400);

      // Pre-check that all are still pending and have KYC verified (R-08)
      const { data: rows } = await admin.from("withdrawals").select("id, user_id, status, profiles!user_id(kyc_status)").in("id", withdrawal_ids);
      type R = { id: string; user_id: string; status: string; profiles: { kyc_status: string } | null };
      const list = (rows ?? []) as unknown as R[];
      const eligible = list.filter((r) => r.status === "pending" && r.profiles?.kyc_status === "verified").map((r) => r.id);
      const skipped = list.filter((r) => !eligible.includes(r.id)).map((r) => ({ id: r.id, reason: r.profiles?.kyc_status !== "verified" ? "kyc_not_verified" : `status:${r.status}` }));

      if (eligible.length === 0) return successResponse({ approved: 0, skipped, message: "No eligible withdrawals" });

      await admin.from("withdrawals").update({ status: "approved", processed_by: user.id, processed_at: new Date().toISOString() }).in("id", eligible);
      const auditRows = eligible.map((id) => ({ admin_id: user.id, action: "withdrawal_approved", target_type: "withdrawal", target_id: id, details: { batch: true }, created_at: new Date().toISOString() }));
      await admin.from("admin_audit_log").insert(auditRows);
      return successResponse({ approved: eligible.length, skipped, message: `${eligible.length} withdrawal(s) approved` });
    }

    // GET /admin/finance/transactions/export — CSV (row 117)
    if (resource === "transactions" && resourceId === "export" && req.method === "GET") {
      const type = url.searchParams.get("type");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin.from("transactions").select("id, user_id, type, amount, currency, status, description, reference_id, created_at, profiles!user_id(name, email)").order("created_at", { ascending: false }).limit(50000);
      if (type) q = q.eq("type", type);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export transactions", 500);
      type Row = { id: string; user_id: string; type: string; amount: number; currency: string; status: string; description: string | null; reference_id: string | null; created_at: string; profiles: { name: string; email: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "transaction_id", value: (r) => r.id },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "type", value: (r) => r.type },
        { header: "amount_cents", value: (r) => r.amount },
        { header: "currency", value: (r) => r.currency },
        { header: "status", value: (r) => r.status },
        { header: "reference_id", value: (r) => r.reference_id },
        { header: "description", value: (r) => r.description },
        { header: "created_at", value: (r) => r.created_at },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "transactions_exported", target_type: "transactions", details: { count: rows.length, filters: { type, from, to } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `transactions-${todayStamp()}.csv`);
    }

    // GET /admin/finance/withdrawals/export — CSV (row 116)
    if (resource === "withdrawals" && resourceId === "export" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin.from("withdrawals").select("id, user_id, amount, currency, status, requested_at, processed_at, completed_at, processed_by, transaction_reference, rejection_reason, profiles!user_id(name, email, kyc_status)").order("requested_at", { ascending: false }).limit(50000);
      if (status) q = q.eq("status", status);
      if (from) q = q.gte("requested_at", from);
      if (to) q = q.lte("requested_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export withdrawals", 500);
      type Row = { id: string; user_id: string; amount: number; currency: string; status: string; requested_at: string; processed_at: string | null; completed_at: string | null; processed_by: string | null; transaction_reference: string | null; rejection_reason: string | null; profiles: { name: string; email: string; kyc_status: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "withdrawal_id", value: (r) => r.id },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "kyc_status", value: (r) => r.profiles?.kyc_status ?? null },
        { header: "amount_cents", value: (r) => r.amount },
        { header: "currency", value: (r) => r.currency },
        { header: "status", value: (r) => r.status },
        { header: "requested_at", value: (r) => r.requested_at },
        { header: "processed_at", value: (r) => r.processed_at },
        { header: "completed_at", value: (r) => r.completed_at },
        { header: "processed_by", value: (r) => r.processed_by },
        { header: "transaction_reference", value: (r) => r.transaction_reference },
        { header: "rejection_reason", value: (r) => r.rejection_reason },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "withdrawals_exported", target_type: "withdrawals", details: { count: rows.length, filters: { status, from, to } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `withdrawals-${todayStamp()}.csv`);
    }

    // GET /admin/finance/aml-flags/export — CSV (row 120)
    if (resource === "aml-flags" && resourceId === "export" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin.from("aml_flags").select("id, user_id, withdrawal_id, total_24h_usd, status, notes, flagged_at, reviewed_at, reviewed_by, profiles!aml_flags_user_id_fkey(name, email, nationality)").order("flagged_at", { ascending: false }).limit(50000);
      if (status) q = q.eq("status", status);
      if (from) q = q.gte("flagged_at", from);
      if (to) q = q.lte("flagged_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export AML flags", 500);
      type Row = { id: string; user_id: string; withdrawal_id: string | null; total_24h_usd: number | string; status: string; notes: string | null; flagged_at: string; reviewed_at: string | null; reviewed_by: string | null; profiles: { name: string; email: string; nationality: string | null } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "flag_id", value: (r) => r.id },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "nationality", value: (r) => r.profiles?.nationality ?? null },
        { header: "withdrawal_id", value: (r) => r.withdrawal_id },
        { header: "total_24h_usd", value: (r) => r.total_24h_usd },
        { header: "status", value: (r) => r.status },
        { header: "flagged_at", value: (r) => r.flagged_at },
        { header: "reviewed_at", value: (r) => r.reviewed_at },
        { header: "reviewed_by", value: (r) => r.reviewed_by },
        { header: "notes", value: (r) => r.notes },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "aml_exported", target_type: "aml_flags", details: { count: rows.length, filters: { status, from, to } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `aml-${todayStamp()}.csv`);
    }

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
