/**
 * POST /api/admin/auth/forgot-password
 *
 * Generates a password-reset token for the given email (if it matches an
 * active admin_users row) and sends a reset link via Brevo from
 * noreply@quiz4win.com.
 *
 * ALWAYS returns 200 regardless of whether the email matched — this prevents
 * email enumeration attacks.
 *
 * Body: { email: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/admin-auth/tokens";
import { sendEmail } from "@/lib/admin-auth/email";
import { passwordResetTemplate } from "@/lib/admin-auth/email-templates";
import { audit } from "@/lib/admin-auth/audit";

const TOKEN_TTL_MINUTES = 30;
const TOKEN_TTL_SECONDS = TOKEN_TTL_MINUTES * 60;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // always 200
  }

  const { email } = body as Record<string, unknown>;
  if (typeof email !== "string") {
    return NextResponse.json({ ok: true }); // always 200
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const db = createSupabaseAdminClient();

  const { data: admin } = await db
    .from("admin_users")
    .select("id, name, email, status")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  // If no matching admin or account is disabled, silently return success.
  if (!admin || admin.status !== "active") {
    return NextResponse.json({ ok: true });
  }

  // Invalidate any existing unused reset tokens for this admin.
  await db
    .from("admin_password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("admin_id", admin.id)
    .is("used_at", null);

  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

  const { error: insertErr } = await db.from("admin_password_reset_tokens").insert({
    admin_id: admin.id,
    token_hash: tokenHash,
    purpose: "reset",
    expires_at: expiresAt,
    ip_address: ip,
  });

  if (insertErr) {
    console.error("[forgot-password] failed to insert token:", insertErr.message);
    return NextResponse.json({ ok: true }); // don't leak the error
  }

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://panel.quiz4win.com";
  const resetUrl = `${adminUrl.replace(/\/$/, "")}/auth/reset-password?token=${token}`;

  const { subject, html, text } = passwordResetTemplate({
    name: admin.name,
    resetUrl,
    ttlMinutes: TOKEN_TTL_MINUTES,
  });

  await sendEmail({ to: admin.email, subject, html, text });
  await audit(admin.id, "auth.password_reset_requested", null, null, ip);

  return NextResponse.json({ ok: true });
}
