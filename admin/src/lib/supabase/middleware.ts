import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refresh session cookies on every request (called from root middleware). */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: don't run any logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const isPublicAsset =
    pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/api/health");

  // Not signed in → redirect to /login (except auth routes & assets)
  if (!user && !isAuthRoute && !isPublicAsset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user) {
    // Check Authentication Assurance Level.
    // aal1 = password only; aal2 = password + verified TOTP factor.
    // If the user has a verified TOTP factor, nextLevel will be "aal2".
    // We must block access to protected routes until aal2 is reached.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2";

    if (needsMfa && !isAuthRoute) {
      // Session exists but second factor not yet verified → send to login MFA step.
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("mfa", "required");
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }

    // Fully authenticated (no MFA required, or MFA already verified) on /login → dashboard.
    if (!needsMfa && isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.searchParams.delete("redirect");
      return NextResponse.redirect(url);
    }
  }

  return response;
}
