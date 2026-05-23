/**
 * Admin KYC Queue Edge Function — Quiz4Win
 *
 * GET /admin/kyc/pending — List pending KYC submissions (API #81)
 * GET /admin/kyc/stats   — Queue stats: pending/verified/rejected counts, avg review time, rejection rate (row 112)
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
          "id, user_id, document_type, id_front_url, id_back_url, selfie_url, submitted_at, profiles!user_id(name, email, nationality, date_of_birth)",
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
