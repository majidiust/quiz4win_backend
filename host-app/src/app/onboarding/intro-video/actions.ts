"use server";

import { api } from "@/lib/api";

export type UploadResult = { ok: true } | { ok: false; error: string };

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
