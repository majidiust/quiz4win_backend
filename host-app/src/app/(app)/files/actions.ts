"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export async function uploadFileAction(formData: FormData) {
  const fileType = String(formData.get("file_type") ?? "other");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/files?error=${encodeURIComponent("Select a file first")}`);
  }
  const upload = new FormData();
  upload.set("file_type", fileType);
  upload.set("file", file);
  const r = await api("/host/me/files", { method: "POST", body: upload });
  revalidatePath("/files");
  if (!r.ok) redirect(`/files?error=${encodeURIComponent(r.error)}`);
  redirect("/files?info=Uploaded");
}

export async function deleteFileAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await api(`/host/me/files/${id}`, { method: "DELETE" });
  revalidatePath("/files");
}
