/**
 * POST /api/admin/auth/reset-password
 *
 * Validates a reset token, hashes and saves the new password, revokes all
 * existing sessions, and sends a confirmation email via Brevo.
 *
 * Body: { token: string; password: string }
 *
 * 200 { ok: true }
 * 400 { error: string } — weak password
 * 401 { error: string } — invalid/expired token
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/admin-auth/tokens";
import { hashPassword, validatePasswordStrength } from "@/lib/admin-auth/passwords";
import { revokeAllSessions } from "@/lib/admin-auth/sessions";
import { sendEmail } from "@/lib/admin-auth/email";
import { passwordChangedTemplate } from "@/lib/admin-auth/email-templates";
import { audit } from "@/lib/admin-auth/audit";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { token, password } = body as Record<string, unknown>;
  if (typeof token !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "token and password are required" }, { status: 400 });
  }

  // Validate password strength before doing any DB work.
  const strengthErr = validatePasswordStrength(password);
  if (strengthErr) {
    return NextResponse.json({ error: strengthErr }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const db = createSupabaseAdminClient();
  const tokenHash = hashToken(token);

  // Look up the token — must be unused and not expired.
  const { data: resetToken } = await db
    .from("admin_password_reset_tokens")
    .select("id, admin_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .eq("purpose", "reset")
    .maybeSingle();

  if (!resetToken || resetToken.used_at || new Date(resetToken.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Reset link is invalid or has expired. Please request a new one." },
      { status: 401 },
    );
  }

  // Fetch admin to check status and get contact info for email.
  const { data: admin } = await db
    .from("admin_users")
    .select("id, name, email, status")
    .eq("id", resetToken.admin_id)
    .maybeSingle();

  if (!admin || admin.status !== "active") {
    return NextResponse.json({ error: "Account not found or disabled." }, { status: 401 });
  }

  // Hash new password and update admin record.
  const passwordHash = await hashPassword(password);
  await db
    .from("admin_users")
    .update({ password_hash: passwordHash })
    .eq("id", admin.id);

  // Mark the reset token as used (append-only, R-05 for audit trail).
  await db
    .from("admin_password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", resetToken.id);

  // Revoke ALL active sessions — security requirement after credential change.
  await revokeAllSessions(admin.id);

  // Send confirmation email via Brevo.
  const { subject, html, text } = passwordChangedTemplate({
    name: admin.name,
    ipAddress: ip,
    at: new Date(),
  });
  await sendEmail({ to: admin.email, subject, html, text });

  await audit(admin.id, "auth.password_reset_completed", null, null, ip);

  return NextResponse.json({ ok: true });
}
