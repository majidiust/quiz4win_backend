"use client";

import { useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrScannerModal } from "@/components/qr-scanner";
import { NETWORKS, NETWORKS_BY_ID, parseAddressFromQr, type CryptoNetwork } from "@/lib/data/crypto-networks";
import { addWalletAction } from "./actions";

export default function AddWalletForm() {
  const [networkId, setNetworkId] = useState<string>("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [label, setLabel] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const network: CryptoNetwork | null = networkId ? NETWORKS_BY_ID[networkId] ?? null : null;

  const ok = !!network && network.addressPattern.test(address.trim());

  function reset() {
    setNetworkId(""); setAddress(""); setMemo(""); setLabel("");
    setIsDefault(false); setErr(null);
  }

  function onQrResult(text: string) {
    const cleaned = parseAddressFromQr(text);
    setAddress(cleaned);
  }

  async function onPaste() {
    try {
      const t = await navigator.clipboard.readText();
      setAddress(parseAddressFromQr(t));
    } catch {
      setErr("Clipboard access blocked. Type the address manually.");
    }
  }

  return (
    <>
      {!network ? (
        // ── Step 1: pick a network ───────────────────────────────────────────
        <Card>
          <CardTitle className="mb-1">Add a payout wallet</CardTitle>
          <div className="mb-3 text-xs text-[var(--color-q4w-muted)]">
            Choose the network you want earnings paid out on.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => { setNetworkId(n.id); setErr(null); }}
                className="group glass relative flex flex-col items-start gap-1 overflow-hidden rounded-2xl p-3 text-left transition active:scale-[0.98]"
              >
                <span
                  className="absolute inset-0 -z-10 opacity-30 transition group-hover:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${n.color}33 0%, ${n.accent}33 100%)` }}
                />
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-inner"
                  style={{ background: `linear-gradient(135deg, ${n.color}, ${n.accent})` }}
                >
                  {n.token}
                </span>
                <div className="mt-1 text-sm font-medium text-[var(--color-q4w-text)]">{n.shortLabel}</div>
                <div className="line-clamp-2 text-[11px] text-[var(--color-q4w-muted)]">{n.description}</div>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        // ── Step 2: enter address ────────────────────────────────────────────
        <Card>
          <div className="mb-3 flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${network.color}, ${network.accent})` }}
            >
              {network.token}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{network.shortLabel}</div>
              <div className="text-[11px] text-[var(--color-q4w-muted)]">{network.chain}</div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-[var(--color-q4w-muted)] hover:text-[var(--color-q4w-text)]"
            >
              Change
            </button>
          </div>

          <form action={addWalletAction} className="flex flex-col gap-3">
            <input type="hidden" name="method_type" value={network.id} />

            <div>
              <Input
                label="Wallet address"
                name="address"
                value={address}
                onChange={(e) => { setAddress(e.target.value.trim()); setErr(null); }}
                placeholder={network.examplePrefix}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                error={address && !ok ? "Doesn't look right for this network" : null}
                hint={!address ? network.addressHint : undefined}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setScanOpen(true)}
                  className="glass flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs text-[var(--color-q4w-text)] transition active:scale-[0.98]"
                >
                  <QrIcon /> Scan QR
                </button>
                <button
                  type="button"
                  onClick={onPaste}
                  className="glass flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs text-[var(--color-q4w-text)] transition active:scale-[0.98]"
                >
                  <PasteIcon /> Paste
                </button>
              </div>
            </div>

            {network.supportsMemo ? (
              <Input
                label={network.memoLabel ?? "Memo (optional)"}
                name="memo" value={memo} onChange={(e) => setMemo(e.target.value)}
                placeholder="Some exchanges require a memo/tag"
              />
            ) : null}

            <Input
              label="Label (optional)" name="label" value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My main Binance wallet" maxLength={80}
            />

            <label className="glass flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-sm">
              <input
                type="checkbox" name="is_default" checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="accent-[var(--color-q4w-primary)]"
              />
              <span className="flex-1">Set as default after verification</span>
            </label>

            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/8 p-3 text-[11px] text-amber-200/90">
              ⚠️ Double-check the address — funds sent to a wrong network or wallet
              are <strong>permanently lost</strong>. Quiz4Win admins verify before activation.
            </div>

            {err ? (
              <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>
            ) : null}

            <Button type="submit" disabled={!ok}>Submit for verification</Button>
          </form>
        </Card>
      )}

      <QrScannerModal open={scanOpen} onClose={() => setScanOpen(false)} onResult={onQrResult} />
    </>
  );
}

function QrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden className="opacity-90">
      <path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h2v2h-2zM15 12h2v2h-2zM12 15h2v2h-2zM15 15h2v2h-2z" fill="currentColor" />
    </svg>
  );
}
function PasteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden className="opacity-90">
      <path d="M7 3h6v2h2a1 1 0 011 1v11a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h2V3zm1 2v1h4V5H8z" fill="currentColor" />
    </svg>
  );
}

