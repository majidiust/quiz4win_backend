import "server-only";

/**
 * Direct fetch wrapper for the branded /auth/* Edge Function routes on
 * api.quiz4win.com. The host-app cannot use supabase.auth.signUp / signIn /
 * verifyOtp directly because production nginx does not proxy /auth/v1/*
 * (R-11.3 — locked-down auth surface). Instead, all auth I/O goes through
 * the custom branded routes exposed by supabase/functions/auth/index.ts.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");

export interface AuthOk<T> { ok: true; status: number; data: T }
export interface AuthErr { ok: false; status: number; error: string }
export type AuthResult<T> = AuthOk<T> | AuthErr;

export interface AuthSession {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string } | null;
}

export async function authFetch<T = unknown>(path: string, body: unknown): Promise<AuthResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message ?? "network_error" };
  }
  let payload: unknown = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) {
    const err = (payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>))
      ? String((payload as { error: unknown }).error) : `http_${res.status}`;
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, status: res.status, data: payload as T };
}
