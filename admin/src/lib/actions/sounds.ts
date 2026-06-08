"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { uploadObject, deleteObject } from "@/lib/s3";
import { SOUND_USAGES, type SoundUsage } from "@/lib/sound-usages";

const SOUND_USAGE_VALUES = SOUND_USAGES.map((u) => u.value) as string[];
const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg",
  "audio/aac", "audio/mp4", "audio/x-m4a",
];
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface ActionResult { ok: boolean; message: string }

/* ── Upload ──────────────────────────────────────────────────────────── */

export async function uploadSound(
  formData: FormData,
): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);

  const file = formData.get("file");
  const name = (formData.get("name") as string | null)?.trim();
  const usage = formData.get("usage") as SoundUsage | null;

  if (!file || !(file instanceof Blob)) return { ok: false, message: "No file provided" };
  if (!name)                            return { ok: false, message: "Name is required" };
  if (!usage || !SOUND_USAGE_VALUES.includes(usage)) return { ok: false, message: "Invalid usage" };
  if (file.size > MAX_BYTES)            return { ok: false, message: "File exceeds 50 MB" };

  const mimeType = file.type || "audio/mpeg";
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
    return { ok: false, message: "Invalid file type. Allowed: MP3, WAV, OGG, AAC, M4A" };
  }

  const rawExt = mimeType.split("/")[1];
  const ext = rawExt === "mpeg" ? "mp3" : rawExt === "x-m4a" ? "m4a" : rawExt;
  const key = `sounds/${usage}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  let publicUrl: string;
  try {
    const buf = await file.arrayBuffer();
    const res = await uploadObject(key, buf, mimeType, "public-read");
    if (!res.publicUrl) return { ok: false, message: "Upload succeeded but no public URL returned" };
    publicUrl = res.publicUrl;
  } catch (err) {
    return { ok: false, message: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("app_sounds").insert({
    name, usage, url: publicUrl, s3_key: key,
    mime_type: mimeType, file_size_bytes: file.size,
    is_active: true, uploaded_by: admin.id,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();

  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id, action: "sound_uploaded", target_type: "app_sound",
    target_id: data.id, details: { name, usage },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/sounds");
  return { ok: true, message: "Sound uploaded", id: data.id };
}

/* ── Update ──────────────────────────────────────────────────────────── */

export async function updateSound(
  id: string,
  patch: { name?: string; usage?: SoundUsage; is_active?: boolean },
): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);

  if (patch.usage && !SOUND_USAGE_VALUES.includes(patch.usage)) {
    return { ok: false, message: "Invalid usage" };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("app_sounds")
    .update({ ...(patch as Record<string, unknown>), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/sounds");
  return { ok: true, message: "Sound updated" };
}

/* ── Delete ──────────────────────────────────────────────────────────── */

export async function deleteSound(id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data: row } = await db.from("app_sounds").select("s3_key, name").eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "Sound not found" };

  try { await deleteObject(row.s3_key); } catch (e) {
    console.error("[sounds] S3 delete failed, continuing:", e);
  }

  const { error } = await db.from("app_sounds").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id, action: "sound_deleted", target_type: "app_sound",
    target_id: id, details: { name: row.name },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/sounds");
  return { ok: true, message: "Sound deleted" };
}
