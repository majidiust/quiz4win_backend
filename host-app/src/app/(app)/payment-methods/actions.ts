"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

const METHODS = ["iban", "bank_account", "paypal", "usdt_trc20", "usdt_erc20", "btc", "other"];

export async function addMethodAction(formData: FormData) {
  const methodType = String(formData.get("method_type") ?? "");
  if (!METHODS.includes(methodType)) {
    redirect(`/payment-methods?error=${encodeURIComponent("Invalid method")}`);
  }
  const label = String(formData.get("label") ?? "").trim() || null;
  const isDefault = formData.get("is_default") === "on";

  const details: Record<string, string> = {};
  for (const k of ["account_holder", "iban", "swift", "bank_name", "account_number",
                   "email", "address", "network", "memo", "country"]) {
    const v = String(formData.get(k) ?? "").trim();
    if (v) details[k] = v;
  }
  if (Object.keys(details).length === 0) {
    redirect(`/payment-methods?error=${encodeURIComponent("Account details required")}`);
  }
  const r = await api("/host/payment-methods", {
    method: "POST",
    body: { method_type: methodType, label, account_details: details, is_default: isDefault },
  });
  if (!r.ok) redirect(`/payment-methods?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/payment-methods");
  redirect("/payment-methods?info=Submitted%20for%20verification");
}

export async function deleteMethodAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const r = await api(`/host/payment-methods/${id}`, { method: "DELETE" });
  revalidatePath("/payment-methods");
  if (!r.ok) redirect(`/payment-methods?error=${encodeURIComponent(r.error)}`);
}

export async function setDefaultAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await api(`/host/payment-methods/${id}`, { method: "PATCH", body: { is_default: true } });
  revalidatePath("/payment-methods");
}
