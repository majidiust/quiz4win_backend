/**
 * Admin KYC Queue Edge Function — Quiz4Win
 *
 * GET /admin/kyc/pending — List pending KYC submissions (API #81)
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

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-kyc] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
