"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/api";

const LANG_OPTIONS = ["en", "ar", "fa", "tr", "es", "pt", "fr", "de"] as const;

export async function applyAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length < 2) {
    redirect(`/onboarding/apply?error=${encodeURIComponent("Display name required")}`);
  }
  const langs = (formData.getAll("languages") as string[]).filter((l) => (LANG_OPTIONS as readonly string[]).includes(l));
  const body = {
    name,
    country: String(formData.get("country") ?? "").trim() || null,
    languages: langs,
    phone: String(formData.get("phone") ?? "").trim() || null,
    short_bio: String(formData.get("short_bio") ?? "").trim() || null,
    bio: String(formData.get("bio") ?? "").trim() || null,
    instagram_url: String(formData.get("instagram_url") ?? "").trim() || null,
    telegram_url: String(formData.get("telegram_url") ?? "").trim() || null,
    youtube_url: String(formData.get("youtube_url") ?? "").trim() || null,
    tiktok_url: String(formData.get("tiktok_url") ?? "").trim() || null,
    twitter_url: String(formData.get("twitter_url") ?? "").trim() || null,
    website_url: String(formData.get("website_url") ?? "").trim() || null,
  };
  const r = await api("/host/apply", { method: "POST", body });
  if (!r.ok) {
    const msg = r.error === "name_taken" ? "Display name already taken"
      : r.error === "already_a_host" ? "You are already an approved host"
      : r.error === "application_pending" ? "Your application is already pending"
      : r.error === "account_suspended" ? "Your account is suspended"
      : r.error;
    redirect(`/onboarding/apply?error=${encodeURIComponent(msg)}`);
  }
  redirect("/dashboard?welcome=1");
}
