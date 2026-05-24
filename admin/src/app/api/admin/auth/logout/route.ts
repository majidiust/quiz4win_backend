/**
 * POST /api/admin/auth/logout
 *
 * Revokes the current session row in admin_sessions and clears both
 * q4w_admin_session and q4w_admin_refresh cookies.
 *
 * Always returns 200 — even if no valid session is found — to allow the
 * client to perform a clean redirect to /login.
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, REFRESH_COOKIE } from "@/lib/admin-auth/sessions";
import { revokeSessionByToken } from "@/lib/admin-auth/sessions";
import { validateSessionToken } from "@/lib/admin-auth/session-validator";
import { audit } from "@/lib/admin-auth/audit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value ?? null;

  if (sessionToken) {
    // Validate to get the admin id for the audit log, then revoke.
    const admin = await validateSessionToken(sessionToken);
    if (admin) {
      await audit(admin.id, "auth.logout", null, null, ip);
    }
    await revokeSessionByToken(sessionToken);
  }

  // Clear both cookies regardless.
  const secure = process.env.NODE_ENV === "production";
  const cookieOpts = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  cookieStore.delete({ name: SESSION_COOKIE, ...cookieOpts });
  cookieStore.delete({ name: REFRESH_COOKIE, ...cookieOpts });

  return NextResponse.json({ ok: true });
}
