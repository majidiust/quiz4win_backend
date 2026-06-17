"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { uploadObject } from "@/lib/s3";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

export async function startGame(gameId: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { data: g } = await db.from("games").select("status").eq("id", gameId).maybeSingle();
  if (!g) return { ok: false, message: "Game not found" };
  if (!["upcoming", "open"].includes(g.status)) return { ok: false, message: "Only upcoming/open games can be started" };

  const { error } = await db.from("games").update({ status: "live", started_at: new Date().toISOString() }).eq("id", gameId);
  if (error) return { ok: false, message: "Failed to start game" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "game_started", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  return { ok: true, message: "Game started" };
}

export async function endGame(gameId: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { data: g } = await db.from("games").select("status").eq("id", gameId).maybeSingle();
  if (!g) return { ok: false, message: "Game not found" };
  if (g.status !== "live") return { ok: false, message: "Only live games can be ended" };

  const { error } = await db.from("games").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", gameId);
  if (error) return { ok: false, message: "Failed to end game" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "game_ended", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  return { ok: true, message: "Game ended" };
}

const CancelSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

export async function cancelGame(input: z.infer<typeof CancelSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = CancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const { id, reason } = parsed.data;
  const db = createSupabaseAdminClient();

  const { data: g } = await db.from("games").select("status").eq("id", id).maybeSingle();
  if (!g) return { ok: false, message: "Game not found" };
  if (["completed", "cancelled"].includes(g.status)) return { ok: false, message: "Game already ended or cancelled" };

  const { error } = await db.from("games").update({ status: "cancelled", cancelled_reason: reason }).eq("id", id);
  if (error) return { ok: false, message: "Failed to cancel game" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "game_cancelled", target_type: "game", target_id: id, details: { reason }, created_at: new Date().toISOString() });
  revalidatePath(`/games/${id}`);
  revalidatePath("/games");
  return { ok: true, message: "Game cancelled" };
}

export async function advanceQuestion(gameId: string): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  // Try RPC first; fall back gracefully if it doesn't exist yet
  const { error } = await (db as ReturnType<typeof createSupabaseAdminClient>).rpc(
    "advance_game_question" as never,
    { p_game_id: gameId } as never,
  );
  if (error) return { ok: false, message: `Could not advance question: ${error.message}` };

  revalidatePath(`/games/${gameId}`);
  return { ok: true, message: "Advanced to next question" };
}

/* ------------------------------------------------------------------ */
/* Create / Update                                                      */
/* ------------------------------------------------------------------ */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color #RRGGBB").optional();

// SUPPORTED_CURRENCIES lives in @/lib/games-constants because non-function
// exports are not allowed from a "use server" module — they get rewritten to
// server-action refs in the client bundle and break `Array.map` at render time.

const GameSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).optional(),
  mode: z.enum(["timed", "battle", "daily", "tournament", "live"]),
  category: z.string().trim().max(80).optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  language: z.enum(["en", "ar", "fa", "tr"]).optional(),
  // Full set of languages every generated question must be produced in.
  // `language` is the default display language and is always force-included.
  target_languages: z.array(z.enum(["en", "ar", "fa", "tr"])).min(1).optional(),
  entry_fee: z.number().min(0),
  prize_pool: z.number().min(0),
  prize_pool_currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  is_featured: z.boolean().optional(),
  max_players: z.number().int().positive().optional(),
  time_per_question: z.number().int().min(3).max(300).optional(),
  allowed_wrong_answers: z.number().int().min(0).max(100).optional(),
  questions_count: z.number().int().min(1).max(1000).optional(),
  scheduled_at: z.string().optional(),
  description: z.string().trim().max(1000).optional(),
  // Styling fields
  accent_color: hexColor,
  glow_color: hexColor,
  gradient_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  // Meta fields
  sponsor: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().max(50)).optional(),
  // Host fields
  host_id: z.string().uuid().nullable().optional(),
  host_name: z.string().trim().max(200).optional(),
  host_title: z.string().trim().max(200).optional(),
  rules: z.array(z.string().trim().max(500)).optional(),
});

// Validates that the requested host_id is approved/active and has no
// schedule conflict with the proposed game window. Returns the host name
// for denormalised storage on games.host_name. Pass `null` to skip checks
// (the caller will write host_id=null and clear host_name).
async function resolveHostAssignment(
  db: ReturnType<typeof createSupabaseAdminClient>,
  hostId: string | null,
  gameId: string | null,
): Promise<{ ok: true; name: string | null } | { ok: false; message: string }> {
  if (!hostId) return { ok: true, name: null };
  const { data: h } = await db.from("show_hosts")
    .select("name, application_status, status").eq("id", hostId).maybeSingle();
  if (!h) return { ok: false, message: "Selected host not found" };
  if (h.application_status !== "approved" || h.status !== "active") {
    return { ok: false, message: "Selected host is not approved or active" };
  }
  if (gameId) {
    const { data: conflict } = await db.rpc("check_host_schedule_conflict",
      { p_host_id: hostId, p_game_id: gameId });
    if (conflict === true) {
      return { ok: false, message: "Schedule conflict — host has another show in this window" };
    }
  }
  return { ok: true, name: (h as { name: string }).name };
}

export async function createGame(input: z.infer<typeof GameSchema>): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = GameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { host_id, ...rest } = parsed.data;

  // Pre-validate host status before inserting so we never create an orphaned
  // game when the admin pointed at a suspended host. The conflict check
  // requires an existing game row, so it runs after the insert.
  if (host_id) {
    const pre = await resolveHostAssignment(db, host_id, null);
    if (!pre.ok) return { ok: false, message: pre.message };
    // host_name is denormalised on games for the customer UI; auto-populate
    // when the admin didn't type one explicitly.
    if (!rest.host_name) rest.host_name = pre.name ?? undefined;
  }

  const { data, error } = await db
    .from("games")
    .insert({ ...rest, host_id: null, status: "upcoming", created_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  const newId = data.id as string;

  // Now claim the host_id atomically with the conflict check.
  if (host_id) {
    const post = await resolveHostAssignment(db, host_id, newId);
    if (!post.ok) {
      return { ok: true, message: `Game created without host — ${post.message}`, id: newId };
    }
    await db.from("games").update({ host_id, updated_at: new Date().toISOString() })
      .eq("id", newId).is("host_id", null);
  }

  await db.from("admin_audit_log").insert({
    admin_id: admin.id, action: "game_created", target_type: "game", target_id: newId,
    details: host_id ? { host_id } : null, created_at: new Date().toISOString(),
  });
  revalidatePath("/games");
  return { ok: true, message: "Game created", id: newId };
}

export async function updateGame(gameId: string, input: Partial<z.infer<typeof GameSchema>>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data: g } = await db.from("games").select("status, host_id").eq("id", gameId).maybeSingle();
  if (!g) return { ok: false, message: "Game not found" };
  if (!["upcoming", "open"].includes(g.status)) return { ok: false, message: "Cannot edit a started or ended game" };

  // host_id transitions need extra validation (INV-17 + host approved check).
  const patch: Record<string, unknown> = { ...input };
  if (Object.prototype.hasOwnProperty.call(input, "host_id")) {
    const next = input.host_id ?? null;
    if (next !== (g.host_id ?? null)) {
      const r = await resolveHostAssignment(db, next, gameId);
      if (!r.ok) return { ok: false, message: r.message };
      if (next && !input.host_name) patch.host_name = r.name ?? undefined;
      if (!next) patch.host_name = null;
    }
  }
  patch.updated_at = new Date().toISOString();
  const { error } = await db.from("games").update(patch).eq("id", gameId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  return { ok: true, message: "Game updated" };
}

/* ------------------------------------------------------------------ */
/* Participants                                                          */
/* ------------------------------------------------------------------ */

export async function removeParticipant(gameId: string, userId: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { error } = await db.from("game_participants").delete().eq("game_id", gameId).eq("user_id", userId);
  if (error) return { ok: false, message: "Failed to remove participant" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "participant_removed", target_type: "game", target_id: `${gameId}:${userId}`, created_at: new Date().toISOString() });
  revalidatePath(`/games/${gameId}`);
  return { ok: true, message: "Participant removed" };
}

/* ------------------------------------------------------------------ */
/* Asset Upload                                                          */
/* ------------------------------------------------------------------ */

const ASSET_FIELDS = ["icon", "thumbnail_url", "poster_url", "host_avatar_url"] as const;
type AssetField = typeof ASSET_FIELDS[number];

export async function uploadGameAsset(
  gameId: string,
  field: AssetField,
  formData: FormData,
): Promise<ActionResult & { url?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);

  if (!ASSET_FIELDS.includes(field)) {
    return { ok: false, message: `Invalid field. Allowed: ${ASSET_FIELDS.join(", ")}` };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return { ok: false, message: "No file provided" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: "File exceeds 10 MB limit" };
  }

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" };
  }

  const ext = file.type.split("/")[1].replace("svg+xml", "svg");
  const key = `games/${gameId}/${field}-${Date.now()}.${ext}`;

  let uploadResult;
  try {
    const buffer = await file.arrayBuffer();
    uploadResult = await uploadObject(key, buffer, file.type, "public-read");
  } catch (err) {
    return { ok: false, message: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("games")
    .update({ [field]: uploadResult.publicUrl, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", gameId);

  if (error) return { ok: false, message: `DB update failed: ${error.message}` };

  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "game_asset_uploaded",
    target_type: "game",
    target_id: gameId,
    details: { field, url: uploadResult.publicUrl },
    created_at: new Date().toISOString(),
  });

  revalidatePath(`/games/${gameId}`);
  return { ok: true, message: `${field} updated`, url: uploadResult.publicUrl ?? undefined };
}
