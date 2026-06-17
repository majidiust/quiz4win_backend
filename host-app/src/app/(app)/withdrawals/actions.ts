"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export async function requestWithdrawalAction(formData: FormData) {
  const paymentMethodId = String(formData.get("payment_method_id") ?? "").trim();
  const amountStr = String(formData.get("amount") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || undefined;

  if (!paymentMethodId) {
    redirect(`/withdrawals?error=${encodeURIComponent("Please select a payout method")}`);
  }

  const amount = Number.parseFloat(amountStr);
  if (!Number.isFinite(amount) || amount < 10) {
    redirect(`/withdrawals?error=${encodeURIComponent("Minimum withdrawal amount is $10")}`);
  }

  const r = await api("/host/withdrawals", {
    method: "POST",
    body: { payment_method_id: paymentMethodId, amount, note },
  });

  if (!r.ok) {
    const msg =
      r.error === "insufficient_balance" ? "Insufficient wallet balance" :
      r.error === "withdrawal_already_pending" ? "You already have a pending withdrawal" :
      r.error === "payment_method_not_active" ? "Selected payout method is not active yet" :
      r.error === "amount_must_be_at_least_10" ? "Minimum withdrawal amount is $10" :
      r.error ?? "Failed to submit withdrawal";
    redirect(`/withdrawals?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/withdrawals");
  revalidatePath("/wallet");
  redirect("/withdrawals?success=1");
}
