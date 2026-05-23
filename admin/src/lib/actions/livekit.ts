"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ActionResult { ok: boolean; message: string; data?: Record<string, unknown> }

const LIVEKIT_URL = process.env.LIVEKIT_SERVER_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";

async function livekitFetch(path: string, body?: unknown): Promise<unknown> {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY) throw new Error("LiveKit not configured");
  const res = await fetch(`${LIVEKIT_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LIVEKIT_API_KEY}` },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => ({}));
}

const configured = () => !!LIVEKIT_URL && !!LIVEKIT_API_KEY;

/* Create room */
const CreateRoomSchema = z.object({
  name: z.string().trim().min(1).max(200),
  empty_timeout: z.coerce.number().int().min(0).optional(),
  max_participants: z.coerce.number().int().min(1).optional(),
});

export async function createRoom(input: z.infer<typeof CreateRoomSchema>): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  const parsed = CreateRoomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    await livekitFetch("/twirp/livekit.RoomService/CreateRoom", {
      name: parsed.data.name,
      empty_timeout: parsed.data.empty_timeout ?? 300,
      max_participants: parsed.data.max_participants ?? 10000,
    });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_room_created", target_type: "livekit_room", target_id: parsed.data.name, created_at: new Date().toISOString() });
    revalidatePath("/livekit");
    return { ok: true, message: `Room ${parsed.data.name} created` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function deleteRoom(name: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    await livekitFetch("/twirp/livekit.RoomService/DeleteRoom", { room: name });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_room_deleted", target_type: "livekit_room", target_id: name, created_at: new Date().toISOString() });
    revalidatePath("/livekit");
    return { ok: true, message: `Room ${name} ended` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function kickParticipant(room: string, identity: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    await livekitFetch("/twirp/livekit.RoomService/RemoveParticipant", { room, identity });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_participant_kicked", target_type: "livekit_participant", target_id: identity, details: { room }, created_at: new Date().toISOString() });
    revalidatePath(`/livekit/${room}`);
    return { ok: true, message: `${identity} removed` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function muteParticipant(room: string, identity: string, track_sid: string, muted: boolean): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    await livekitFetch("/twirp/livekit.RoomService/MutePublishedTrack", { room, identity, track_sid, muted });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: muted ? "livekit_participant_muted" : "livekit_participant_unmuted", target_type: "livekit_participant", target_id: identity, details: { room, track_sid }, created_at: new Date().toISOString() });
    revalidatePath(`/livekit/${room}`);
    return { ok: true, message: muted ? "Muted" : "Unmuted" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function sendRoomData(room: string, payload: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  if (!payload.trim()) return { ok: false, message: "Payload required" };
  try {
    const encoded = Buffer.from(payload).toString("base64");
    await livekitFetch("/twirp/livekit.RoomService/SendData", { room, data: encoded, kind: "RELIABLE" });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_data_sent", target_type: "livekit_room", target_id: room, created_at: new Date().toISOString() });
    return { ok: true, message: "Data sent" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function startEgress(room: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    const result = (await livekitFetch("/twirp/livekit.Egress/StartRoomCompositeEgress", {
      room_name: room,
      layout: "grid",
      file_outputs: [{ filepath: `recordings/${room}-{time}.mp4` }],
    })) as { egress_id?: string };
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_egress_started", target_type: "livekit_egress", target_id: result.egress_id ?? room, details: { room }, created_at: new Date().toISOString() });
    return { ok: true, message: `Recording started`, data: { egress_id: result.egress_id } };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function stopEgress(egress_id: string): Promise<ActionResult> {
  const admin = await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, message: "LiveKit not configured" };
  try {
    await livekitFetch("/twirp/livekit.Egress/StopEgress", { egress_id });
    const db = createSupabaseAdminClient();
    await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "livekit_egress_stopped", target_type: "livekit_egress", target_id: egress_id, created_at: new Date().toISOString() });
    return { ok: true, message: "Recording stopped" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Failed" }; }
}

export async function listEgress(room?: string): Promise<{ items: unknown[]; configured: boolean }> {
  await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { items: [], configured: false };
  try {
    const result = (await livekitFetch("/twirp/livekit.Egress/ListEgress", room ? { room_name: room } : {})) as { items?: unknown[] };
    return { items: result.items ?? [], configured: true };
  } catch { return { items: [], configured: true }; }
}

export async function listRoomParticipants(name: string): Promise<{ participants: unknown[]; configured: boolean }> {
  await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { participants: [], configured: false };
  try {
    const result = (await livekitFetch("/twirp/livekit.RoomService/ListParticipants", { room: name })) as { participants?: unknown[] };
    return { participants: result.participants ?? [], configured: true };
  } catch { return { participants: [], configured: true }; }
}
