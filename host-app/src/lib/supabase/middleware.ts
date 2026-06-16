import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Rotate the Supabase session cookie on every request and gate access:
 *   - Unauthed users on /(app)/* or /onboarding/* are redirected to /signin.
 *   - Authed users on /signin, /signup, /verify-otp are redirected to /dashboard.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
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
  return response;
}
