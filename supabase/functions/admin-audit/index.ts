/**
 * Admin Audit Log Edge Function — Quiz4Win
 *
 * GET /admin/audit-log        — Immutable admin audit log (API #152)
 * GET /admin/audit-log/stats  — Most active admins, top actions, last-24h count (row 172)
 * GET /admin/audit-log/export — CSV export (row 171)
 *
 * Rule compliance: R-01, R-03, R-05 (append-only), super_admin only
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/audit-log\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  // Audit log is super_admin only to prevent tampering detection avoidance
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/audit-log/export — CSV (row 171)
    if (path === "export" && req.method === "GET") {
      const adminId = url.searchParams.get("admin_id");
      const actionFilter = url.searchParams.get("action");
      const targetType = url.searchParams.get("target_type");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin.from("admin_audit_log").select("id, admin_id, action, target_type, target_id, details, created_at, admin_users!admin_id(name, email, role)").order("created_at", { ascending: false }).limit(50000);
      if (adminId) q = q.eq("admin_id", adminId);
      if (actionFilter) q = q.ilike("action", `%${actionFilter}%`);
      if (targetType) q = q.eq("target_type", targetType);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export audit log", 500);
      type Row = { id: string; admin_id: string; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: string; admin_users: { name: string; email: string; role: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "event_id", value: (r) => r.id },
        { header: "admin_id", value: (r) => r.admin_id },
        { header: "admin_name", value: (r) => r.admin_users?.name ?? null },
        { header: "admin_email", value: (r) => r.admin_users?.email ?? null },
        { header: "admin_role", value: (r) => r.admin_users?.role ?? null },
        { header: "action", value: (r) => r.action },
        { header: "target_type", value: (r) => r.target_type },
        { header: "target_id", value: (r) => r.target_id },
        { header: "details", value: (r) => r.details ? JSON.stringify(r.details) : null },
        { header: "created_at", value: (r) => r.created_at },
      ]);
      // Note: do NOT audit the audit-log export itself (would create infinite-growth audit trail of audits)
      return csvResponse(csv, `audit-log-${todayStamp()}.csv`);
    }

    // GET /admin/audit-log/stats
    if (path === "stats" && req.method === "GET") {
      const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [total, last24h, recent] = await Promise.all([
        admin.from("admin_audit_log").select("id", { count: "exact", head: true }),
        admin.from("admin_audit_log").select("id", { count: "exact", head: true }).gte("created_at", day),
        admin.from("admin_audit_log").select("admin_id, action, entity_type").gte("created_at", since30d),
      ]);
      const rows = (recent.data ?? []) as Array<{ admin_id: string; action: string; entity_type: string | null }>;
      const byAdmin: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      const byEntity: Record<string, number> = {};
      for (const r of rows) {
        byAdmin[r.admin_id] = (byAdmin[r.admin_id] ?? 0) + 1;
        byAction[r.action] = (byAction[r.action] ?? 0) + 1;
        if (r.entity_type) byEntity[r.entity_type] = (byEntity[r.entity_type] ?? 0) + 1;
      }
      const top = (m: Record<string, number>, n: number) =>
        Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
      return successResponse({
        total: total.count ?? 0,
        last_24h: last24h.count ?? 0,
        events_30d: rows.length,
        top_admins: top(byAdmin, 5),
        top_actions: top(byAction, 5),
        top_entities: top(byEntity, 5),
      });
    }

    if (!path && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const adminId = url.searchParams.get("admin_id");
      const action = url.searchParams.get("action");
      const targetType = url.searchParams.get("target_type");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const offset = (page - 1) * limit;

      let query = admin
        .from("admin_audit_log")
        .select(
          "id, admin_id, action, target_type, target_id, details, created_at, admin_users!admin_id(name, email, role)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (adminId) query = query.eq("admin_id", adminId);
      if (action) query = query.ilike("action", `%${action}%`);
      if (targetType) query = query.eq("target_type", targetType);
      if (from) query = query.gte("created_at", from);
      if (to) query = query.lte("created_at", to);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch audit log", 500);

      return successResponse({
        audit_log: data ?? [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
        note: "Audit log is append-only and immutable (R-05)",
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-audit] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
