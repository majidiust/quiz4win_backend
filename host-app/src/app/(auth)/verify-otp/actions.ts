"use server";

import { redirect } from "next/navigation";
import { authFetch } from "@/lib/auth-api";
import { persistSupabaseSession } from "@/lib/session-cookie";

/**
 * Calls POST /auth/verify-otp with type='signup' (custom branded — R-11.3).
 * On success the backend returns a session pair which is persisted directly
 * to the @supabase/ssr session cookie (bypassing supabase.auth.setSession
 * which would hit /auth/v1/user — not proxied in production).
 */
export async function verifyOtpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!email || !token) {
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent("Code required")}`);
  }
  const r = await authFetch<{ access_token?: string; refresh_token?: string }>(
    "/auth/verify-otp",
    { email, token, type: "signup" },
  );
  if (!r.ok) {
    const map: Record<string, string> = {
      otp_expired: "Code expired — request a new one",
      otp_invalid: "Invalid code",
    };
    const msg = map[r.error] ?? "Invalid or expired code";
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`);
  }
  const { access_token, refresh_token } = r.data;
  if (access_token && refresh_token) {
    await persistSupabaseSession({ access_token, refresh_token });
  }
  redirect("/onboarding/apply");
}

export async function resendOtpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`/verify-otp?error=${encodeURIComponent("Email required")}`);
  const r = await authFetch<{ message?: string }>(
    "/auth/resend-confirmation",
    { email },
  );
  if (!r.ok) {
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent(r.error || "Resend failed")}`);
  }
  redirect(`/verify-otp?email=${encodeURIComponent(email)}&info=${encodeURIComponent("Code re-sent")}`);
}
