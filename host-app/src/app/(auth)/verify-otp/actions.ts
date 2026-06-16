"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function verifyOtpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!email || !token) {
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent("Code required")}`);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    const msg = /expired|invalid/i.test(error.message) ? "Invalid or expired code" : error.message;
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`);
  }
  redirect("/onboarding/apply");
}

export async function resendOtpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`/verify-otp?error=${encodeURIComponent("Email required")}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) {
    redirect(`/verify-otp?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/verify-otp?email=${encodeURIComponent(email)}&info=${encodeURIComponent("Code re-sent")}`);
}
