"use server";

import { redirect } from "next/navigation";
import { authFetch } from "@/lib/auth-api";
import { persistSupabaseSession } from "@/lib/session-cookie";

/**
 * Calls POST /auth/signin on api.quiz4win.com (custom branded route — R-11.3).
 * The returned access + refresh tokens are persisted directly to the
 * @supabase/ssr session cookie. We deliberately avoid supabase.auth
 * .setSession() because it internally hits /auth/v1/user (not proxied).
 */
export async function signinAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    redirect(`/signin?error=${encodeURIComponent("Email and password required")}`);
  }

  const r = await authFetch<{ access_token?: string; refresh_token?: string }>(
    "/auth/signin",
    { email, password },
  );
  if (!r.ok) {
    // Email not confirmed — send them to the OTP page to finish verification.
    if (r.error === "email_not_confirmed") {
      redirect(`/verify-otp?email=${encodeURIComponent(email)}&info=${encodeURIComponent("Please verify your email to continue")}`);
    }
    const map: Record<string, string> = {
      invalid_credentials: "Invalid credentials",
      account_suspended: "Account suspended — contact support",
    };
    const msg = map[r.error] ?? "Invalid credentials";
    redirect(`/signin?error=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`);
  }
  const { access_token, refresh_token } = r.data;
  if (!access_token || !refresh_token) {
    redirect(`/signin?error=${encodeURIComponent("Sign-in failed — no session returned")}`);
  }

  await persistSupabaseSession({ access_token, refresh_token });
  redirect(next.startsWith("/") ? next : "/dashboard");
}
