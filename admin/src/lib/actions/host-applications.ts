"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/admin-auth/email";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const ALLOWED_ROLES: ["super_admin", "admin", "moderator"] = ["super_admin", "admin", "moderator"];

// ─── Update status ────────────────────────────────────────────────────────────

const UpdateStatusSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(["pending", "accepted", "rejected", "info_requested"]),
  admin_notes: z.string().max(2000).optional(),
});

export async function updateApplicationStatus(
  input: z.infer<typeof UpdateStatusSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin(ALLOWED_ROLES);
  const parsed = UpdateStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { applicationId, status, admin_notes } = parsed.data;
  const db = createSupabaseAdminClient();

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (admin_notes !== undefined) update.admin_notes = admin_notes;

  const { error } = await db
    .from("host_applications")
    .update(update)
    .eq("id", applicationId);

  if (error) return { ok: false, message: "Failed to update application" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "host_application_status_changed",
    target_type: "host_application",
    target_id: applicationId,
    metadata: { status },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/host-applications/${applicationId}`);
  revalidatePath("/host-applications");

  const labels: Record<string, string> = {
    accepted: "Application accepted",
    rejected: "Application rejected",
    info_requested: "More information requested",
    pending: "Application reset to pending",
  };
  return { ok: true, message: labels[status] ?? "Status updated" };
}

// ─── Send custom email ────────────────────────────────────────────────────────

const SendEmailSchema = z.object({
  applicationId: z.string().uuid(),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(10).max(5000),
});

export async function sendCustomEmailToApplicant(
  input: z.infer<typeof SendEmailSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin(ALLOWED_ROLES);
  const parsed = SendEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { applicationId, subject, message } = parsed.data;
  const db = createSupabaseAdminClient();

  const { data: app, error: fetchErr } = await db
    .from("host_applications")
    .select("id, name, email")
    .eq("id", applicationId)
    .single();

  if (fetchErr || !app) return { ok: false, message: "Application not found" };

  const paragraphs = message
    .split("\n")
    .filter((l) => l.trim())
    .map(
      (l) =>
        `<p style="margin:0 0 12px;font-family:Arial,sans-serif;color:#0F172A">${l
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#F4F5FB;padding:32px 12px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#64748B;font-weight:600">Quiz4Win</p>
<h2 style="margin:0 0 20px;color:#0F172A">${subject.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h2>
${paragraphs}
<p style="margin:24px 0 0;font-size:12px;color:#94A3B8">— The Quiz4Win Team</p>
</div></body></html>`;

  const result = await sendEmail({
    to: (app as { email: string }).email,
    subject,
    html,
    text: `${message}\n\n— The Quiz4Win Team`,
  });

  if (!result.ok) return { ok: false, message: "Failed to send email" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "host_application_email_sent",
    target_type: "host_application",
    target_id: applicationId,
    metadata: { subject },
    created_at: new Date().toISOString(),
  });

  return { ok: true, message: "Email sent to applicant" };
}
