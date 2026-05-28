/**
 * Admin Early Birds Edge Function — Quiz4Win
 *
 * GET  /admin/early-birds            — List sign-ups (filter by platform, country, paginate)
 * POST /admin/early-birds/:id/resend — Resend welcome email
 *
 * R-03: JWT validated before every DB write.
 * R-04: admin service-role client for all DB access.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { sendEmail, earlyBirdWelcomeTemplate } from "../_shared/email.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/early-birds\/?/, "").split("/").filter(Boolean);
  const id = parts[0] ?? null;   // sign-up UUID
  const action = parts[1] ?? null; // "resend"

  try {
    // ── GET /admin/early-birds ────────────────────────────────────────────────
    if (!id && req.method === "GET") {
      const platform = url.searchParams.get("platform") ?? null;
      const countryCode = url.searchParams.get("country_code") ?? null;
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
      const PAGE_SIZE = 50;
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = admin
        .from("early_birds")
        .select("id, platform, name, email, country, country_code, welcome_email_sent_at, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (platform === "ios" || platform === "android") {
        q = q.eq("platform", platform);
      }
      if (countryCode && countryCode.length === 2) {
        q = q.eq("country_code", countryCode.toUpperCase());
      }

      const { data, count, error } = await q;
      if (error) return errorResponse("failed_to_list_early_birds", 500);

      return successResponse({
        early_birds: data ?? [],
        total: count ?? 0,
        page,
        page_size: PAGE_SIZE,
      });
    }

    // ── POST /admin/early-birds/:id/resend ────────────────────────────────────
    if (id && action === "resend" && req.method === "POST") {
      const { data: bird, error: fetchErr } = await admin
        .from("early_birds")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !bird) return errorResponse("early_bird_not_found", 404);

      const tpl = earlyBirdWelcomeTemplate({ 
        name: bird.name, 
        platform: bird.platform as "ios" | "android" 
      });

      await sendEmail({
        to: { email: bird.email, name: bird.name },
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });

      // Update sent timestamp (R-04 service-role can update)
      const now = new Date().toISOString();
      await admin
        .from("early_birds")
        .update({ welcome_email_sent_at: now, updated_at: now })
        .eq("id", id);

      // Log the action
      await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "early_bird_welcome_resent",
        target_type: "early_bird",
        target_id: id,
        metadata: { email: bird.email },
        created_at: now,
      });

      return successResponse({ ok: true, sent_at: now });
    }

    return errorResponse("not_found", 404);
  } catch (err) {
    console.error("[admin-early-birds] error:", err);
    return errorResponse(sanitizeError(err), 500);
  }
});
