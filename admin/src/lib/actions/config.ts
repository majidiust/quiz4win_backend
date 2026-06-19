"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string }

/* ------------------------------------------------------------------ */
/* Update a single config key                                           */
/* ------------------------------------------------------------------ */
export async function updateConfigKey(key: string, value: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!key.trim()) return { ok: false, message: "Key is required" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("app_config").upsert(
    { key, value, updated_by: admin.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: "Failed to update config" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "config_updated",
    target_type: "app_config",
    details: { key },
    created_at: new Date().toISOString(),
  });

  revalidatePath("/config");
  return { ok: true, message: `Config key "${key}" updated` };
}

/* ------------------------------------------------------------------ */
/* Host applications toggle                                             */
/* ------------------------------------------------------------------ */
export async function toggleHostApplications(enabled: boolean): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error } = await db.from("app_config").upsert(
    { key: "feature_host_applications", value: String(enabled), value_type: "boolean", updated_by: admin.id, updated_at: now },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: "Failed to update host applications setting" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: enabled ? "host_applications_enabled" : "host_applications_disabled",
    target_type: "app_config",
    created_at: now,
  });

  revalidatePath("/config");
  return { ok: true, message: `Host applications ${enabled ? "enabled" : "disabled"}` };
}

/* ------------------------------------------------------------------ */
/* Monetization mode                                                    */
/* ------------------------------------------------------------------ */
const MonetizationSchema = z.object({
  mode: z.enum(["none", "coin", "usd"]),
  coinName: z.string().trim().max(40).optional(),
  coinSymbol: z.string().trim().max(10).optional(),
  rateMicros: z.number().int().positive().optional(), // micro-USD per coin (R-02)
});

export async function setMonetizationMode(
  input: z.infer<typeof MonetizationSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = MonetizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { mode, coinName, coinSymbol, rateMicros } = parsed.data;

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const rows: { key: string; value: string; value_type: string; updated_by: string; updated_at: string }[] = [
    { key: "monetization_mode", value: mode, value_type: "string", updated_by: admin.id, updated_at: now },
  ];
  if (coinName !== undefined)
    rows.push({ key: "coin_name", value: coinName, value_type: "string", updated_by: admin.id, updated_at: now });
  if (coinSymbol !== undefined)
    rows.push({ key: "coin_symbol", value: coinSymbol, value_type: "string", updated_by: admin.id, updated_at: now });
  if (rateMicros !== undefined)
    rows.push({ key: "coin_usd_rate_micros", value: String(rateMicros), value_type: "number", updated_by: admin.id, updated_at: now });

  const { error } = await db.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, message: "Failed to update monetization mode" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "monetization_mode_changed",
    target_type: "app_config",
    details: { mode, coinName, coinSymbol, rateMicros },
    created_at: now,
  });

  revalidatePath("/config");
  return { ok: true, message: `Monetization mode set to "${mode}"` };
}

/* ------------------------------------------------------------------ */
/* Maintenance mode toggle                                              */
/* ------------------------------------------------------------------ */
export async function toggleMaintenanceMode(enabled: boolean, message?: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin"]);
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const rows = [
    { key: "maintenance_mode", value: String(enabled), updated_by: admin.id, updated_at: now },
    ...(message ? [{ key: "maintenance_message", value: message, updated_by: admin.id, updated_at: now }] : []),
  ];

  const { error } = await db.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, message: "Failed to toggle maintenance mode" };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: enabled ? "maintenance_enabled" : "maintenance_disabled",
    target_type: "app_config",
    created_at: now,
  });

  revalidatePath("/config");
  return { ok: true, message: `Maintenance mode ${enabled ? "enabled" : "disabled"}` };
}

/* ------------------------------------------------------------------ */
/* Help articles                                                        */
/* ------------------------------------------------------------------ */
const ArticleSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1),
  category: z.enum(["payments", "kyc", "games", "account", "general"]),
  language: z.enum(["en", "ar", "fa", "tr"]).default("en"),
  is_published: z.boolean().default(false),
});

export async function createHelpArticle(input: z.infer<typeof ArticleSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = ArticleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("help_articles").insert({
    ...parsed.data,
    created_by: admin.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Failed to create help article" };

  revalidatePath("/config");
  return { ok: true, message: "Help article created" };
}

export async function toggleHelpArticle(id: string, is_published: boolean): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("help_articles")
    .update({ is_published, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: "Failed to update article" };
  revalidatePath("/config");
  return { ok: true, message: is_published ? "Article published" : "Article unpublished" };
}
