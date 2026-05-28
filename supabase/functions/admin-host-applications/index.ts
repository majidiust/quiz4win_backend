/**
 * Admin Host Applications Edge Function — Quiz4Win
 *
 * GET   /admin/host-applications            — List applications (filter by status, paginate)
 * PATCH /admin/host-applications/:id        — Update status + admin_notes
 * POST  /admin/host-applications/:id/email  — Send custom email to applicant
 *
 * R-03: JWT validated before every DB write.
 * R-04: admin service-role client for all DB access.
 * R-01: applicant email is only returned to admin role users.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/email.ts";

const VALID_STATUSES = ["pending", "accepted", "rejected", "info_requested"] as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/host-applications\/?/, "").split("/").filter(Boolean);
  const id = parts[0] ?? null;   // application UUID
  const action = parts[1] ?? null; // "email" sub-route

  try {
    // ── GET /admin/host-applications ─────────────────────────────────────────
    if (!id && req.method === "GET") {
      const status = url.searchParams.get("status") ?? null;
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
      const PAGE_SIZE = 25;
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = admin
        .from("host_applications")
        .select("id, name, email, country, instagram, followers, status, admin_notes, created_at, updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (status && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        q = q.eq("status", status);
      }

      const { data, count, error } = await q;
      if (error) return errorResponse("failed_to_list_applications", 500);

      return successResponse({
        applications: data ?? [],
        total: count ?? 0,
        page,
        page_size: PAGE_SIZE,
      });
    }

    // ── PATCH /admin/host-applications/:id ───────────────────────────────────
    if (id && !action && req.method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
          return errorResponse("invalid_status", 400);
        }
        update.status = body.status;
      }
      if (body.admin_notes !== undefined) {
        update.admin_notes = typeof body.admin_notes === "string" ? body.admin_notes.slice(0, 2000) : null;
      }

      const { data, error } = await admin
        .from("host_applications")
        .update(update)
        .eq("id", id)
        .select("id, name, email, country, instagram, followers, status, admin_notes, created_at, updated_at")
        .single();

      if (error || !data) return errorResponse("application_not_found", 404);

      // Audit trail
      await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "host_application_updated",
        target_type: "host_application",
        target_id: id,
        metadata: { status: update.status },
        created_at: new Date().toISOString(),
      });

      return successResponse({ application: data });
    }

    // ── POST /admin/host-applications/:id/email ───────────────────────────────
    if (id && action === "email" && req.method === "POST") {
      const body = await req.json() as Record<string, unknown>;
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!subject || subject.length < 2) return errorResponse("subject_required", 400);
      if (!message || message.length < 10) return errorResponse("message_required", 400);

      // Fetch applicant email (service-role access)
      const { data: app, error: fetchErr } = await admin
        .from("host_applications")
        .select("id, name, email, status")
        .eq("id", id)
        .single();

      if (fetchErr || !app) return errorResponse("application_not_found", 404);

      const paragraphs = message.split("\n").filter((l: string) => l.trim()).map(
        (l: string) => `<p style="margin:0 0 12px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
      ).join("");

      await sendEmail({
        to: { email: (app as { email: string }).email, name: (app as { name: string }).name },
        subject,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0F172A;padding:24px">${paragraphs}<p style="margin:24px 0 0;font-size:12px;color:#94A3B8">— Quiz4Win Team</p></body></html>`,
        text: `${message}\n\n— Quiz4Win Team`,
      });

      // Log the communication
      await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "host_application_email_sent",
        target_type: "host_application",
        target_id: id,
        metadata: { subject },
        created_at: new Date().toISOString(),
      });

      return successResponse({ ok: true });
    }

    return errorResponse("not_found", 404);
  } catch (err) {
    console.error("[admin-host-applications] error:", err);
    return errorResponse(sanitizeError(err), 500);
  }
});
