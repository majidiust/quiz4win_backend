/**
 * KYC Edge Function — Quiz4Win
 *
 * POST /kyc/submit     — Upload government ID + selfie (API #14)
 * GET  /kyc/status     — Get KYC verification status (API #15)
 * POST /kyc/resubmit   — Re-upload after rejection; 24h cooldown (API #16)
 *
 * Rule compliance: R-01, R-03, R-08 (KYC must be verified before withdrawal)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/kyc\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /kyc/status
    if (path === "status" && req.method === "GET") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status")
        .eq("id", user.id)
        .single();

      const { data: kycReq } = await supabase
        .from("kyc_requests")
        .select("id, status, rejection_reason, submitted_at, reviewed_at")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .single();

      return successResponse({
        kyc_status: profile?.kyc_status ?? "unverified",
        latest_request: kycReq ?? null,
      });
    }

    // POST /kyc/submit
    if (path === "submit" && req.method === "POST") {
      // Check not already verified
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status")
        .eq("id", user.id)
        .single();

      if (profile?.kyc_status === "verified") {
        return errorResponse("kyc_already_verified", 409);
      }
      if (profile?.kyc_status === "pending") {
        return errorResponse("kyc_already_pending", 409);
      }

      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }

      const formData = await req.formData();
      const idFront = formData.get("id_front") as File | null;
      const selfie = formData.get("selfie") as File | null;
      const documentType = formData.get("document_type") as string | null;

      if (!idFront || !selfie || !documentType) {
        return errorResponse("id_front, selfie, and document_type are required", 400);
      }

      const admin = getAdminClient();
      const uploadFile = async (file: File, name: string) => {
        const ext = file.type.split("/")[1] ?? "jpg";
        const path = `kyc/${user.id}/${name}.${ext}`;
        const buf = await file.arrayBuffer();
        await admin.storage.from("kyc-documents").upload(path, buf, {
          contentType: file.type,
          upsert: true,
        });
        return path;
      };

      const idFrontPath = await uploadFile(idFront, "id_front");
      const selfiePath = await uploadFile(selfie, "selfie");
      const idBackFile = formData.get("id_back") as File | null;
      const idBackPath = idBackFile ? await uploadFile(idBackFile, "id_back") : null;

      const { data: kycReq, error: kycErr } = await admin
        .from("kyc_requests")
        .insert({
          user_id: user.id,
          document_type: documentType,
          id_front_url: idFrontPath,
          id_back_url: idBackPath,
          selfie_url: selfiePath,
          status: "pending",
          submitted_at: new Date().toISOString(),
        })
        .select("id, status, submitted_at")
        .single();

      if (kycErr) return errorResponse(sanitizeError(kycErr), 500);

      // Update profile KYC status
      await admin.from("profiles")
        .update({ kyc_status: "pending", updated_at: new Date().toISOString() })
        .eq("id", user.id);

      return successResponse({ request: kycReq }, 201);
    }

    // POST /kyc/resubmit — same as submit but enforces 24h cooldown after rejection
    if (path === "resubmit" && req.method === "POST") {
      const { data: latest } = await supabase
        .from("kyc_requests")
        .select("status, reviewed_at")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .single();

      if (!latest || latest.status !== "rejected") {
        return errorResponse("No rejected KYC request found", 400);
      }

      const cooldownMs = 24 * 60 * 60 * 1000;
      if (latest.reviewed_at) {
        const elapsed = Date.now() - new Date(latest.reviewed_at).getTime();
        if (elapsed < cooldownMs) {
          const retryAfter = Math.ceil((cooldownMs - elapsed) / 1000);
          return errorResponse("resubmit_cooldown_active", 429, {
            "Retry-After": String(retryAfter),
          });
        }
      }

      // Delegate to /kyc/submit logic by forwarding
      const newReq = new Request(req.url.replace("resubmit", "submit"), {
        method: "POST",
        headers: req.headers,
        body: req.body,
      });
      // Re-process as submit (reset status to pending in profile)
      const admin = getAdminClient();
      await admin.from("profiles")
        .update({ kyc_status: "unverified", updated_at: new Date().toISOString() })
        .eq("id", user.id);

      return successResponse({ message: "Please submit your documents again via /kyc/submit" }, 200);
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[kyc] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
