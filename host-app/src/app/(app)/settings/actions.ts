"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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
