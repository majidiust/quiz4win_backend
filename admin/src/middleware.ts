/**
 * Admin panel middleware — native cookie-based auth gate.
 *
 * This middleware runs on every non-static request and performs a lightweight
 * check: does the q4w_admin_session cookie exist?
 *
 * Full cryptographic session validation (DB look-up + expiry check) is
 * intentionally deferred to the RSC layout layer (getCurrentAdmin /
 * requireAdmin), because:
 *  1. Middleware runs in Edge runtime — no Node.js crypto, no DB access.
 *  2. The cookie's presence is sufficient for the redirect decision; a forged
 *     or expired cookie is caught by the layout before any data is rendered.
 *
 * Public routes (login, auth/*, api/admin/auth/*, _next/*, assets) are
 * allowed through unconditionally.
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "q4w_admin_session";

/** Routes that do NOT require a session cookie. */
function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/admin/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$/) !== null
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes through.
  if (isPublic(pathname)) {
    // If the admin is already logged in and hits /login, redirect to dashboard.
    if (pathname.startsWith("/login") && request.cookies.has(SESSION_COOKIE)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Protected route — require the session cookie.
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
