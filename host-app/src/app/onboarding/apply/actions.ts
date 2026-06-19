"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/api";

const LANG_OPTIONS = ["en", "ar", "fa", "tr", "es", "pt", "fr", "de"] as const;

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads an avatar before the host has applied (no show_hosts row yet).
 * Posts to /host/avatar-temp and returns the public URL for the wizard to keep
 * and submit alongside the application. All S3 handling happens server-side (R-15).
 */
export async function uploadAvatarTempAction(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Select an image first" };
  const upload = new FormData();
  upload.set("file", file);
  const r = await api<{ url: string }>("/host/avatar-temp", { method: "POST", body: upload });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, url: r.data.url };
}

export async function applyAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length < 2) {
    redirect(`/onboarding/apply?error=${encodeURIComponent("Display name required")}`);
  }
  const langs = (formData.getAll("languages") as string[]).filter((l) => (LANG_OPTIONS as readonly string[]).includes(l));
  const body = {
    name,
    avatar_url: String(formData.get("avatar_url") ?? "").trim() || null,
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
    // Feature flag off → redirect to a dedicated "closed" state so the page
    // can render a proper informational UI instead of re-showing the wizard.
    if (r.error === "feature_disabled") redirect("/onboarding/apply?closed=1");
    const msg = r.error === "name_taken" ? "Display name already taken"
      : r.error === "already_a_host" ? "You are already an approved host"
      : r.error === "application_pending" ? "Your application is already pending"
      : r.error === "account_suspended" ? "Your account is suspended"
      : r.error;
    redirect(`/onboarding/apply?error=${encodeURIComponent(msg)}`);
  }
  // Next mandatory onboarding step: profile photo.
  redirect("/onboarding/avatar");
}
