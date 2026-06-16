"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";

export async function patchSession(gameId: string, patch: {
  camera_ok?: boolean; mic_ok?: boolean; connection_ok?: boolean; status?: "testing" | "ready";
}) {
  const r = await api(`/host/games/${gameId}/stream-session`, { method: "POST", body: patch });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}

export async function goLive(gameId: string) {
  const r = await api<{ token: string; room_name: string; identity: string }>(
    `/host/games/${gameId}/stream-session/live`, { method: "POST" });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}

export async function endStream(gameId: string, opts: { failed?: boolean; reason?: string } = {}) {
  const r = await api(`/host/games/${gameId}/stream-session/end`, { method: "POST", body: opts });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}
