"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Hosts                                                                */
/* ------------------------------------------------------------------ */

const HostSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bio: z.string().trim().max(500).optional(),
  avatar_url: z.string().url().optional(),
});

export async function createHost(input: z.infer<typeof HostSchema>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);
  const parsed = HostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("show_hosts").insert({
    ...parsed.data,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/shows");
  return { ok: true, message: "Host created" };
}

/* ------------------------------------------------------------------ */
/* Show lifecycle                                                        */
/* ------------------------------------------------------------------ */

const ShowSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).optional(),
  host_id: z.string().uuid().optional(),
  entry_fee: z.number().min(0).default(0),
  prize_pool: z.number().min(0).default(0),
  scheduled_at: z.string().optional(),
  description: z.string().trim().max(1000).optional(),
});

export async function createShow(input: z.infer<typeof ShowSchema>): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = ShowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("games")
    .insert({
      ...parsed.data,
      mode: "live",
      status: "upcoming",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "show_created", target_type: "show", target_id: data.id, created_at: new Date().toISOString() });
  revalidatePath("/shows");
  return { ok: true, message: "Show created", id: data.id };
}

export async function updateShow(showId: string, input: Partial<z.infer<typeof ShowSchema>>): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data: show } = await db.from("games").select("status").eq("id", showId).eq("mode", "live").maybeSingle();
  if (!show) return { ok: false, message: "Show not found" };
  if (!["upcoming", "open"].includes(show.status)) return { ok: false, message: "Cannot edit a show that has started" };

  const { error } = await db.from("games").update({ ...input, updated_at: new Date().toISOString() } as Record<string, unknown>).eq("id", showId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/shows/${showId}`);
  revalidatePath("/shows");
  return { ok: true, message: "Show updated" };
}

export async function startShow(showId: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { data: show } = await db.from("games").select("status").eq("id", showId).eq("mode", "live").maybeSingle();
  if (!show) return { ok: false, message: "Show not found" };
  if (!["upcoming", "open"].includes(show.status)) return { ok: false, message: "Show already started or ended" };

  const { error } = await db.from("games").update({ status: "live", started_at: new Date().toISOString() }).eq("id", showId);
  if (error) return { ok: false, message: "Failed to start show" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "show_started", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
  revalidatePath(`/shows/${showId}`);
  revalidatePath("/shows");
  return { ok: true, message: "Show started" };
}

export async function endShow(showId: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { data: show } = await db.from("games").select("status").eq("id", showId).eq("mode", "live").maybeSingle();
  if (!show) return { ok: false, message: "Show not found" };
  if (show.status !== "live") return { ok: false, message: "Show is not live" };

  const { error } = await db.from("games").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", showId);
  if (error) return { ok: false, message: "Failed to end show" };

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "show_ended", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
  revalidatePath(`/shows/${showId}`);
  revalidatePath("/shows");
  return { ok: true, message: "Show ended" };
}

export async function advanceShowQuestion(showId: string): Promise<ActionResult> {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const { error } = await (db as ReturnType<typeof createSupabaseAdminClient>).rpc(
    "advance_game_question" as never,
    { p_game_id: showId } as never,
  );
  if (error) return { ok: false, message: `Could not advance question: ${error.message}` };

  revalidatePath(`/shows/${showId}`);
  return { ok: true, message: "Advanced to next question" };
}
