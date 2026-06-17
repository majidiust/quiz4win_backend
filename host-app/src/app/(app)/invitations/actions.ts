"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export async function acceptInvitationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const r = await api(`/host/invitations/${id}/accept`, { method: "POST" });
  if (!r.ok) {
    revalidatePath("/invitations");
    redirect(`/invitations?error=${encodeURIComponent(r.error)}`);
  }
  revalidatePath("/invitations");
  revalidatePath("/dashboard");
  redirect(`/invitations?info=${encodeURIComponent("Accepted")}`);
}

export async function rejectInvitationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!id) return;
  await api(`/host/invitations/${id}/reject`, { method: "POST", body: { note } });
  revalidatePath("/invitations");
  redirect(`/invitations?info=${encodeURIComponent("Rejected")}`);
}

// ── Direct admin assignments (games.host_assignment_status='pending') ────────
// These surface on the Invitations page alongside host_invitations but use the
// game accept/reject endpoints. Redirect back to /invitations to stay in context.
export async function acceptAssignmentAction(formData: FormData) {
  const gameId = String(formData.get("game_id") ?? "");
  if (!gameId) return;
  const r = await api(`/host/games/${gameId}/accept`, { method: "POST", body: {} });
  revalidatePath("/invitations");
  revalidatePath("/games", "layout");
  revalidatePath("/dashboard");
  if (!r.ok) redirect(`/invitations?error=${encodeURIComponent(r.error)}`);
  redirect(`/invitations?info=${encodeURIComponent("Assignment accepted")}`);
}

export async function rejectAssignmentAction(formData: FormData) {
  const gameId = String(formData.get("game_id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!gameId) return;
  const r = await api(`/host/games/${gameId}/reject`, { method: "POST", body: { note: note || null } });
  revalidatePath("/invitations");
  revalidatePath("/games", "layout");
  revalidatePath("/dashboard");
  if (!r.ok) redirect(`/invitations?error=${encodeURIComponent(r.error)}`);
  redirect(`/invitations?info=${encodeURIComponent("Assignment rejected")}`);
}
