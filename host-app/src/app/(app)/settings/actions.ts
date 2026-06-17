"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Returns the current user's access token so the browser can upload files
 * directly to api.quiz4win.com without going through a Next.js server action
 * (which has a 1 MB default body limit). The session cookie is httpOnly —
 * browser JS cannot read it — so the token must be fetched server-side.
 */
export async function getUploadToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const LANG_OPTIONS = ["en", "ar", "fa", "tr", "es", "pt", "fr", "de"];

export async function updateProfileAction(formData: FormData) {
  // Each settings form only carries a subset of fields — only PATCH the keys
  // actually present so an inner page never wipes the fields it doesn't show.
  const redirectTo = String(formData.get("redirect") || "/settings");
  const body: Record<string, unknown> = {};
  // Languages is a checkbox group: an unchecked group sends nothing, so gate it
  // behind an explicit marker to tell "none selected" apart from "not on form".
  if (formData.has("has_languages")) {
    body.languages = (formData.getAll("languages") as string[]).filter((l) => LANG_OPTIONS.includes(l));
  }
  for (const k of ["country", "phone", "short_bio", "bio",
    "instagram_url", "telegram_url", "youtube_url", "tiktok_url", "twitter_url", "website_url"]) {
    if (!formData.has(k)) continue;
    const v = String(formData.get(k) ?? "").trim();
    body[k] = v || null;
  }
  const r = await api("/host/me", { method: "PATCH", body });
  revalidatePath("/settings");
  revalidatePath(redirectTo);
  revalidatePath("/dashboard");
  if (!r.ok) redirect(`${redirectTo}?error=${encodeURIComponent(r.error)}`);
  redirect(`${redirectTo}?info=Saved`);
}

export async function uploadAvatarAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/settings?error=${encodeURIComponent("Select an image first")}`);
  }
  const upload = new FormData();
  upload.set("file", file);
  const r = await api("/host/me/avatar", { method: "POST", body: upload });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  if (!r.ok) {
    const msg = r.error === "file_too_large" ? "Image too large (max 25 MB)"
      : r.error === "unsupported_mime" ? "Use a JPG, PNG, WEBP or HEIC image"
      : r.error;
    redirect(`/settings?error=${encodeURIComponent(msg)}`);
  }
  redirect("/settings?info=Photo updated");
}

export async function signOutAction() {
  // Best-effort: revoke the server-side refresh token via the custom
  // branded route (R-11.3). Failures are swallowed — local sign-out below
  // always succeeds regardless of network state.
  try { await api("/auth/signout", { method: "POST" }); } catch { /* ignore */ }

  // Local sign-out: drop every cookie whose name starts with sb-...-auth-token
  // (including chunked variants .0/.1/...).
  const store = await cookies();
  for (const c of store.getAll()) {
    if (/^sb-[^.]+-auth-token(\.\d+)?$/.test(c.name)) {
      store.delete(c.name);
    }
  }
  redirect("/signin");
}
