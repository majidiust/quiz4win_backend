"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import type { ARBackground } from "./ar-panel";

export async function patchSession(gameId: string, patch: {
  camera_ok?: boolean; mic_ok?: boolean; connection_ok?: boolean; status?: "testing" | "ready";
}) {
  const r = await api(`/host/games/${gameId}/stream-session`, { method: "POST", body: patch });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}

export async function goLive(gameId: string) {
  const r = await api<{ token: string; room_name: string; identity: string; livekit_url: string }>(
    `/host/games/${gameId}/stream-session/live`, { method: "POST" });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}

export async function endStream(gameId: string, opts: { failed?: boolean; reason?: string } = {}) {
  const r = await api(`/host/games/${gameId}/stream-session/end`, { method: "POST", body: opts });
  revalidatePath(`/games/${gameId}/stream`);
  return r;
}

export type GameCommand =
  | "PrepareQuestion" | "StartQuestion" | "CloseQuestion" | "AdvanceQuestion" | "FinalizeGame";

export async function sendGameCommand(
  gameId: string,
  type: GameCommand,
  opts: { questionIndex?: number; timeLimitSeconds?: number } = {},
) {
  return await api<{ ok: boolean; type: string }>(
    `/host/games/${gameId}/command`,
    { method: "POST", body: { type, ...opts } },
  );
}

export async function getARBackgrounds(): Promise<ARBackground[]> {
  const r = await api<{ backgrounds: ARBackground[] }>("/host/ar-backgrounds");
  if (r.ok && r.data) return r.data.backgrounds;
  return [];
}
