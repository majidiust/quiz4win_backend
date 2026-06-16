"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { api } from "@/lib/api";

const LANG_OPTIONS = ["en", "ar", "fa", "tr", "es", "pt", "fr", "de"];

export async function updateProfileAction(formData: FormData) {
  const langs = (formData.getAll("languages") as string[]).filter((l) => LANG_OPTIONS.includes(l));
  const body: Record<string, unknown> = { languages: langs };
  for (const k of ["country", "phone", "short_bio", "bio",
    "instagram_url", "telegram_url", "youtube_url", "tiktok_url", "twitter_url", "website_url"]) {
    const v = String(formData.get(k) ?? "").trim();
    body[k] = v || null;
  }
  const r = await api("/host/me", { method: "PATCH", body });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  if (!r.ok) redirect(`/settings?error=${encodeURIComponent(r.error)}`);
  redirect("/settings?info=Saved");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
