/**
 * POST /api/admin/auth/login
 *
 * Phase 1 of the native admin login flow.
 *
 * Body: { email: string; password: string }
 *
 * Responses:
 *  200 { step: "mfa_required", challengeToken: string }
 *      — password OK, MFA enrolled → client must POST to /mfa/verify
 *  200 { step: "mfa_setup", challengeToken: string }
 *      — password OK, MFA NOT yet set up → client must POST to /mfa/setup
 *  401 { error: string } — bad credentials or account disabled
 *  429 { error: string } — too many attempts (future: implement in DB)
 *
 * IMPORTANT: We never issue a session without MFA (aal2). All admins must
 * have TOTP enrolled before they can complete login.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/admin-auth/passwords";
import { generateToken, hashToken } from "@/lib/admin-auth/tokens";
import { audit } from "@/lib/admin-auth/audit";

const CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes to complete MFA step

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const db = createSupabaseAdminClient();

  // Look up admin by email — fetch only what we need (never return password_hash).
  const { data: admin } = await db
    .from("admin_users")
    .select("id, email, name, status, password_hash, mfa_enabled, mfa_secret")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  // Always run verifyPassword even on miss to prevent timing-based enumeration.
  const hash = admin?.password_hash ?? "$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const passwordOk = await verifyPassword(password, hash);

  if (!admin || !passwordOk) {
    // Audit failed attempt (best-effort — may fail if admin row doesn't exist).
    if (admin) await audit(admin.id, "auth.login_failed", null, { reason: "bad_password" }, ip);
    // Same response regardless of whether admin exists (anti-enumeration).
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (admin.status !== "active") {
    await audit(admin.id, "auth.login_failed", null, { reason: "account_disabled" }, ip);
    return NextResponse.json({ error: "Account is disabled. Contact a super admin." }, { status: 401 });
  }

  // Issue a short-lived challenge token that ties password verification to the
  // subsequent MFA step. Stored as a hash in admin_mfa_challenges.
  const challengeToken = generateToken(32);
  const challengeHash = hashToken(challengeToken);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();

  const { error: chalErr } = await db.from("admin_mfa_challenges").insert({
    admin_id: admin.id,
    challenge_hash: challengeHash,
    purpose: admin.mfa_enabled ? "verify" : "enrol",
    expires_at: expiresAt,
    ip_address: ip,
    user_agent: req.headers.get("user-agent"),
  });

  if (chalErr) {
    console.error("[login] failed to create challenge:", chalErr.message);
    return NextResponse.json({ error: "Internal error, try again" }, { status: 500 });
  }

  await audit(admin.id, "auth.login_challenge_issued", null, {
    purpose: admin.mfa_enabled ? "verify" : "enrol",
  }, ip);

  return NextResponse.json({
    step: admin.mfa_enabled ? "mfa_required" : "mfa_setup",
    challengeToken,
  });
}
