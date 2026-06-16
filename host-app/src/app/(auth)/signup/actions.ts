"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signupAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!email || !password) {
    redirect(`/signup?error=${encodeURIComponent("Email and password required")}`);
  }
  if (password.length < 8) {
    redirect(`/signup?error=${encodeURIComponent("Password must be at least 8 characters")}&email=${encodeURIComponent(email)}`);
  }
  if (password !== confirm) {
    redirect(`/signup?error=${encodeURIComponent("Passwords do not match")}&email=${encodeURIComponent(email)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    const msg = /already registered/i.test(error.message)
      ? "An account with this email already exists"
      : error.message || "Sign-up failed";
    redirect(`/signup?error=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`);
  }

  // If the project requires email confirmation, no session yet — go to OTP verify.
  // If session was issued immediately (confirmations disabled), go to onboarding.
  if (!data.session) {
    redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
  }
  redirect("/onboarding/apply");
}
