import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "q4w_admin_session";
export const REFRESH_COOKIE = "q4w_admin_refresh";

/** Session lifetime: 12h sliding window, 30d hard cap via refresh. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface IssuedSession {
  sessionId: string;
  sessionToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Persist a new admin_sessions row and return the plaintext tokens. The
 * caller is responsible for setting them as HTTP-only cookies (browser
 * flow) or returning them in a JSON body (programmatic flow).
 */
export async function issueSession(opts: {
  adminId: string;
  aal: "aal1" | "aal2";
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<IssuedSession> {
  const sessionToken = generateToken(32);
  const refreshToken = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("admin_sessions")
    .insert({
      admin_id: opts.adminId,
      session_token_hash: hashToken(sessionToken),
      refresh_token_hash: hashToken(refreshToken),
      aal: opts.aal,
      ip_address: opts.ipAddress,
      user_agent: opts.userAgent,
      expires_at: expiresAt.toISOString(),
      refresh_expires_at: refreshExpiresAt.toISOString(),
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error("Failed to persist session: " + (error?.message ?? "unknown"));

  return { sessionId: data.id, sessionToken, refreshToken, expiresAt, refreshExpiresAt };
}

/** Revoke a single session by its plaintext session token. */
export async function revokeSessionByToken(sessionToken: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_token_hash", hashToken(sessionToken))
    .is("revoked_at", null);
}

/** Revoke every active session for an admin. Used on password change / force-logout. */
export async function revokeAllSessions(adminId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("admin_id", adminId)
    .is("revoked_at", null);
}

/** Read the raw session token from the request cookies, or null if absent. */
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Read the refresh token cookie. */
export async function readRefreshCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

/** Apply session + refresh cookies to the current response. */
export async function setSessionCookies(s: IssuedSession): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(SESSION_COOKIE, s.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: s.expiresAt,
  });
  store.set(REFRESH_COOKIE, s.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: s.refreshExpiresAt,
  });
}

/** Remove both cookies (logout). */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/**
 * Apply session + refresh cookies directly on a NextResponse object.
 * Use this in Route Handlers where you control the response object, to
 * ensure cookies appear in the HTTP Set-Cookie headers of that specific
 * response rather than relying on Next.js's shared cookie store.
 */
export function applySessionCookiesToResponse(s: IssuedSession, response: NextResponse): NextResponse {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(SESSION_COOKIE, s.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: s.expiresAt,
  });
  response.cookies.set(REFRESH_COOKIE, s.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: s.refreshExpiresAt,
  });
  return response;
}
