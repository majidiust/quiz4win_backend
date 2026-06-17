"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}

/**
 * Bottom-sheet camera modal that scans QR codes. Uses the `qr-scanner` npm
 * package (dynamically imported so it never lands in the SSR bundle). Falls
 * back gracefully when the device denies camera access or doesn't expose a
 * usable camera — the parent form retains its manual-entry path.
 */
export function QrScannerModal({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr(null);
    setReady(false);

    (async () => {
      try {
        const mod = await import("qr-scanner");
        const QrScanner = mod.default;
        if (cancelled || !videoRef.current) return;
        const scanner = new QrScanner(
          videoRef.current,
          (result: { data: string }) => {
            onResult(result.data);
            scanner.stop();
            onClose();
          },
          { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (!cancelled) setReady(true);
      } catch (e) {
        const msg = (e as Error).message ?? "Camera unavailable";
        setErr(
          /denied|permission/i.test(msg)
            ? "Camera permission denied. Allow camera access and try again."
            : "Couldn't open the camera. Paste the address instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      try { scannerRef.current?.stop(); scannerRef.current?.destroy(); } catch { /* noop */ }
      scannerRef.current = null;
    };
  }, [open, onClose, onResult]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mt-auto flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-[var(--color-q4w-border)] bg-[#0B0D14] p-4 pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-30px_60px_-10px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/15" />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Scan wallet QR</div>
            <div className="text-xs text-[var(--color-q4w-muted)]">Point your camera at the QR code</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-[var(--color-q4w-muted)] hover:text-[var(--color-q4w-text)]">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-q4w-border)] bg-black">
          <video
            ref={videoRef}
            className="aspect-square w-full object-cover"
            playsInline
            muted
          />
          {!ready && !err ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
              Starting camera…
            </div>
          ) : null}
          {ready && !err ? (
            <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/60 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]" />
          ) : null}
        </div>

        {err ? (
          <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {err}
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
