"use server";

import { api } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UploadResult = { ok: true } | { ok: false; error: string };

/**
 * Returns the current user's access token so the browser can upload the intro
 * video directly to api.quiz4win.com — bypassing the Next.js server-action
 * 1 MB body limit (unreliable in standalone/Docker). The session cookie is
 * httpOnly, so the browser-side Supabase client cannot read it; the token must
 * be fetched from the server, where the cookie is accessible.
 */
export async function getUploadToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Uploads the recorded onboarding intro video as an `intro_video` file.
 * Posts multipart FormData to /host/me/files — all S3 handling happens
 * server-side via the shared helper (R-15). Stored private for admin review.
 */
export async function uploadIntroVideoAction(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No recording to upload" };
  const upload = new FormData();
  upload.set("file_type", "intro_video");
  upload.set("file", file);
  const r = await api("/host/me/files", { method: "POST", body: upload });
  if (!r.ok) {
    const msg = r.error === "file_too_large" ? "Recording too large — please record a shorter clip"
      : r.error === "unsupported_mime" ? "This recording format isn't supported"
      : r.error;
    return { ok: false, error: msg };
  }
  return { ok: true };
}
