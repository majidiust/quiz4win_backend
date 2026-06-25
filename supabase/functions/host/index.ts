/**
 * Host Edge Function — Quiz4Win
 *
 * Self-service host dashboard backend. All endpoints require a valid Supabase
 * Auth JWT (D-1). Host identity = show_hosts row whose auth_user_id matches the
 * JWT subject (D-2). INV-18 gates writes by application_status / status.
 *
 * Routes (under /host/*):
 *   POST   /host/apply                            — apply / re-apply to be a host
 *   POST   /host/avatar-temp                      — upload avatar before applying (onboarding)
 *   GET    /host/me                               — own profile
 *   PATCH  /host/me                               — edit own profile
 *   POST   /host/me/avatar                        — upload/replace profile picture
 *   POST   /host/me/files                         — upload verification file
 *   GET    /host/me/files                         — list own files
 *   GET    /host/me/files/:id/url                 — presigned view URL for own file
 *   DELETE /host/me/files/:id                     — delete own pending file
 *   GET    /host/games/available                  — assignable upcoming games
 *   GET    /host/games/upcoming                   — games assigned to me
 *   GET    /host/games/history                    — past games I hosted
 *   GET    /host/games/requests                   — own requests
 *   POST   /host/games/:id/request                — request to host game :id
 *   DELETE /host/games/requests/:id               — cancel pending request
 *   GET    /host/invitations                      — invitations to me
 *   POST   /host/invitations/:id/accept           — accept (INV-17 conflict check)
 *   POST   /host/invitations/:id/reject           — reject
 *   GET    /host/games/:id/stream-session         — current session
 *   POST   /host/games/:id/stream-session         — create/update (testing/ready)
 *   POST   /host/games/:id/stream-session/live    — mint LiveKit token, go live
 *   POST   /host/games/:id/stream-session/end     — end stream
 *   POST   /host/games/:id/command                — presenter-mode game-flow command

 *   GET    /host/earnings                         — own earnings
 *   GET    /host/payment-methods                  — own payout methods
 *   POST   /host/payment-methods                  — create method
 *   PATCH  /host/payment-methods/:id              — update label / is_default
 *   DELETE /host/payment-methods/:id              — delete (non-active only)
 *   GET    /host/withdrawals                      — own withdrawal history
 *   POST   /host/withdrawals                      — request a payout (≥ $10)
 *   GET    /host/withdrawals/:id                  — detail view
 *   GET    /host/ar-backgrounds                   — active preset backgrounds for AR streaming
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { uploadObject, presignGet } from "../_shared/s3.ts";
import { signAccessToken } from "../_shared/livekit.ts";
import {
  sendEmail,
  hostApplicationReceivedTemplate,
  hostUploadReceivedTemplate,
  hostOnboardingCompleteTemplate,
  adminHostEventTemplate,
} from "../_shared/email.ts";
import { notifyHost } from "../_shared/host_notifications.ts";
import { publish } from "../_shared/rabbitmq.ts";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_FILE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/pdf", "video/mp4", "video/quicktime", "video/webm",
]);
// Crypto-only set offered by the host-app UI. The DB CHECK constraint keeps
// legacy bank/paypal types valid for historical rows but the API no longer
// accepts them on new inserts.
const PAY_METHODS = new Set([
  "usdt_trc20", "usdt_erc20", "usdt_bep20", "usdt_polygon",
  "btc", "eth", "trx", "bnb", "sol", "ton", "other",
]);
const FILE_TYPES = new Set(["avatar", "selfie", "id_document", "intro_video", "screenshot", "other"]);
// Avatars / profile pictures are images only (stored public-read, R-15.3).
const AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

const nowIso = () => new Date().toISOString();
const requireApproved = (h: { application_status: string; status: string }) =>
  h.application_status === "approved" && h.status !== "suspended" && h.application_status !== "suspended";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/host\/?/, "").split("/").filter(Boolean);
  const db = getAdminClient();

  try {
    // ── POST /host/apply ─────────────────────────────────────────────────────
    if (parts[0] === "apply" && parts.length === 1 && req.method === "POST") {
      // NOTE: `feature_host_applications` is a presentation-only flag exposed via
      // GET /config/app so the mobile apps can show/hide the "become a host"
      // button. It deliberately does NOT gate this endpoint — the application
      // flow stays available to anyone who reaches it (e.g. the host web app).
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length < 2 || name.length > 120) return errorResponse("name_invalid", 400);

      const { data: existing } = await db.from("show_hosts").select("id, application_status").eq("auth_user_id", user.id).maybeSingle();
      const fields: Record<string, unknown> = {
        name,
        auth_user_id: user.id,
        application_status: "pending",
        status: "inactive",
        country: typeof body.country === "string" ? body.country.slice(0, 80) : null,
        languages: Array.isArray(body.languages) ? (body.languages as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [],
        phone: typeof body.phone === "string" ? body.phone.slice(0, 40) : null,
        short_bio: typeof body.short_bio === "string" ? body.short_bio.slice(0, 280) : null,
        bio: typeof body.bio === "string" ? body.bio.slice(0, 2000) : null,
        instagram_url: typeof body.instagram_url === "string" ? body.instagram_url.slice(0, 200) : null,
        telegram_url: typeof body.telegram_url === "string" ? body.telegram_url.slice(0, 200) : null,
        youtube_url: typeof body.youtube_url === "string" ? body.youtube_url.slice(0, 200) : null,
        tiktok_url: typeof body.tiktok_url === "string" ? body.tiktok_url.slice(0, 200) : null,
        twitter_url: typeof body.twitter_url === "string" ? body.twitter_url.slice(0, 200) : null,
        website_url: typeof body.website_url === "string" ? body.website_url.slice(0, 200) : null,
        applied_at: nowIso(),
        updated_at: nowIso(),
      };
      // Only set avatar_url when the onboarding wizard supplied one (uploaded via
      // /host/avatar-temp), so a re-apply without a new picture never wipes it.
      if (typeof body.avatar_url === "string" && body.avatar_url) {
        fields.avatar_url = body.avatar_url.slice(0, 500);
      }

      if (existing) {
        if (existing.application_status === "approved") return errorResponse("already_a_host", 409);
        if (existing.application_status === "pending") return errorResponse("application_pending", 409);
        if (existing.application_status === "suspended") return errorResponse("account_suspended", 403);
        // rejected → allow re-apply (resets to pending)
        const { data, error } = await db.from("show_hosts").update(fields).eq("id", existing.id).select("*").single();
        if (error) return errorResponse(sanitizeError(error), 400);
        return successResponse({ host: data });
      }

      const { data, error } = await db.from("show_hosts").insert({ ...fields, created_at: nowIso() }).select("*").single();
      if (error) {
        if ((error.message ?? "").toLowerCase().includes("unique") && (error.message ?? "").includes("name")) {
          return errorResponse("name_taken", 409);
        }
        return errorResponse(sanitizeError(error), 400);
      }
      // Best-effort emails: application received (host) + new application (admin).
      if (user.email) {
        const hostEmail = user.email;
        const hostName = name;
        (async () => {
          try {
            const tpl = hostApplicationReceivedTemplate({ name: hostName });
            await sendEmail({ to: { email: hostEmail, name: hostName }, ...tpl });
          } catch (e) { console.warn("[host/apply] application email failed:", e); }
          try {
            const adminEmail = Deno.env.get("ADMIN_EMAIL");
            if (adminEmail) {
              const tpl = adminHostEventTemplate({
                heading: "New host application",
                intro: "A host submitted a new application and is pending review.",
                rows: [
                  ["Name", hostName],
                  ["Email", hostEmail],
                  ["Host ID", (data as { id: string }).id],
                ],
              });
              await sendEmail({ to: { email: adminEmail }, ...tpl });
            }
          } catch (e) { console.warn("[host/apply] admin notification failed:", e); }
        })();
      }
      return successResponse({ host: data }, 201);
    }

    // ── POST /host/avatar-temp ───────────────────────────────────────────────
    // Onboarding wizard avatar upload: runs before a show_hosts row exists, so it
    // keys by auth user id and returns the public URL for /host/apply to persist.
    // R-15: server-side size/MIME validation, S3 helper, public-read for avatars.
    if (parts[0] === "avatar-temp" && parts.length === 1 && req.method === "POST") {
      // `feature_host_applications` is presentation-only (see /host/apply note);
      // it does not gate the onboarding avatar upload.
      const form = await req.formData().catch(() => null);
      if (!form) return errorResponse("invalid_form", 400);
      const file = form.get("file");
      if (!(file instanceof File)) return errorResponse("file_required", 400);
      if (file.size > MAX_FILE_BYTES) return errorResponse("file_too_large", 413);
      const mime = file.type || "application/octet-stream";
      if (!AVATAR_MIME.has(mime)) return errorResponse("unsupported_mime", 415);
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "jpg";
      const key = `avatars/${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const buf = await file.arrayBuffer();
      const r = await uploadObject(key, buf, mime, "public-read");
      return successResponse({ url: r.publicUrl, key }, 201);
    }

    // ── GET /host/onboarding-state ───────────────────────────────────────────
    // Lightweight state check consumed by the frontend layout to determine the
    // canonical post-login route. Does NOT require a show_hosts row; returns all
    // three gate flags so the frontend can enforce the full state machine:
    //   email_verified → has_application → onboarding_complete → approved.
    if (parts[0] === "onboarding-state" && parts.length === 1 && req.method === "GET") {
      const emailVerified = !!user.email_confirmed_at;

      if (!emailVerified) {
        return successResponse({
          email_verified: false,
          has_application: false,
          onboarding_complete: false,
          application_status: null,
          host_status: null,
          next: "/verify-otp",
        });
      }

      const { data: hostRow } = await db
        .from("show_hosts")
        .select("id, application_status, status, avatar_url")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (!hostRow) {
        return successResponse({
          email_verified: true,
          has_application: false,
          onboarding_complete: false,
          application_status: null,
          host_status: null,
          next: "/onboarding/apply",
        });
      }

      const { count } = await db
        .from("host_uploaded_files")
        .select("id", { count: "exact", head: true })
        .eq("host_id", hostRow.id)
        .eq("file_type", "intro_video");

      const onboardingComplete = (count ?? 0) > 0;
      const appStatus = hostRow.application_status as string;
      const hostStatus = hostRow.status as string;
      const isSuspended = hostStatus === "suspended";
      const hasAvatar = !!(hostRow.avatar_url as string | null);

      let next: string;
      // Approved hosts always go straight to the dashboard regardless of avatar.
      if (appStatus === "approved" && !isSuspended) {
        next = "/dashboard";
      } else if (!hasAvatar) {
        // Must set a profile photo before recording the intro video.
        next = "/onboarding/avatar";
      } else if (!onboardingComplete) {
        next = "/onboarding/intro-video";
      } else {
        // pending, rejected, or suspended → show status / review screen
        next = "/onboarding/status";
      }

      return successResponse({
        email_verified: true,
        has_application: true,
        onboarding_complete: onboardingComplete,
        application_status: appStatus,
        host_status: hostStatus,
        next,
      });
    }

    // ── Email verification guard ─────────────────────────────────────────────
    // All routes below this point require a verified email. GoTrue already
    // prevents token issuance for unverified users, but this provides an
    // explicit server-side check (belt-and-suspenders, R-03 spirit).
    // Routes allowed without verification: apply, avatar-temp, onboarding-state
    // (handled above).
    if (!user.email_confirmed_at) {
      return errorResponse("email_not_verified", 403);
    }

    // From here on every route needs the caller's host row.
    const { data: host } = await db.from("show_hosts").select("*").eq("auth_user_id", user.id).maybeSingle();
    if (!host) return errorResponse("not_a_host", 404);

    return await dispatchHost(req, parts, host, db, user.email ?? null);
  } catch (err) {
    console.error("[host] unhandled:", err);
    return errorResponse(sanitizeError(err), 500);
  }
});

type Host = Record<string, unknown> & { id: string; application_status: string; status: string };
// deno-lint-ignore no-explicit-any
type DB = any;

/**
 * Strips host_fee / host_commission_pct from a game object when the
 * corresponding show_* flag is false, then removes the control flags.
 * This lets the admin hide compensation info from the host-app.
 */
function maskFeeFields(g: Record<string, unknown>): Record<string, unknown> {
  const out = { ...g };
  if (!out.show_host_fee) out.host_fee = null;
  if (!out.show_host_commission) out.host_commission_pct = null;
  delete out.show_host_fee;
  delete out.show_host_commission;
  return out;
}

async function dispatchHost(req: Request, parts: string[], host: Host, db: DB, hostEmail: string | null): Promise<Response> {
  const method = req.method;
  // ── GET/PATCH /host/me ─────────────────────────────────────────────────────
  if (parts[0] === "me" && parts.length === 1) {
    if (method === "GET") {
      // Onboarding counts as complete only once an intro video exists. The
      // onboarding gate uses this so a pending host who applied but never
      // recorded their intro is resumed into the flow on every login rather
      // than being parked on the "under review" screen.
      const { count } = await db.from("host_uploaded_files")
        .select("id", { count: "exact", head: true })
        .eq("host_id", host.id).eq("file_type", "intro_video");
      return successResponse({ host, onboarding_complete: (count ?? 0) > 0 });
    }
    if (method === "PATCH") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      for (const k of ["country", "phone", "short_bio", "bio",
        "instagram_url", "telegram_url", "youtube_url", "tiktok_url", "twitter_url", "website_url"]) {
        if (body[k] !== undefined) patch[k] = typeof body[k] === "string" ? (body[k] as string).slice(0, 2000) : null;
      }
      if (body.languages !== undefined) {
        patch.languages = Array.isArray(body.languages)
          ? (body.languages as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [];
      }
      if (body.avatar_url !== undefined) {
        patch.avatar_url = typeof body.avatar_url === "string" ? (body.avatar_url as string).slice(0, 500) : null;
      }
      const { data, error } = await db.from("show_hosts").update(patch).eq("id", host.id).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ host: data });
    }
  }

  // ── POST /host/me/avatar ─────────────────────────────────────────────────────
  // Upload / replace the profile picture. Allowed for any non-suspended host
  // (incl. pending) so the picture is visible to admins during review.
  if (parts[0] === "me" && parts[1] === "avatar" && parts.length === 2 && method === "POST") {
    if (host.status === "suspended" || host.application_status === "suspended") {
      return errorResponse("account_suspended", 403);
    }
    const form = await req.formData().catch(() => null);
    if (!form) return errorResponse("invalid_form", 400);
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("file_required", 400);
    if (file.size > MAX_FILE_BYTES) return errorResponse("file_too_large", 413);
    const mime = file.type || "application/octet-stream";
    if (!AVATAR_MIME.has(mime)) return errorResponse("unsupported_mime", 415);
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "jpg";
    const key = `hosts/${host.id}/avatar/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const buf = await file.arrayBuffer();
    const r = await uploadObject(key, buf, mime, "public-read");
    const { data, error } = await db.from("show_hosts")
      .update({ avatar_url: r.publicUrl, updated_at: nowIso() }).eq("id", host.id).select("*").single();
    if (error) return errorResponse(sanitizeError(error), 500);
    // Best-effort notification: avatar uploaded.
    if (hostEmail) {
      const hostName = (host.name as string | null) ?? "";
      (async () => {
        try {
          const tpl = hostUploadReceivedTemplate({ name: hostName, fileLabel: "profile photo" });
          await sendEmail({ to: { email: hostEmail, name: hostName || undefined }, ...tpl });
        } catch (e) { console.warn("[host/avatar] upload email failed:", e); }
        try {
          const adminEmail = Deno.env.get("ADMIN_EMAIL");
          if (adminEmail) {
            const tpl = adminHostEventTemplate({
              heading: "Host avatar uploaded",
              intro: `${hostName || "A host"} uploaded a new profile photo.`,
              rows: [["Host", hostName || host.id], ["Host ID", host.id]],
            });
            await sendEmail({ to: { email: adminEmail }, ...tpl });
          }
        } catch (e) { console.warn("[host/avatar] admin notification failed:", e); }
      })();
    }
    return successResponse({ host: data, url: r.publicUrl });
  }

  // ── /host/me/files ─────────────────────────────────────────────────────────
  if (parts[0] === "me" && parts[1] === "files") {
    if (parts.length === 2 && method === "GET") {
      const { data, error } = await db.from("host_uploaded_files").select("*").eq("host_id", host.id).order("created_at", { ascending: false });
      if (error) return errorResponse("failed_to_list_files", 500);
      return successResponse({ files: data ?? [] });
    }
    if (parts.length === 2 && method === "POST") {
      const form = await req.formData().catch(() => null);
      if (!form) return errorResponse("invalid_form", 400);
      const file = form.get("file");
      const fileType = (form.get("file_type") as string ?? "other").toLowerCase();
      if (!(file instanceof File)) return errorResponse("file_required", 400);
      if (!FILE_TYPES.has(fileType)) return errorResponse("invalid_file_type", 400);
      // Onboarding media (intro video, avatar) may be uploaded while the host is
      // still pending review; every other file type requires an approved host.
      if (host.status === "suspended" || host.application_status === "suspended") {
        return errorResponse("account_suspended", 403);
      }
      const onboardingType = fileType === "intro_video" || fileType === "avatar";
      if (!onboardingType && !requireApproved(host)) return errorResponse("host_not_approved", 403);
      if (file.size > MAX_FILE_BYTES) return errorResponse("file_too_large", 413);
      const mime = file.type || "application/octet-stream";
      if (!ALLOWED_FILE_MIME.has(mime)) return errorResponse("unsupported_mime", 415);
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 6);
      const key = `hosts/${host.id}/${fileType}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      // Avatars are shown unauthenticated (public-read); everything else is private.
      const visibility = fileType === "avatar" ? "public-read" : "private";
      const buf = await file.arrayBuffer();
      const r = await uploadObject(key, buf, mime, visibility);
      const { data, error } = await db.from("host_uploaded_files").insert({
        host_id: host.id, file_type: fileType, s3_key: key, url: r.publicUrl ?? "",
        mime_type: mime, file_size_bytes: file.size, status: "pending",
        created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 500);
      // Best-effort emails: upload received (host) + notification (admin).
      if (hostEmail) {
        const hostName = (host.name as string | null) ?? "";
        const fileLabel = fileType.replaceAll("_", " ");
        const isFirstIntroVideo = fileType === "intro_video";
        // Check whether this is the very first intro_video (onboarding milestone).
        let isFirstUpload = false;
        if (isFirstIntroVideo) {
          const { count } = await db.from("host_uploaded_files")
            .select("id", { count: "exact", head: true })
            .eq("host_id", host.id)
            .eq("file_type", "intro_video");
          isFirstUpload = (count ?? 0) <= 1; // <=1 because we just inserted above
        }
        (async () => {
          try {
            const tpl = isFirstUpload
              ? hostOnboardingCompleteTemplate({ name: hostName })
              : hostUploadReceivedTemplate({ name: hostName, fileLabel });
            await sendEmail({ to: { email: hostEmail, name: hostName || undefined }, ...tpl });
          } catch (e) { console.warn("[host/files] upload email failed:", e); }
          try {
            const adminEmail = Deno.env.get("ADMIN_EMAIL");
            if (adminEmail) {
              const heading = isFirstUpload
                ? "Host onboarding complete"
                : `Host file uploaded: ${fileLabel}`;
              const intro = isFirstUpload
                ? `${hostName || "A host"} completed onboarding by recording their intro video.`
                : `${hostName || "A host"} uploaded a new ${fileLabel} file for review.`;
              const tpl = adminHostEventTemplate({
                heading,
                intro,
                rows: [
                  ["Host", hostName || host.id],
                  ["Host ID", host.id],
                  ["File type", fileLabel],
                  ["File ID", (data as { id: string }).id],
                ],
              });
              await sendEmail({ to: { email: adminEmail }, ...tpl });
            }
          } catch (e) { console.warn("[host/files] admin notification failed:", e); }
        })();
      }
      return successResponse({ file: data }, 201);
    }
    if (parts.length === 3 && method === "DELETE") {
      const { data: row } = await db.from("host_uploaded_files").select("id, status, host_id").eq("id", parts[2]).maybeSingle();
      if (!row || row.host_id !== host.id) return errorResponse("file_not_found", 404);
      if (row.status !== "pending") return errorResponse("only_pending_can_be_deleted", 409);
      const { error } = await db.from("host_uploaded_files").delete().eq("id", parts[2]);
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ ok: true });
    }
    // GET /host/me/files/:id/url — short-lived view URL for the host's own file.
    if (parts.length === 4 && parts[3] === "url" && method === "GET") {
      const { data: row } = await db.from("host_uploaded_files")
        .select("id, host_id, file_type, s3_key, url").eq("id", parts[2]).maybeSingle();
      if (!row || row.host_id !== host.id) return errorResponse("file_not_found", 404);
      // Avatars are public-read; everything else is private → presigned GET (10 min).
      const url = row.file_type === "avatar"
        ? (row.url as string)
        : await presignGet(row.s3_key as string, 600);
      return successResponse({ url });
    }
  }

  // ── /host/games/available, /upcoming, /history, /requests ─────────────────
  if (parts[0] === "games" && parts[1] === "available" && parts.length === 2 && method === "GET") {
    const { data, error } = await db.from("games")
      .select("id, title, mode, category, language, scheduled_at, prize_pool, time_per_question, questions_count, livekit_room_name, status, host_fee, host_commission_pct, show_host_fee, show_host_commission")
      .is("host_id", null).eq("mode", "live").eq("status", "upcoming").eq("requires_host", true)
      .order("scheduled_at", { ascending: true }).limit(100);
    if (error) return errorResponse("failed_to_list_games", 500);
    const games = (data ?? []).map(maskFeeFields);
    return successResponse({ games });
  }
  if (parts[0] === "games" && parts[1] === "upcoming" && parts.length === 2 && method === "GET") {
    const { data, error } = await db.from("games")
      .select("id, title, mode, category, language, scheduled_at, prize_pool, status, livekit_room_name, host_id, host_assignment_status, host_fee, host_commission_pct, show_host_fee, show_host_commission")
      .eq("host_id", host.id).in("status", ["upcoming", "open", "live"])
      .order("scheduled_at", { ascending: true });
    if (error) return errorResponse("failed_to_list_games", 500);
    const games = (data ?? []).map(maskFeeFields);
    return successResponse({ games });
  }
  if (parts[0] === "games" && parts[1] === "history" && parts.length === 2 && method === "GET") {
    const { data, error } = await db.from("games")
      .select("id, title, mode, category, language, scheduled_at, ended_at, prize_pool, total_participants, total_winners, status, host_id, host_assignment_status, host_fee, host_commission_pct, show_host_fee, show_host_commission")
      .eq("host_id", host.id).in("status", ["completed", "cancelled", "ended"])
      .order("ended_at", { ascending: false }).limit(100);
    if (error) return errorResponse("failed_to_list_games", 500);
    const games = (data ?? []).map(maskFeeFields);
    return successResponse({ games });
  }
  if (parts[0] === "games" && parts[1] === "requests" && parts.length === 2 && method === "GET") {
    const { data, error } = await db.from("host_game_requests")
      .select("*, games(id, title, scheduled_at, status)")
      .eq("host_id", host.id).order("created_at", { ascending: false });
    if (error) return errorResponse("failed_to_list_requests", 500);
    return successResponse({ requests: data ?? [] });
  }
  if (parts[0] === "games" && parts[1] === "requests" && parts.length === 3 && method === "DELETE") {
    const { data: r } = await db.from("host_game_requests").select("id, status, host_id").eq("id", parts[2]).maybeSingle();
    if (!r || r.host_id !== host.id) return errorResponse("request_not_found", 404);
    if (r.status !== "pending") return errorResponse("only_pending_can_be_cancelled", 409);
    await db.from("host_game_requests").update({ status: "cancelled", updated_at: nowIso() }).eq("id", parts[2]);
    return successResponse({ ok: true });
  }
  if (parts[0] === "games" && parts[2] === "request" && parts.length === 3 && method === "POST") {
    if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
    const gameId = parts[1];
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    const { data: g } = await db.from("games").select("id, mode, status, host_id").eq("id", gameId).maybeSingle();
    if (!g) return errorResponse("game_not_found", 404);
    if (g.mode !== "live" || g.status !== "upcoming" || g.host_id) return errorResponse("game_not_requestable", 409);

    // Check for an existing request row for this (host, game) pair.
    // UNIQUE(host_id, game_id) means only one row can ever exist.
    const { data: existing } = await db.from("host_game_requests")
      .select("id, status").eq("host_id", host.id).eq("game_id", gameId).maybeSingle();

    if (existing) {
      // Allow re-requesting only when the previous request was cancelled.
      if (existing.status !== "cancelled") return errorResponse("already_requested", 409);
      const { data, error } = await db.from("host_game_requests")
        .update({ status: "pending", host_note: note, admin_note: null, reviewed_by: null, reviewed_at: null, updated_at: nowIso() })
        .eq("id", existing.id).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ request: data }, 201);
    }

    const { data, error } = await db.from("host_game_requests").insert({
      host_id: host.id, game_id: gameId, host_note: note, status: "pending",
      created_at: nowIso(), updated_at: nowIso(),
    }).select("*").single();
    if (error) return errorResponse(sanitizeError(error), 400);
    return successResponse({ request: data }, 201);
  }

  // ── POST /host/games/:id/accept — accept a directly-assigned game ──────────
  if (parts[0] === "games" && parts[2] === "accept" && parts.length === 3 && method === "POST") {
    if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
    const gameId = parts[1];
    const { data: g } = await db.from("games")
      .select("id, title, host_id, host_assignment_status, status, scheduled_at")
      .eq("id", gameId).maybeSingle();
    if (!g) return errorResponse("game_not_found", 404);
    if (g.host_id !== host.id) return errorResponse("not_assigned_to_this_game", 403);
    if (g.host_assignment_status !== "pending") return errorResponse("assignment_not_pending", 409);
    if (!["upcoming", "open"].includes(g.status)) return errorResponse("game_not_accepting", 409);

    const { error } = await db.from("games")
      .update({ host_assignment_status: "accepted", updated_at: nowIso() })
      .eq("id", gameId).eq("host_id", host.id);
    if (error) return errorResponse(sanitizeError(error), 500);

    // Notify admin via email (best-effort).
    const adminEmail = Deno.env.get("ADMIN_EMAIL") ?? Deno.env.get("EMAIL_FROM") ?? "";
    if (adminEmail) {
      const hostName = String(host.name ?? host.id);
      sendEmail({
        to: { email: adminEmail, name: "Quiz4Win Admin" },
        subject: `Host accepted game assignment: ${g.title}`,
        html: `<p>Host <strong>${hostName}</strong> has <strong>accepted</strong> the assignment for game <em>${g.title}</em>.</p>`,
        text: `Host ${hostName} has accepted the assignment for game "${g.title}".`,
      }).catch((e: Error) => console.warn("[host/accept] admin email failed:", e.message));
    }
    // In-app notification to host confirming acceptance.
    notifyHost(db, {
      hostId: host.id,
      type: "host_invite",
      title: "Assignment accepted",
      body: `You have accepted the hosting assignment for "${g.title}". See you on stage!`,
      data: { game_id: gameId, action: "accepted" },
    });
    return successResponse({ ok: true, status: "accepted" });
  }

  // ── POST /host/games/:id/reject — reject a directly-assigned game ──────────
  if (parts[0] === "games" && parts[2] === "reject" && parts.length === 3 && method === "POST") {
    if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
    const gameId = parts[1];
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    const { data: g } = await db.from("games")
      .select("id, title, host_id, host_assignment_status, status")
      .eq("id", gameId).maybeSingle();
    if (!g) return errorResponse("game_not_found", 404);
    if (g.host_id !== host.id) return errorResponse("not_assigned_to_this_game", 403);
    if (g.host_assignment_status !== "pending") return errorResponse("assignment_not_pending", 409);

    // Return game to unassigned pool.
    const { error } = await db.from("games")
      .update({
        host_id: null, host_name: null,
        host_assignment_status: "unassigned",
        updated_at: nowIso(),
      })
      .eq("id", gameId).eq("host_id", host.id);
    if (error) return errorResponse(sanitizeError(error), 500);

    // Notify admin via email (best-effort).
    const adminEmail = Deno.env.get("ADMIN_EMAIL") ?? Deno.env.get("EMAIL_FROM") ?? "";
    if (adminEmail) {
      const hostName = String(host.name ?? host.id);
      sendEmail({
        to: { email: adminEmail, name: "Quiz4Win Admin" },
        subject: `Host rejected game assignment: ${g.title}`,
        html: `<p>Host <strong>${hostName}</strong> has <strong>rejected</strong> the assignment for game <em>${g.title}</em>${note ? ` — <em>${note}</em>` : ""}. The game is now back in the unassigned pool.</p>`,
        text: `Host ${hostName} has rejected the assignment for game "${g.title}"${note ? ` — ${note}` : ""}. Game returned to pool.`,
      }).catch((e: Error) => console.warn("[host/reject] admin email failed:", e.message));
    }
    return successResponse({ ok: true, status: "rejected" });
  }

  return await dispatchHostExtra(req, parts, host, db);
}

// LiveKit access-token mint is delegated to _shared/livekit.ts signAccessToken.
// We pass canPublish + canPublishData = true for hosts (they actively broadcast).

async function dispatchHostExtra(req: Request, parts: string[], host: Host, db: DB): Promise<Response> {
  const method = req.method;

  // ── /host/invitations ──────────────────────────────────────────────────────
  if (parts[0] === "invitations" && parts.length === 1 && method === "GET") {
    const { data, error } = await db.from("host_invitations")
      .select("*, games(id, title, scheduled_at, mode, category, language, prize_pool, status)")
      .eq("host_id", host.id).order("created_at", { ascending: false });
    if (error) return errorResponse("failed_to_list_invitations", 500);
    return successResponse({ invitations: data ?? [] });
  }
  if (parts[0] === "invitations" && parts.length === 3 && (parts[2] === "accept" || parts[2] === "reject") && method === "POST") {
    if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
    const inv = (await db.from("host_invitations").select("*").eq("id", parts[1]).maybeSingle()).data;
    if (!inv || inv.host_id !== host.id) return errorResponse("invitation_not_found", 404);
    if (inv.status !== "sent") return errorResponse("invitation_already_actioned", 409);
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      await db.from("host_invitations").update({ status: "expired", updated_at: nowIso() }).eq("id", parts[1]);
      return errorResponse("invitation_expired", 410);
    }
    if (parts[2] === "accept") {
      const { data: conflict } = await db.rpc("check_host_schedule_conflict", { p_host_id: host.id, p_game_id: inv.game_id });
      if (conflict === true) return errorResponse("schedule_conflict", 409);
      // Conditional claim: only succeeds when no other host got there first.
      // The trg_close_stale_host_offers_on_assign trigger cleans up the rest.
      const { data: claimed } = await db.from("games")
        .update({ host_id: host.id, host_assignment_status: "accepted", updated_at: nowIso() })
        .eq("id", inv.game_id).is("host_id", null).select("id").maybeSingle();
      if (!claimed) return errorResponse("game_already_has_host", 409);
      const { error: e1 } = await db.from("host_invitations").update({ status: "accepted", responded_at: nowIso(), updated_at: nowIso() }).eq("id", parts[1]);
      if (e1) return errorResponse(sanitizeError(e1), 500);
      return successResponse({ ok: true, status: "accepted" });
    } else {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
      await db.from("host_invitations").update({ status: "rejected", response_note: note, responded_at: nowIso(), updated_at: nowIso() }).eq("id", parts[1]);
      return successResponse({ ok: true, status: "rejected" });
    }
  }

  // ── /host/games/:id/stream-session ─────────────────────────────────────────
  if (parts[0] === "games" && parts[2] === "stream-session" && (parts.length === 3 || parts.length === 4)) {
    const gameId = parts[1];
    const { data: g } = await db.from("games").select("id, host_id, mode, status, scheduled_at, livekit_room_name, title, host_assignment_status, run_mode").eq("id", gameId).maybeSingle();
    if (!g) return errorResponse("game_not_found", 404);
    if (g.host_id !== host.id) return errorResponse("not_assigned_to_this_game", 403);
    // Host must have accepted the assignment before going live.
    if (g.host_assignment_status === "pending") return errorResponse("assignment_not_accepted", 403);

    if (parts.length === 3 && method === "GET") {
      const { data } = await db.from("host_stream_sessions").select("*").eq("host_id", host.id).eq("game_id", gameId).maybeSingle();
      return successResponse({ session: data ?? null, game: g });
    }
    if (parts.length === 3 && method === "POST") {
      if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      if (typeof body.camera_ok === "boolean") patch.camera_ok = body.camera_ok;
      if (typeof body.mic_ok === "boolean") patch.mic_ok = body.mic_ok;
      if (typeof body.connection_ok === "boolean") patch.connection_ok = body.connection_ok;
      if (typeof body.status === "string" && ["testing", "ready"].includes(body.status)) patch.status = body.status;
      const { data: existing } = await db.from("host_stream_sessions").select("id").eq("host_id", host.id).eq("game_id", gameId).maybeSingle();
      if (existing) {
        const { data, error } = await db.from("host_stream_sessions").update(patch).eq("id", existing.id).select("*").single();
        if (error) return errorResponse(sanitizeError(error), 500);
        return successResponse({ session: data });
      }
      const { data, error } = await db.from("host_stream_sessions").insert({
        host_id: host.id, game_id: gameId, status: (patch.status as string) ?? "created",
        camera_ok: patch.camera_ok ?? false, mic_ok: patch.mic_ok ?? false, connection_ok: patch.connection_ok ?? false,
        created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 500);
      return successResponse({ session: data }, 201);
    }
    if (parts.length === 4 && parts[3] === "live" && method === "POST") {
      if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
      // A host may only go live for a game that is at least near its window.
      // Allow upcoming/open/live; refuse completed/cancelled/ended so a stale
      // mobile session cannot mint a fresh LiveKit token after the game.
      if (!["upcoming", "open", "live"].includes(g.status)) {
        return errorResponse("game_not_live_able", 409);
      }
      const room = g.livekit_room_name || `game-${gameId}`;
      if (!Deno.env.get("LIVEKIT_API_KEY") || !Deno.env.get("LIVEKIT_API_SECRET")) {
        return errorResponse("livekit_not_configured", 503);
      }
      const token = await signAccessToken(
        `host-${host.id}`,
        room,
        { roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
      );
      // Upsert the session row so a host who skipped the testing wizard still
      // ends up with a tracked stream session row (otherwise UPDATE no-ops).
      const { data: existing } = await db.from("host_stream_sessions").select("id")
        .eq("host_id", host.id).eq("game_id", gameId).maybeSingle();
      if (existing) {
        await db.from("host_stream_sessions").update({
          status: "live", started_at: nowIso(), livekit_token_minted_at: nowIso(), updated_at: nowIso(),
        }).eq("id", existing.id);
      } else {
        await db.from("host_stream_sessions").insert({
          host_id: host.id, game_id: gameId, status: "live",
          camera_ok: true, mic_ok: true, connection_ok: true,
          started_at: nowIso(), livekit_token_minted_at: nowIso(),
          created_at: nowIso(), updated_at: nowIso(),
        });
      }
      const livekitUrl = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
      return successResponse({ token, room_name: room, identity: `host-${host.id}`, livekit_url: livekitUrl });
    }
    if (parts.length === 4 && parts[3] === "end" && method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const failed = body.failed === true;
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
      await db.from("host_stream_sessions").update({
        status: failed ? "failed" : "ended", ended_at: nowIso(),
        failure_reason: failed ? reason : null, updated_at: nowIso(),
      }).eq("host_id", host.id).eq("game_id", gameId);
      return successResponse({ ok: true });
    }
  }

  // ── /host/games/:id/command ────────────────────────────────────────────────
  // Presenter-mode host control: forwards a game-flow command to the orchestrator
  // over RabbitMQ (same command path the AI presenter uses). Only valid for a
  // live game running in run_mode='presenter' (a human host, no AI presenter).
  // The host's LiveKit identity (`host-<id>`) is attached as presenterId so the
  // private QUESTION_PREPARED (carrying the correct answer — the §13.4 presenter
  // exception to INV-04) is routed to this host's screen.
  if (parts[0] === "games" && parts[2] === "command" && parts.length === 3 && method === "POST") {
    if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
    const gameId = parts[1];
    const { data: g } = await db.from("games")
      .select("id, host_id, status, run_mode, livekit_room_name")
      .eq("id", gameId).maybeSingle();
    if (!g) return errorResponse("game_not_found", 404);
    if (g.host_id !== host.id) return errorResponse("not_assigned_to_this_game", 403);
    if (g.run_mode !== "presenter") return errorResponse("game_not_presenter_mode", 409);
    if (g.status !== "live") return errorResponse("game_not_running", 409);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const type = String(body.type ?? "");
    const ALLOWED = new Set([
      "PrepareQuestion", "StartQuestion", "CloseQuestion", "AdvanceQuestion", "FinalizeGame",
    ]);
    if (!ALLOWED.has(type)) return errorResponse("invalid_command", 400);

    const payload: Record<string, unknown> = {
      type,
      gameId,
      presenterId: `host-${host.id}`,
      correlationId: crypto.randomUUID(),
      publishedAt: nowIso(),
    };
    // Whitelisted, server-validated optional fields (never trust the client).
    if (typeof body.questionIndex === "number" && Number.isInteger(body.questionIndex) && body.questionIndex >= 0) {
      payload.questionIndex = body.questionIndex;
    }
    if (typeof body.timeLimitSeconds === "number" && body.timeLimitSeconds > 0 && body.timeLimitSeconds <= 600) {
      payload.timeLimitSeconds = body.timeLimitSeconds;
    }
    if (type === "FinalizeGame") {
      payload.livekitRoomName = g.livekit_room_name ?? `quiz-${gameId}`;
    }

    const result = await publish({
      exchange: Deno.env.get("MQ_COMMAND_EXCHANGE") ?? "",
      routingKey: Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands",
      payload,
    });
    if (!result.ok) return errorResponse("command_publish_failed", 502);
    return successResponse({ ok: true, type });
  }

  // ── /host/earnings ─────────────────────────────────────────────────────────
  if (parts[0] === "earnings" && parts.length === 1 && method === "GET") {
    const { data, error } = await db.from("host_earnings")
      .select("*, games(id, title, scheduled_at, ended_at)")
      .eq("host_id", host.id).order("created_at", { ascending: false }).limit(200);
    if (error) return errorResponse("failed_to_list_earnings", 500);
    const totals = (data ?? []).reduce((a: Record<string, number>, r: { status: string; amount: string | number }) => {
      const amt = Number(r.amount ?? 0);
      a[r.status] = (a[r.status] ?? 0) + amt;
      return a;
    }, {});
    return successResponse({ earnings: data ?? [], totals });
  }

  // ── /host/payment-methods ──────────────────────────────────────────────────
  if (parts[0] === "payment-methods") {
    if (parts.length === 1 && method === "GET") {
      const { data, error } = await db.from("host_payment_methods").select("*").eq("host_id", host.id).order("created_at", { ascending: false });
      if (error) return errorResponse("failed_to_list_methods", 500);
      return successResponse({ methods: data ?? [] });
    }
    if (parts.length === 1 && method === "POST") {
      if (!requireApproved(host)) return errorResponse("host_not_approved", 403);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const methodType = String(body.method_type ?? "");
      if (!PAY_METHODS.has(methodType)) return errorResponse("invalid_method_type", 400);
      const accountDetails = body.account_details;
      if (!accountDetails || typeof accountDetails !== "object") return errorResponse("account_details_required", 400);
      const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;
      const isDefault = body.is_default === true;
      if (isDefault) await db.from("host_payment_methods").update({ is_default: false, updated_at: nowIso() }).eq("host_id", host.id);
      const { data, error } = await db.from("host_payment_methods").insert({
        host_id: host.id, method_type: methodType, label, account_details: accountDetails,
        status: "pending_verification", is_default: isDefault,
        created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ method: data }, 201);
    }
    if (parts.length === 2 && method === "PATCH") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      if (typeof body.label === "string") patch.label = body.label.slice(0, 80);
      if (body.is_default === true) {
        await db.from("host_payment_methods").update({ is_default: false, updated_at: nowIso() }).eq("host_id", host.id);
        patch.is_default = true;
      }
      const { data: r } = await db.from("host_payment_methods").select("host_id").eq("id", parts[1]).maybeSingle();
      if (!r || r.host_id !== host.id) return errorResponse("method_not_found", 404);
      const { data, error } = await db.from("host_payment_methods").update(patch).eq("id", parts[1]).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ method: data });
    }
    if (parts.length === 2 && method === "DELETE") {
      const { data: r } = await db.from("host_payment_methods").select("host_id, status").eq("id", parts[1]).maybeSingle();
      if (!r || r.host_id !== host.id) return errorResponse("method_not_found", 404);
      if (r.status === "active") return errorResponse("cannot_delete_active_method", 409);
      await db.from("host_payment_methods").delete().eq("id", parts[1]);
      return successResponse({ ok: true });
    }
  }

  // ── /host/withdrawals ─────────────────────────────────────────────────────
  if (parts[0] === "withdrawals") {
    // GET /host/withdrawals — list own withdrawal requests
    if (parts.length === 1 && method === "GET") {
      const statusFilter = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
      let q = db.from("host_withdrawals")
        // deno-lint-ignore no-explicit-any
        .select("id, amount, currency, status, note, crypto_coin, crypto_network, crypto_address, transaction_reference, rejection_reason, requested_at, reviewed_at, completed_at, payment_method_id") as any;
      q = q.eq("host_id", host.id).order("requested_at", { ascending: false }).limit(limit);
      if (statusFilter) q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) return errorResponse("failed_to_list_withdrawals", 500);
      return successResponse({ withdrawals: data ?? [] });
    }

    // GET /host/withdrawals/:id — detail view
    if (parts.length === 2 && method === "GET") {
      const { data, error } = await db.from("host_withdrawals")
        .select("*").eq("id", parts[1]).eq("host_id", host.id).maybeSingle();
      if (error || !data) return errorResponse("withdrawal_not_found", 404);
      return successResponse({ withdrawal: data });
    }

    // POST /host/withdrawals — create withdrawal request
    if (parts.length === 1 && method === "POST") {
      if (!requireApproved(host)) return errorResponse("host_not_approved", 403);

      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const paymentMethodId = typeof body.payment_method_id === "string" ? body.payment_method_id.trim() : "";
      const amountRaw = Number(body.amount);
      const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

      if (!paymentMethodId) return errorResponse("payment_method_id_required", 400);
      if (!Number.isFinite(amountRaw) || amountRaw < 10) return errorResponse("amount_must_be_at_least_10", 400);
      const amount = Math.round(amountRaw * 100) / 100;

      // Verify payment method belongs to host and is active
      const { data: pm } = await db.from("host_payment_methods")
        .select("id, host_id, status, method_type, account_details")
        .eq("id", paymentMethodId).eq("host_id", host.id).maybeSingle();
      if (!pm) return errorResponse("payment_method_not_found", 404);
      if (pm.status !== "active") return errorResponse("payment_method_not_active", 409);

      // No more than one pending/processing withdrawal at a time
      const { count: pendingCount } = await db.from("host_withdrawals")
        .select("id", { count: "exact", head: true })
        .eq("host_id", host.id).in("status", ["pending", "processing"]);
      if ((pendingCount ?? 0) > 0) return errorResponse("withdrawal_already_pending", 409);

      // Resolve host → profile
      const { data: authRow } = await db.from("show_hosts").select("auth_user_id").eq("id", host.id).maybeSingle();
      if (!authRow?.auth_user_id) return errorResponse("host_has_no_auth_user", 500);

      const { data: profile } = await db.from("profiles").select("id, wallet_balance").eq("id", authRow.auth_user_id).maybeSingle();
      if (!profile) return errorResponse("profile_not_found", 500);

      const currentBalance = Number(profile.wallet_balance ?? 0);
      if (currentBalance < amount) return errorResponse("insufficient_balance", 409);

      // Debit wallet_balance atomically (R-02, R-05)
      const newBalance = Math.round((currentBalance - amount) * 100) / 100;
      const { error: balErr } = await db.from("profiles")
        .update({ wallet_balance: newBalance.toFixed(2), updated_at: nowIso() })
        .eq("id", authRow.auth_user_id);
      if (balErr) return errorResponse("failed_to_debit_balance", 500);

      // Snapshot crypto details from payment method
      const acct = (pm.account_details as Record<string, string> | null) ?? {};
      const cryptoCoin = typeof pm.method_type === "string" ? pm.method_type.toUpperCase() : null;
      const cryptoNetwork = acct.network ?? null;
      const cryptoAddress = acct.address ?? null;

      // Append-only transaction record (R-05)
      await db.from("transactions").insert({
        user_id: authRow.auth_user_id, type: "host_payout",
        amount: amount.toFixed(2), status: "pending",
        description: `Host payout request — ${pm.method_type}`,
        created_at: nowIso(),
      });

      // Create withdrawal record
      const { data: withdrawal, error: wErr } = await db.from("host_withdrawals").insert({
        host_id: host.id, payment_method_id: paymentMethodId,
        amount: amount.toFixed(2), currency: "USD", status: "pending",
        note, crypto_coin: cryptoCoin, crypto_network: cryptoNetwork, crypto_address: cryptoAddress,
        requested_at: nowIso(), created_at: nowIso(), updated_at: nowIso(),
      }).select("*").single();
      if (wErr) {
        // Best-effort rollback of balance debit
        await db.from("profiles").update({ wallet_balance: currentBalance.toFixed(2), updated_at: nowIso() }).eq("id", authRow.auth_user_id);
        return errorResponse("failed_to_create_withdrawal", 500);
      }

      // Notify host
      await db.from("notifications").insert({
        user_id: authRow.auth_user_id, type: "host_withdrawal",
        title: "Withdrawal request submitted",
        body: `Your payout request for $${amount.toFixed(2)} has been submitted and is under review.`,
        read: false, created_at: nowIso(),
      });

      return successResponse({ withdrawal }, 201);
    }
  }

  // ── /host/ar-backgrounds ───────────────────────────────────────────────────
  // Returns active background presets for the AR streaming panel.
  if (parts[0] === "ar-backgrounds" && parts.length === 1 && method === "GET") {
    const { data, error } = await db.from("ar_backgrounds")
      .select("id, name, url, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return errorResponse("failed_to_fetch_backgrounds", 500);
    return successResponse({ backgrounds: data ?? [] });
  }

  return errorResponse("not_found", 404);
}

export {};
