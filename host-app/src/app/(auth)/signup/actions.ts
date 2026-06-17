"use server";

import { redirect } from "next/navigation";
import { authFetch } from "@/lib/auth-api";

/**
 * Calls POST /auth/signup on api.quiz4win.com (custom branded route — the
 * supabase.auth.signUp SDK method routes to /auth/v1/signup which is NOT
 * proxied in production per R-11.3). The backend creates the user via
 * admin.auth.admin.generateLink(type='signup') and dispatches a branded
 * Brevo email containing the action link + 6-digit OTP. No session is
 * returned; the user must verify their email before signing in.
 */
export async function signupAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!name || name.length < 2) {
    redirect(`/signup?error=${encodeURIComponent("Name is required")}&email=${encodeURIComponent(email)}`);
  }
  if (!email || !password) {
    redirect(`/signup?error=${encodeURIComponent("Email and password required")}&email=${encodeURIComponent(email)}`);
  }
  if (password.length < 8) {
    redirect(`/signup?error=${encodeURIComponent("Password must be at least 8 characters")}&email=${encodeURIComponent(email)}`);
  }
  if (password !== confirm) {
    redirect(`/signup?error=${encodeURIComponent("Passwords do not match")}&email=${encodeURIComponent(email)}`);
  }

  // flow:"otp" instructs the backend to omit the magic-link button from the
  // confirmation email, so mail-scanner prefetch cannot burn the underlying
  // GoTrue token (which would otherwise also invalidate the displayed OTP).
  const r = await authFetch<{ user: { id?: string } | null; requires_confirmation?: boolean }>(
    "/auth/signup",
    { name, email, password, flow: "otp" },
  );
  if (!r.ok) {
    const map: Record<string, string> = {
      email_taken: "An account with this email already exists",
      invalid_referral: "Referral code is invalid",
    };
    const msg = map[r.error] ?? (r.error || "Sign-up failed");
    redirect(`/signup?error=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`);
  }
  redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
}
