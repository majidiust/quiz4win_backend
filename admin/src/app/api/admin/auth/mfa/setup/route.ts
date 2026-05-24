/**
 * MFA setup endpoints — two methods:
 *
 * GET  /api/admin/auth/mfa/setup?challengeToken=…
 *   → returns { secret, qrCodeDataUrl } so the client can render QR for enrollment.
 *
 * POST /api/admin/auth/mfa/setup
 *   Body: { challengeToken: string; code: string; recoveryCodes?: string[] }
 *   → verifies the first TOTP code, stores secret, issues aal2 session.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/admin-auth/tokens";
import { newSecret, verifyCode, renderQrCode } from "@/lib/admin-auth/totp";
import { generateRecoveryCodes } from "@/lib/admin-auth/tokens";
import { issueSession, applySessionCookiesToResponse } from "@/lib/admin-auth/sessions";
import { audit } from "@/lib/admin-auth/audit";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const challengeToken = searchParams.get("challengeToken");
  if (!challengeToken) {
    return NextResponse.json({ error: "challengeToken is required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: challenge } = await db
    .from("admin_mfa_challenges")
    .select("admin_id, expires_at, consumed_at")
    .eq("challenge_hash", hashToken(challengeToken))
    .eq("purpose", "enrol")
    .maybeSingle();

  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    return NextResponse.json({ error: "Challenge expired. Please sign in again." }, { status: 401 });
  }

  const { data: admin } = await db
    .from("admin_users")
    .select("email")
    .eq("id", challenge.admin_id)
    .maybeSingle();

  if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 401 });

  const { secret, uri } = newSecret(admin.email);
  const qrCodeDataUrl = await renderQrCode(uri);

  // Store the pending secret temporarily in the challenge row (details column).
  await db
    .from("admin_mfa_challenges")
    .update({ ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null })
    .eq("challenge_hash", hashToken(challengeToken));

  // Return secret + QR. The secret is echoed back so the client can store it
  // temporarily before the POST confirms enrollment.
  return NextResponse.json({ secret, qrCodeDataUrl });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { challengeToken, code, secret } = body as Record<string, unknown>;
  if (typeof challengeToken !== "string" || typeof code !== "string" || typeof secret !== "string") {
    return NextResponse.json({ error: "challengeToken, code, and secret are required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const db = createSupabaseAdminClient();
  const challengeHash = hashToken(challengeToken);

  const { data: challenge } = await db
    .from("admin_mfa_challenges")
    .select("id, admin_id, expires_at, consumed_at")
    .eq("challenge_hash", challengeHash)
    .eq("purpose", "enrol")
    .maybeSingle();

  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    return NextResponse.json({ error: "Challenge expired. Please sign in again." }, { status: 401 });
  }

  if (!verifyCode(secret, code)) {
    await audit(challenge.admin_id, "auth.mfa_enrol_failed", null, null, ip);
    return NextResponse.json({ error: "Invalid code. Scan the QR and try again." }, { status: 401 });
  }

  const recoveryCodes = generateRecoveryCodes(10);

  // Persist secret + recovery codes on the admin record.
  await db
    .from("admin_users")
    .update({ mfa_secret: secret, mfa_enabled: true, mfa_recovery_codes: recoveryCodes })
    .eq("id", challenge.admin_id);

  // Consume challenge.
  await db
    .from("admin_mfa_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id);

  const session = await issueSession({
    adminId: challenge.admin_id,
    aal: "aal2",
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
  });

  await audit(challenge.admin_id, "auth.mfa_enrolled", null, null, ip);
  await audit(challenge.admin_id, "auth.login_success", null, { aal: "aal2" }, ip);

  const response = NextResponse.json({ ok: true, recoveryCodes });
  return applySessionCookiesToResponse(session, response);
}
