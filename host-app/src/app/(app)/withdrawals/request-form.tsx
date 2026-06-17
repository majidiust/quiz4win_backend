"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestWithdrawalAction } from "./actions";

interface PaymentMethod {
  id: string;
  method_type: string;
  label: string | null;
  status: string;
  account_details: Record<string, string> | null;
}

interface Props {
  methods: PaymentMethod[];
  walletBalance: number;
}

function SubmitBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={disabled || pending}>
      Request Payout
    </Button>
  );
}

export default function RequestWithdrawalForm({ methods, walletBalance }: Props) {
  const activeMethods = methods.filter((m) => m.status === "active");
  const [selectedId, setSelectedId] = useState(activeMethods[0]?.id ?? "");
  const [amount, setAmount] = useState("");

  const amountNum = Number.parseFloat(amount);
  const amountOk = Number.isFinite(amountNum) && amountNum >= 10 && amountNum <= walletBalance;

  if (activeMethods.length === 0) {
    return (
      <Card className="border-amber-400/30 bg-amber-500/8">
        <div className="text-sm text-amber-200/90">
          ⚠️ You don&apos;t have any active payout method. Please{" "}
          <a href="/payment-methods" className="underline">add and verify a crypto wallet</a> first.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle className="mb-4">Request Payout</CardTitle>
      <form action={requestWithdrawalAction} className="flex flex-col gap-4">
        {/* Payment method selector */}
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/55">Payout Method</div>
          <div className="flex flex-col gap-2">
            {activeMethods.map((m) => {
              const acct = m.account_details ?? {};
              const addr = acct.address ?? "";
              const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
              const isSelected = selectedId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={`glass flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    isSelected ? "border-white/30 bg-white/10" : "border-white/10"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[11px] font-bold text-white">
                    {m.method_type.toUpperCase().slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.label ?? m.method_type.replace(/_/g, " ").toUpperCase()}</div>
                    {shortAddr ? (
                      <div className="font-mono text-[11px] text-[var(--color-q4w-muted)]">{shortAddr}</div>
                    ) : null}
                  </div>
                  {isSelected ? <span className="text-[var(--color-q4w-primary)]">✓</span> : null}
                </button>
              );
            })}
          </div>
          <input type="hidden" name="payment_method_id" value={selectedId} />
        </div>

        {/* Amount */}
        <Input
          label="Amount (USD)"
          name="amount"
          type="number"
          min="10"
          step="0.01"
          max={walletBalance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Min. $10.00"
          error={amount && !amountOk
            ? amountNum < 10 ? "Minimum is $10" : `Exceeds balance ($${walletBalance.toFixed(2)})`
            : null}
          hint={`Available: $${walletBalance.toFixed(2)}`}
        />

        {/* Note */}
        <Textarea
          label="Note (optional)"
          name="note"
          placeholder="Any additional information for the admin…"
          maxLength={500}
        />

        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/8 p-3 text-[11px] text-amber-200/90">
          ⚠️ The amount will be held from your balance immediately. It will be returned if the request is rejected.
        </div>

        <SubmitBtn disabled={!selectedId || !amountOk} />
      </form>
    </Card>
  );
}
