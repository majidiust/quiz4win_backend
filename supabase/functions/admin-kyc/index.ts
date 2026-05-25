/**
 * Admin KYC Queue Edge Function — Quiz4Win
 *
 * GET /admin/kyc/pending — List pending KYC submissions (API #81)
 * GET /admin/kyc/stats   — Queue stats: pending/verified/rejected counts, avg review time, rejection rate (row 112)
 * GET /admin/kyc/export  — CSV export for compliance reporting (row 113)
 *
 * Rule compliance: R-01, R-03, admin-only
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/kyc\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "support"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/kyc/pending
    if (path === "pending" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;

      const { data, error, count } = await admin
        .from("kyc_requests")
        .select(
          "id, user_id, document_type:doc_type, id_front_url:front_image_url, id_back_url:back_image_url, selfie_url, submitted_at, profiles!user_id(name, email, nationality, date_of_birth)",
          { count: "exact" },
        )
        .eq("status", "pending")
        .order("submitted_at", { ascending: true }) // oldest first
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to fetch pending KYC", 500);

      return successResponse({
        kyc_queue: data ?? [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
      });
    }

    // GET /admin/kyc/export — CSV (row 113)
    if (path === "export" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let q = admin
        .from("kyc_requests")
        .select("id, user_id, document_type:doc_type, status, rejection_reason, submitted_at, reviewed_at, reviewed_by, profiles!user_id(name, email, nationality, date_of_birth)")
        .order("submitted_at", { ascending: false })
        .limit(10000);
      if (status) q = q.eq("status", status);
      if (from) q = q.gte("submitted_at", from);
      if (to) q = q.lte("submitted_at", to);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export KYC", 500);
      type Row = { id: string; user_id: string; document_type: string; status: string; rejection_reason: string | null; submitted_at: string; reviewed_at: string | null; reviewed_by: string | null; profiles: { name: string; email: string; nationality: string | null; date_of_birth: string | null } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "kyc_id", value: (r) => r.id },
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "nationality", value: (r) => r.profiles?.nationality ?? null },
        { header: "date_of_birth", value: (r) => r.profiles?.date_of_birth ?? null },
        { header: "document_type", value: (r) => r.document_type },
        { header: "status", value: (r) => r.status },
        { header: "submitted_at", value: (r) => r.submitted_at },
        { header: "reviewed_at", value: (r) => r.reviewed_at },
        { header: "reviewed_by", value: (r) => r.reviewed_by },
        { header: "rejection_reason", value: (r) => r.rejection_reason },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "kyc_exported", target_type: "kyc", details: { count: rows.length, filters: { status, from, to } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `kyc-${todayStamp()}.csv`);
    }

    // GET /admin/kyc/stats
    if (path === "stats" && req.method === "GET") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [pending, verified, rejected, recent] = await Promise.all([
        admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "verified"),
        admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "rejected"),
        admin.from("kyc_requests").select("submitted_at, reviewed_at, status").gte("reviewed_at", since).not("reviewed_at", "is", null),
      ]);

      const reviewed = (recent.data ?? []) as Array<{ submitted_at: string; reviewed_at: string; status: string }>;
      const totalMs = reviewed.reduce((acc, r) => acc + (new Date(r.reviewed_at).getTime() - new Date(r.submitted_at).getTime()), 0);
      const avgReviewMs = reviewed.length ? totalMs / reviewed.length : 0;
      const rejectedCount = reviewed.filter((r) => r.status === "rejected").length;
      const rejectionRate = reviewed.length ? rejectedCount / reviewed.length : 0;

      return successResponse({
        pending: pending.count ?? 0,
        verified: verified.count ?? 0,
        rejected: rejected.count ?? 0,
        avg_review_seconds: Math.round(avgReviewMs / 1000),
        rejection_rate_30d: Number(rejectionRate.toFixed(4)),
        reviewed_30d: reviewed.length,
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-kyc] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
