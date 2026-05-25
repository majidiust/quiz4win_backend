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
import { uploadObject } from "../_shared/s3.ts";

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
      console.log(`[kyc] submit start — user=${user.id}`);

      // Step 1 — fetch current profile kyc_status
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("kyc_status")
        .eq("id", user.id)
        .single();

      if (profileErr) {
        console.error(`[kyc] step1 profile fetch error — user=${user.id}`, profileErr);
        return errorResponse(sanitizeError(profileErr), 500);
      }
      console.log(`[kyc] step1 profile fetched — kyc_status=${profile?.kyc_status ?? "null"}`);

      if (profile?.kyc_status === "verified") {
        console.log(`[kyc] step1 early-exit kyc_already_verified — user=${user.id}`);
        return errorResponse("kyc_already_verified", 409);
      }
      if (profile?.kyc_status === "pending") {
        console.log(`[kyc] step1 early-exit kyc_already_pending — user=${user.id}`);
        return errorResponse("kyc_already_pending", 409);
      }

      // Step 2 — validate content-type and parse form fields
      const contentType = req.headers.get("content-type") ?? "";
      console.log(`[kyc] step2 content-type="${contentType}"`);
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch (fErr) {
        console.error(`[kyc] step2 formData parse failed — user=${user.id}`, fErr);
        return errorResponse("Failed to parse multipart form data", 400);
      }

      const idFront = formData.get("id_front") as File | null;
      const selfie = formData.get("selfie") as File | null;
      const documentType = formData.get("document_type") as string | null;
      const idBackFile = formData.get("id_back") as File | null;
      console.log(
        `[kyc] step2 fields — document_type=${documentType ?? "null"} ` +
        `id_front=${idFront ? `${idFront.name} ${idFront.size}B ${idFront.type}` : "missing"} ` +
        `selfie=${selfie ? `${selfie.name} ${selfie.size}B ${selfie.type}` : "missing"} ` +
        `id_back=${idBackFile ? `${idBackFile.name} ${idBackFile.size}B` : "none"}`,
      );

      if (!idFront || !selfie || !documentType) {
        return errorResponse("id_front, selfie, and document_type are required", 400);
      }

      // Step 3 — S3 uploads
      const admin = getAdminClient();
      const uploadFile = async (file: File, name: string): Promise<string> => {
        const ext = file.type.split("/")[1] ?? "jpg";
        const key = `kyc/${user.id}/${name}.${ext}`;
        console.log(`[kyc] step3 uploading ${name} → key=${key} size=${file.size}B type=${file.type}`);
        const buf = await file.arrayBuffer();
        // Private — readable only via presigned URLs minted by the admin panel.
        await uploadObject(key, buf, file.type, "private");
        console.log(`[kyc] step3 uploaded ${name} OK`);
        return key;
      };

      const idFrontPath = await uploadFile(idFront, "id_front");
      const selfiePath = await uploadFile(selfie, "selfie");
      const idBackPath = idBackFile ? await uploadFile(idBackFile, "id_back") : null;
      console.log(`[kyc] step3 all uploads done — id_front=${idFrontPath} selfie=${selfiePath} id_back=${idBackPath ?? "none"}`);

      // Step 4 — insert kyc_request row
      const insertPayload = {
        user_id: user.id,
        document_type: documentType,
        id_front_url: idFrontPath,
        id_back_url: idBackPath,
        selfie_url: selfiePath,
        status: "pending",
        submitted_at: new Date().toISOString(),
      };
      console.log(`[kyc] step4 inserting kyc_request — payload=${JSON.stringify(insertPayload)}`);

      const { data: kycReq, error: kycErr } = await admin
        .from("kyc_requests")
        .insert(insertPayload)
        .select("id, status, submitted_at")
        .single();

      if (kycErr) {
        console.error(
          `[kyc] step4 kyc_requests insert FAILED — code=${kycErr.code} message=${kycErr.message} details=${kycErr.details} hint=${kycErr.hint}`,
        );
        return errorResponse(sanitizeError(kycErr), 500);
      }
      console.log(`[kyc] step4 kyc_request inserted — id=${kycReq?.id}`);

      // Step 5 — update profile kyc_status → pending
      console.log(`[kyc] step5 updating profile kyc_status → pending`);
      const { error: updateErr } = await admin.from("profiles")
        .update({ kyc_status: "pending", updated_at: new Date().toISOString() })
        .eq("id", user.id);

      if (updateErr) {
        console.error(
          `[kyc] step5 profile update FAILED — code=${updateErr.code} message=${updateErr.message} details=${updateErr.details}`,
        );
        // Not fatal — request is already inserted; log and continue.
      } else {
        console.log(`[kyc] step5 profile updated OK`);
      }

      console.log(`[kyc] submit complete — kycRequestId=${kycReq?.id} user=${user.id}`);
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
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? "") : "";
    console.error(`[kyc] unhandled error: ${msg}\n${stack}`);
    return errorResponse("Internal server error", 500);
  }
});
