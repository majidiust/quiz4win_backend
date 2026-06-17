"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export async function requestGameAction(formData: FormData) {
  const gameId = String(formData.get("game_id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!gameId) redirect(`/games?error=${encodeURIComponent("Game required")}`);
  const r = await api(`/host/games/${gameId}/request`, {
    method: "POST", body: { note: note || null },
  });
  if (!r.ok) {
    redirect(`/games/${gameId}?error=${encodeURIComponent(r.error)}`);
  }
  revalidatePath("/games");
  revalidatePath(`/games/${gameId}`);
  redirect(`/games/${gameId}?info=${encodeURIComponent("Request sent")}`);
}

export async function cancelRequestAction(formData: FormData) {
  const id = String(formData.get("request_id") ?? "");
  if (!id) return;
  const r = await api(`/host/games/requests/${id}`, { method: "DELETE" });
  // Revalidate the games layout so both /games (any tab) and any open
  // /games/[id] detail page pick up the new pending-request set.
  revalidatePath("/games", "layout");
  if (!r.ok) {
    redirect(`/games?tab=requests&error=${encodeURIComponent(r.error)}`);
  }
}
