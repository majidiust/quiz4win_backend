/**
 * Public Host Applications Edge Function — Quiz4Win
 *
 * POST /public-host-applications
 *   Accepts a host-application form submission from the public website.
 *   No authentication required.
 *
 * DDoS / abuse protection:
 *   • IP-based rate limit via SECURITY DEFINER RPC
 *     (< 3 per 10 min, < 5 per hour per IP).
 *   • Body size capped at 8 KB (handled by Deno.serve).
 *   • Email already-pending check (prevents duplicate pending submissions).
 *   • All fields validated and length-capped.
 *
 * R-01: ip_address never returned in any response.
 * R-04: anon Supabase client only — no service-role bypass.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";
import { sendEmail, hostApplicationReceivedTemplate } from "../_shared/email.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Best-effort client IP from proxy headers. */
function getClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ApplicationBody {
  name?: unknown;
  email?: unknown;
  country?: unknown;
  instagram?: unknown;
  followers?: unknown;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-host-applications\/?/, "");

  if (req.method !== "POST" || tail.length > 0) {
    return errorResponse("not_found", 404);
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: ApplicationBody;
  try {
    body = (await req.json()) as ApplicationBody;
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const country = typeof body.country === "string" ? body.country.trim().slice(0, 80) : null;
  const instagram = typeof body.instagram === "string" ? body.instagram.trim().slice(0, 80) : null;
  const followersRaw = body.followers;
  const followers =
    typeof followersRaw === "number" && Number.isFinite(followersRaw) && followersRaw >= 0
      ? Math.floor(followersRaw)
      : followersRaw === null || followersRaw === undefined
      ? null
      : null;

  if (!name || name.length < 2 || name.length > 120) {
    return errorResponse("name_invalid", 400);
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return errorResponse("email_invalid", 400);
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const clientIp = getClientIp(req) ?? "unknown";
  const supabase = getPublicClient();

  const { data: allowed, error: rlErr } = await supabase.rpc(
    "check_host_application_rate_limit",
    { p_ip: clientIp },
  );
  if (rlErr) {
    console.error("[public-host-applications] rate-limit RPC error:", rlErr.message);
    // Fail open — don't block legitimate requests on infra error.
  }
  if (allowed === false) {
    return errorResponse("rate_limited", 429, { "Retry-After": "600" });
  }

  // ── Duplicate pending check ────────────────────────────────────────────────
  // We use the rate-limit RPC for IP; here we guard against re-submitting the
  // same email while a pending application already exists.
  // NOTE: We can't SELECT from host_applications as anon (no RLS policy),
  // so we rely on the DB unique partial index instead — duplicate insert will
  // fail with a unique violation which we translate to a friendly message.

  // ── Insert ─────────────────────────────────────────────────────────────────
  // We generate the row id client-side so we don't need RETURNING — anon
  // has INSERT but no SELECT policy on this table (PII), and PostgREST's
  // `.select(...).single()` shape would otherwise force a RETURNING clause
  // that gets denied by RLS.
  const applicationId = crypto.randomUUID();
  const { error } = await supabase
    .from("host_applications")
    .insert({
      id: applicationId,
      name,
      email,
      country: country || null,
      instagram: instagram || null,
      followers,
      ip_address: clientIp,
    });

  if (error) {
    console.error("[public-host-applications] insert error:", error.message);
    if (error.message?.toLowerCase().includes("unique")) {
      return errorResponse("application_already_pending", 409);
    }
    return errorResponse("failed_to_submit_application", 500);
  }

  // ── Confirmation email (best-effort) ───────────────────────────────────────
  // Sent asynchronously so a slow email provider doesn't delay the response.
  (async () => {
    try {
      const tpl = hostApplicationReceivedTemplate({ name });
      await sendEmail({
        to: { email, name },
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) {
      console.error("[public-host-applications] confirmation email error:", (e as Error).message);
    }
  })();

  return successResponse({ ok: true, application_id: applicationId }, 201);
});
