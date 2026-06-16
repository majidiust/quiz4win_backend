import "server-only";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";

/**
 * Manually persists a Supabase session in the @supabase/ssr cookie format
 * WITHOUT calling supabase.auth.setSession() — that function internally hits
 * /auth/v1/user via _getUser() to validate the access token, but production
 * nginx does not proxy /auth/v1/* (R-11.3), so any attempt to use the SDK
 * after sign-in fails.
 *
 * Cookie shape mirrors what @supabase/ssr writes via storage.setItem:
 *   name : sb-<project-ref>-auth-token   (split into .0/.1/... if > CHUNK_SIZE)
 *   value: "base64-" + base64url(JSON.stringify(session))
 *
 * The session object is the minimum @supabase/ssr expects to revive on read:
 *   { access_token, refresh_token, user, token_type, expires_in, expires_at }
 *
 * The auto-refresh path on token expiry would still hit /auth/v1/token which
 * is also unproxied — but for the MVP, hosts re-sign-in when their hour-long
 * access token expires. Long-term fix is to expose /auth/v1/token via nginx.
 */

const CHUNK_SIZE = 3180;            // matches @supabase/ssr/utils/chunker default
const BASE64_PREFIX = "base64-";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;  // 30 days (refresh token lifetime)

function decodeJwt(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split(".");
    if (!payload) return null;
    const pad = payload.length % 4 === 0 ? 0 : 4 - (payload.length % 4);
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
}

function base64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function storageKey(): string {
  // Mirrors @supabase/supabase-js → sb-<host-first-label>-auth-token.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    const host = new URL(url).hostname;
    return `sb-${host.split(".")[0]}-auth-token`;
  } catch {
    return "sb-localhost-auth-token";
  }
}

export interface AuthTokens { access_token: string; refresh_token: string }

/**
 * Writes the supabase auth cookie (chunked if necessary) so subsequent
 * createSupabaseServerClient() calls see an authenticated session without
 * any network round-trip.
 */
export async function persistSupabaseSession({ access_token, refresh_token }: AuthTokens): Promise<void> {
  const payload = decodeJwt(access_token) ?? {};
  const exp = typeof payload.exp === "number" ? payload.exp : Math.floor(Date.now() / 1000) + 3600;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : null;
  const session = {
    access_token, refresh_token,
    token_type: "bearer",
    expires_in: Math.max(0, exp - Math.floor(Date.now() / 1000)),
    expires_at: exp,
    user: {
      id: sub,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: {},
      user_metadata: payload.user_metadata ?? {},
      identities: [],
    },
  };

  const encoded = BASE64_PREFIX + base64urlEncode(JSON.stringify(session));
  const key = storageKey();
  const store = await cookies();

  // Clear any pre-existing chunks for this key so a shorter new value does
  // not leave stale .1/.2 chunks lying around.
  for (let i = 0; i < 6; i++) {
    if (store.get(`${key}.${i}`)) store.delete(`${key}.${i}`);
  }

  const opts: Partial<CookieOptions> = {
    path: "/", sameSite: "lax", httpOnly: true, secure: true, maxAge: COOKIE_MAX_AGE,
  };

  if (encoded.length <= CHUNK_SIZE) {
    store.set(key, encoded, opts);
    return;
  }

  // Long value → write chunked: <key>.0, <key>.1, ...
  let i = 0;
  for (let offset = 0; offset < encoded.length; offset += CHUNK_SIZE) {
    store.set(`${key}.${i}`, encoded.slice(offset, offset + CHUNK_SIZE), opts);
    i += 1;
  }
  // Clear the unchunked cookie if it existed.
  if (store.get(key)) store.delete(key);
}
