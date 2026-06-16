import { NextResponse, type NextRequest } from "next/server";

/**
 * Reads the @supabase/ssr session cookie (chunked or whole) and returns a
 * lightweight "is this user signed in" decision. We deliberately do NOT use
 * supabase.auth.getUser() because it calls /auth/v1/user — not proxied on
 * production nginx per R-11.3 — so every request would silently return null
 * and trap signed-in users in a /signin redirect loop.
 *
 * Instead: read the cookie, base64url-decode, JSON.parse, and trust the
 * access_token's `sub` claim. A signed-out user simply has no cookie.
 */
function storageKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try { return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`; }
  catch { return "sb-localhost-auth-token"; }
}

function readSessionUser(request: NextRequest): { id: string } | null {
  try {
    const key = storageKey();
    let raw = request.cookies.get(key)?.value;
    if (!raw) {
      // Chunked variant: concat .0, .1, ...
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const v = request.cookies.get(`${key}.${i}`)?.value;
        if (!v) break;
        parts.push(v);
      }
      if (!parts.length) return null;
      raw = parts.join("");
    }
    if (raw.startsWith("base64-")) {
      raw = raw.slice("base64-".length);
      const pad = raw.length % 4 === 0 ? 0 : 4 - (raw.length % 4);
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
      raw = Buffer.from(b64, "base64").toString("utf8");
    }
    const session = JSON.parse(raw) as { access_token?: string; expires_at?: number };
    if (!session.access_token) return null;
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return null;
    const payloadSeg = session.access_token.split(".")[1];
    if (!payloadSeg) return null;
    const pad = payloadSeg.length % 4 === 0 ? 0 : 4 - (payloadSeg.length % 4);
    const b64 = payloadSeg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    const claims = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { sub?: string; exp?: number };
    if (!claims.sub) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return { id: claims.sub };
  } catch { return null; }
}

/**
 * Gate access:
 *   - Unauthed users on /(app)/* or /onboarding/* are redirected to /signin.
 *   - Authed users on /signin, /signup, /verify-otp are redirected to /dashboard.
 */
export async function updateSession(request: NextRequest) {
  const user = readSessionUser(request);
  const url = request.nextUrl.clone();
  const path = url.pathname;

  const isAuthPage = ["/signin", "/signup", "/verify-otp"].some((p) => path === p || path.startsWith(`${p}/`));
  const isProtected = path.startsWith("/dashboard") || path.startsWith("/games") ||
    path.startsWith("/invitations") || path.startsWith("/wallet") ||
    path.startsWith("/payment-methods") || path.startsWith("/files") ||
    path.startsWith("/notifications") || path.startsWith("/settings") ||
    path.startsWith("/onboarding");

  if (!user && isProtected) {
    url.pathname = "/signin";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (user && isAuthPage) {
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request });
}
