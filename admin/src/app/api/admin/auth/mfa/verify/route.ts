/**
 * POST /api/admin/auth/mfa/verify
 *
 * Phase 2 of login for admins who already have TOTP enrolled.
 *
 * Body: { challengeToken: string; code: string }
 *
 * 200 — sets q4w_admin_session + q4w_admin_refresh cookies, returns { ok: true }
 * 401 — invalid/expired challenge or wrong TOTP code
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/admin-auth/tokens";
import { verifyCode } from "@/lib/admin-auth/totp";
import { issueSession, applySessionCookiesToResponse } from "@/lib/admin-auth/sessions";
import { audit } from "@/lib/admin-auth/audit";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { challengeToken, code } = body as Record<string, unknown>;
  if (typeof challengeToken !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "challengeToken and code are required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const db = createSupabaseAdminClient();
  const challengeHash = hashToken(challengeToken);

  // Look up the challenge row — must be un-consumed, not expired, purpose=verify.
  const { data: challenge } = await db
    .from("admin_mfa_challenges")
    .select("id, admin_id, expires_at, consumed_at")
    .eq("challenge_hash", challengeHash)
    .eq("purpose", "verify")
    .maybeSingle();

  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    return NextResponse.json({ error: "Challenge expired or invalid. Please sign in again." }, { status: 401 });
  }

  // Fetch admin + TOTP secret.
  const { data: admin } = await db
    .from("admin_users")
    .select("id, status, mfa_secret")
    .eq("id", challenge.admin_id)
    .maybeSingle();

  if (!admin || admin.status !== "active" || !admin.mfa_secret) {
    return NextResponse.json({ error: "Account not found or MFA not configured" }, { status: 401 });
  }

  // Verify the 6-digit code (±1 window = ±30s clock skew tolerance).
  if (!verifyCode(admin.mfa_secret, code)) {
    await audit(admin.id, "auth.mfa_verify_failed", null, null, ip);
    return NextResponse.json({ error: "Invalid authentication code. Please try again." }, { status: 401 });
  }

  // Mark challenge as consumed (one-time use).
  await db
    .from("admin_mfa_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id);

  // Issue an aal2 session.
  const session = await issueSession({
    adminId: admin.id,
    aal: "aal2",
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
  });

  await db
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", admin.id);

  await audit(admin.id, "auth.login_success", null, { aal: "aal2" }, ip);

  const response = NextResponse.json({ ok: true });
  return applySessionCookiesToResponse(session, response);
}
