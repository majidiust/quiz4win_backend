"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signinAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    redirect(`/signin?error=${encodeURIComponent("Email and password required")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /Email not confirmed/i.test(error.message) ? "Email not confirmed yet" : "Invalid credentials";
    redirect(`/signin?error=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`);
  }
  redirect(next.startsWith("/") ? next : "/dashboard");
}
