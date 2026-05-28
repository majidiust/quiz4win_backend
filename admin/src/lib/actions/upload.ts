"use server";

import { requireAdmin } from "@/lib/auth";
import { uploadObject } from "@/lib/s3";

/**
 * Generic admin file upload to S3 (public-read).
 *
 * Used when a file must be uploaded BEFORE the owning entity exists in the DB
 * (e.g. selecting a host avatar inside a "create host" dialog). The action
 * returns the public URL; the caller then persists that URL alongside the
 * entity it creates.
 *
 * For uploads tied to an already-existing entity (e.g. game icon / thumbnail /
 * poster), use the entity-specific helpers such as `uploadGameAsset` so the DB
 * row is updated atomically.
 */

const ALLOWED_KINDS = ["host-avatar"] as const;
type AssetKind = (typeof ALLOWED_KINDS)[number];

const KIND_PREFIXES: Record<AssetKind, string> = {
  "host-avatar": "hosts/avatars",
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadAsset(
  kind: AssetKind,
  formData: FormData,
): Promise<{ ok: boolean; message: string; url?: string }> {
  await requireAdmin(["super_admin", "admin"]);

  if (!ALLOWED_KINDS.includes(kind)) {
    return { ok: false, message: `Invalid asset kind: ${kind}` };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return { ok: false, message: "No file provided" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "File exceeds 10 MB limit" };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" };
  }

  const ext = file.type.split("/")[1].replace("svg+xml", "svg");
  const key = `${KIND_PREFIXES[kind]}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  try {
    const buffer = await file.arrayBuffer();
    const res = await uploadObject(key, buffer, file.type, "public-read");
    return { ok: true, message: "Uploaded", url: res.publicUrl ?? undefined };
  } catch (err) {
    return { ok: false, message: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
