"use client";

/**
 * Tap-to-preview for a verification file. Resolves a short-lived view URL on
 * click (via the getFilePreviewUrl server action) and opens an in-app modal
 * with the proper viewer for the file's MIME type:
 *   • image/*           → inline <img>
 *   • video/*           → inline <video controls>
 *   • application/pdf   → inline <iframe>
 *   • anything else     → "Open in new tab" link
 */

import { useState, useTransition } from "react";
import { ExternalLink, X } from "lucide-react";
import { getFilePreviewUrl } from "./actions";

type Kind = "image" | "video" | "pdf" | "other";

function kindFor(mime: string): Kind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

export function FilePreview({ fileId, mime, label }: { fileId: string; mime: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kind = kindFor(mime);

  function openPreview() {
    setError(null);
    setOpen(true);
    if (url) return; // already resolved this session
    start(async () => {
      const r = await getFilePreviewUrl(fileId);
      if (r.ok) setUrl(r.url);
      else setError("Couldn't load this file — please try again.");
    });
  }

  function close() { setOpen(false); }

  return (
    <>
      <button type="button" onClick={openPreview} className="text-xs text-[var(--color-q4w-primary)]">
        Preview
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d14] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="truncate text-sm font-semibold capitalize">{label}</span>
              <button onClick={close} aria-label="Close" className="rounded-full p-1 text-white/50 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-auto bg-black">
              {pending && !url ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : error ? (
                <p className="px-6 py-10 text-center text-sm text-rose-400">{error}</p>
              ) : url ? (
                kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={label} className="max-h-[78vh] w-auto object-contain" />
                ) : kind === "video" ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={url} controls playsInline className="max-h-[78vh] w-full bg-black" />
                ) : kind === "pdf" ? (
                  <iframe src={url} title={label} className="h-[78vh] w-full bg-white" />
                ) : (
                  <div className="px-6 py-10 text-center text-sm text-white/60">
                    This file type can&apos;t be previewed here.
                  </div>
                )
              ) : null}
            </div>

            {/* Footer */}
            {url ? (
              <div className="border-t border-white/10 px-4 py-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--color-q4w-primary)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
