"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

// Crypto-only payout method types accepted by /host/payment-methods.
// Mirrors PAY_METHODS in supabase/functions/host/index.ts.
const METHODS = [
  "usdt_trc20", "usdt_erc20", "usdt_bep20", "usdt_polygon",
  "btc", "eth", "trx", "bnb", "sol", "ton", "other",
];

export async function addWalletAction(formData: FormData) {
  const methodType = String(formData.get("method_type") ?? "");
  if (!METHODS.includes(methodType)) {
    redirect(`/payment-methods?error=${encodeURIComponent("Invalid network")}`);
  }
  const address = String(formData.get("address") ?? "").trim();
  if (!address) {
    redirect(`/payment-methods?error=${encodeURIComponent("Wallet address required")}`);
  }
  const memo = String(formData.get("memo") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const isDefault = formData.get("is_default") === "on";

  const details: Record<string, string> = { network: methodType, address };
  if (memo) details.memo = memo;

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
