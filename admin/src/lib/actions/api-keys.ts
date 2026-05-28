"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

const ADMIN_ROLES = ["super_admin", "admin", "moderator", "finance", "support"] as const;

/* ------------------------------------------------------------------ */
/* Token primitives                                                     */
/* ------------------------------------------------------------------ */

/** Public, non-sensitive prefix. Format: q4w_ + 16 hex chars. */
function generateKeyId(): string {
  return "q4w_" + randomBytes(8).toString("hex");
}

/** 32 bytes → 43-char base64url secret. */
function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex — must match the Edge Function helper byte-for-byte. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Create                                                               */
/* ------------------------------------------------------------------ */
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  role: z.enum(ADMIN_ROLES),
  // ISO date string or empty (= never expires).
  expires_at: z.string().trim().optional().or(z.literal("")),
  // Newline-separated list from the textarea; normalised below.
  allowed_domains: z.array(z.string().trim().min(1)).max(50).optional(),
});

export interface CreateApiKeyResult extends ActionResult {
  /** Full `key_id.secret` token. Shown to the operator exactly once. */
  token?: string;
  keyId?: string;
}

export async function createApiKey(
  input: z.infer<typeof CreateSchema>,
): Promise<CreateApiKeyResult> {
  const admin = await requireAdmin(["super_admin"]);
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, description, role, expires_at, allowed_domains } = parsed.data;

  let expiresIso: string | null = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (Number.isNaN(d.getTime())) return { ok: false, message: "Invalid expiration date" };
    if (d.getTime() <= Date.now()) return { ok: false, message: "Expiration must be in the future" };
    expiresIso = d.toISOString();
  }

  const domains = (allowed_domains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const keyId = generateKeyId();
  const secret = generateSecret();
  const token = `${keyId}.${secret}`;

  const db = createSupabaseAdminClient();
  const { error } = await db.from("api_keys").insert({
    key_id: keyId,
    secret_hash: sha256Hex(secret),
    secret_hint: secret.slice(-4),
    name,
    description: description || null,
    role,
    allowed_domains: domains,
    expires_at: expiresIso,
    created_by: admin.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Failed to create API key: " + error.message };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "api_key_created",
    entity_type: "api_key",
    entity_id: keyId,
    details: { name, role, allowed_domains: domains, expires_at: expiresIso },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/api-keys");
  return { ok: true, message: "API key created", token, keyId };
}

/* ------------------------------------------------------------------ */
/* Revoke                                                               */
/* ------------------------------------------------------------------ */
const IdSchema = z.object({ id: z.string().uuid() });

export async function revokeApiKey(input: z.infer<typeof IdSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data: existing, error: lookupErr } = await db
    .from("api_keys")
    .select("id, key_id, revoked_at")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (lookupErr || !existing) return { ok: false, message: "API key not found" };
  if (existing.revoked_at) return { ok: false, message: "API key already revoked" };

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("api_keys")
    .update({ revoked_at: nowIso, updated_at: nowIso })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, message: "Failed to revoke API key" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "api_key_revoked",
    entity_type: "api_key",
    entity_id: existing.key_id,
    details: null,
    created_at: nowIso,
  });

  revalidatePath("/api-keys");
  return { ok: true, message: "API key revoked" };
}
