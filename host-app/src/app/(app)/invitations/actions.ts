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
