"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { uploadObject, deleteObject } from "@/lib/s3";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ActionResult { ok: boolean; message: string }

/* ── Upload ──────────────────────────────────────────────────────────── */

export async function uploadARBackground(formData: FormData): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);

  const file = formData.get("file");
  const name = (formData.get("name") as string | null)?.trim();

  if (!file || !(file instanceof Blob)) return { ok: false, message: "No file provided" };
  if (!name) return { ok: false, message: "Name is required" };
  if (file.size > MAX_BYTES) return { ok: false, message: "File exceeds 10 MB" };

  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return { ok: false, message: "Invalid file type. Allowed: JPEG, PNG, WEBP, GIF" };
  }

  const rawExt = mimeType.split("/")[1];
  const ext = rawExt === "jpeg" ? "jpg" : rawExt;
  const key = `ar-backgrounds/${Date.now()}-${crypto.randomUUID()}.${ext}`;

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
  const { data, error } = await db.from("ar_backgrounds").insert({
    name, url: publicUrl, s3_key: key,
    is_active: true, sort_order: 0, uploaded_by: admin.id,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();

  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id, action: "ar_background_uploaded", target_type: "ar_background",
    target_id: data.id, details: { name },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/ar-backgrounds");
  return { ok: true, message: "Background uploaded", id: data.id };
}

/* ── Update ──────────────────────────────────────────────────────────── */

export async function updateARBackground(
  id: string,
  patch: { name?: string; is_active?: boolean; sort_order?: number },
): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("ar_backgrounds")
    .update({ ...(patch as Record<string, unknown>), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ar-backgrounds");
  return { ok: true, message: "Background updated" };
}

/* ── Delete ──────────────────────────────────────────────────────────── */

export async function deleteARBackground(id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data: row } = await db.from("ar_backgrounds").select("s3_key, name").eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "Background not found" };

  try { await deleteObject(row.s3_key); } catch (e) {
    console.error("[ar-backgrounds] S3 delete failed:", e);
  }

  const { error } = await db.from("ar_backgrounds").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id, action: "ar_background_deleted", target_type: "ar_background",
    target_id: id, details: { name: row.name },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/ar-backgrounds");
  return { ok: true, message: "Background deleted" };
}
