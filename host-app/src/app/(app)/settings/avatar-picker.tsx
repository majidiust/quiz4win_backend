"use client";

/**
 * Telegram-style profile picture picker.
 *
 * Clicking the avatar circle opens a bottom sheet with two options:
 *   • Take photo   — opens the front-facing camera (capture="user")
 *   • Choose from gallery — standard image file picker
 *
 * On selection the image is previewed immediately in the circle and uploaded
 * directly from the browser to api.quiz4win.com/host/me/avatar (bypassing the
 * Next.js server-action 1 MB body limit). The bearer token is obtained via the
 * getUploadToken server action because the session cookie is httpOnly.
 */

import { useRef, useState, useTransition } from "react";
import { Camera, ImageIcon, X } from "lucide-react";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");

interface Props {
  currentUrl: string | null;
  name: string;
  /** Server-side session token passed from the Server Component (httpOnly cookie inaccessible to browser). */
  uploadToken: string | null;
}

export function AvatarPickerSection({ currentUrl, name, uploadToken }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function closeDialog() { setDialogOpen(false); }

  function handleFile(file: File) {
    closeDialog();
    setError(null);

    // Show a blob preview immediately — no waiting for the upload.
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);

    startTransition(async () => {
      const token = uploadToken;
      if (!token) {
        setError("Session expired — please sign in again.");
        setPreviewUrl(currentUrl);
        return;
      }

      const fd = new FormData();
      fd.set("file", file);

      let res: Response;
      try {
        res = await fetch(`${API_URL}/host/me/avatar`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } catch {
        setError("Network error — please try again.");
        setPreviewUrl(currentUrl);
        return;
      }

      if (!res.ok) {
        let errCode = `http_${res.status}`;
        try { const j = await res.json() as { error?: string }; errCode = j.error ?? errCode; } catch { /* */ }
        const msg = errCode === "file_too_large" ? "Image too large (max 25 MB)"
          : errCode === "unsupported_mime" ? "Use JPG, PNG, WEBP or HEIC"
          : "Upload failed — please try again";
        setError(msg);
        setPreviewUrl(currentUrl);
      }
      // On success: blobUrl stays as preview. It matches the uploaded image.
    });
  }

  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Clickable circle */}
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label="Change profile photo"
        className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-white/20 bg-white/5 transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-white/50">
            {initials || <Camera className="h-8 w-8 text-white/30" />}
          </div>
        )}

        {/* Camera badge overlay */}
        {pending ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        ) : (
          <div className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-fuchsia-500 shadow-lg">
            <Camera className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </button>

      {error ? (
        <p className="text-center text-xs text-rose-400">{error}</p>
      ) : (
        <p className="text-xs text-[var(--color-q4w-muted)]">Tap to change photo</p>
      )}

      {/* Bottom-sheet dialog */}
      {dialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
          onClick={closeDialog}
        >
          <div
            className="w-full rounded-t-3xl border border-white/10 bg-[#0d0d14] p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">Update profile photo</span>
              <button onClick={closeDialog} className="rounded-full p-1 text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/10"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-500/20">
                  <Camera className="h-4.5 w-4.5 text-pink-400" />
                </div>
                <div>
                  <div className="text-sm font-medium">Take photo</div>
                  <div className="text-xs text-[var(--color-q4w-muted)]">Use your front camera</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/10"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/20">
                  <ImageIcon className="h-4.5 w-4.5 text-teal-400" />
                </div>
                <div>
                  <div className="text-sm font-medium">Choose from gallery</div>
                  <div className="text-xs text-[var(--color-q4w-muted)]">JPG, PNG, WEBP or HEIC</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}
