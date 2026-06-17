"use client";

/**
 * Telegram-style profile picture picker.
 *
 * Clicking the avatar circle opens a bottom sheet with three options:
 *   • Choose an avatar — scrollable grid of 40 predefined 3-D avatars (jsDelivr CDN)
 *   • Take photo       — opens an in-app live camera (getUserMedia)
 *   • Choose from gallery — standard image file picker
 *
 * Predefined avatar selection calls PATCH /host/me with { avatar_url } directly
 * (no file upload needed). Custom photo/gallery uploads go to POST /host/me/avatar.
 * The bearer token is obtained via the getUploadToken server action because the
 * session cookie is httpOnly.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ChevronLeft, ImageIcon, Sparkles, SwitchCamera, X } from "lucide-react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");

// Predefined 3-D avatar set (alohe/avatars via jsDelivr CDN — MIT licensed)
// https://github.com/alohe/avatars
const CDN = "https://cdn.jsdelivr.net/gh/alohe/avatars/png";
const PRESET_AVATARS: string[] = [
  // 3-D series (5 pure 3-D characters)
  ...Array.from({ length: 5 }, (_, i) => `${CDN}/3d_${i + 1}.png`),
  // Memo series (35 Memoji-style 3-D characters)
  ...Array.from({ length: 35 }, (_, i) => `${CDN}/memo_${i + 1}.png`),
];

interface Props {
  currentUrl: string | null;
  name: string;
  /** Server-side session token passed from the Server Component (httpOnly cookie inaccessible to browser). */
  uploadToken: string | null;
  /** Optional callback invoked after a new avatar URL is successfully persisted. */
  onChanged?: (url: string) => void;
}

export function AvatarPickerSection({ currentUrl, name, uploadToken, onChanged }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // In-app camera capture (getUserMedia) — more reliable than the file-input
  // `capture` attribute, which silently falls back to a file picker on many
  // browsers/devices. The hidden cameraRef input is kept only as a last resort.
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  function openDialog() { setDialogOpen(true); setShowGrid(false); }
  function closeDialog() { setDialogOpen(false); setShowGrid(false); }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setError(null);
    setCameraError(null);
    // No camera API (e.g. insecure context or unsupported browser) → fall back.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      cameraRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
      streamRef.current = stream;
      setDialogOpen(false);
      setCameraOpen(true);
    } catch {
      // Permission denied or no camera available → native file picker fallback.
      cameraRef.current?.click();
    }
  }

  function closeCamera() { stopStream(); setCameraOpen(false); }

  async function switchCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
      streamRef.current = stream;
      setFacingMode(next);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { /* */ });
      }
    } catch {
      setCameraError("Unable to switch camera.");
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    // Centre-crop to a square so it matches the round avatar frame.
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror the front camera so the saved photo matches the live preview.
    if (facingMode === "user") { ctx.translate(size, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    canvas.toBlob((blob) => {
      if (!blob) { setCameraError("Capture failed — please try again."); return; }
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
      closeCamera();
      handleFile(file);
    }, "image/jpeg", 0.92);
  }

  // Attach the live stream once the <video> element mounts; always stop the
  // camera when the component unmounts.
  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => { /* */ });
    }
  }, [cameraOpen]);

  useEffect(() => () => stopStream(), []);

  async function patchAvatarUrl(url: string): Promise<boolean> {
    if (!uploadToken) return false;
    try {
      const res = await fetch(`${API_URL}/host/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${uploadToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url: url }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function handlePredefinedAvatar(url: string) {
    closeDialog();
    setError(null);
    setPreviewUrl(url); // optimistic preview

    startTransition(async () => {
      if (!uploadToken) {
        setError("Session expired — please sign in again.");
        setPreviewUrl(currentUrl);
        return;
      }
      const ok = await patchAvatarUrl(url);
      if (!ok) {
        setError("Failed to update avatar — please try again.");
        setPreviewUrl(currentUrl);
      } else {
        onChanged?.(url);
      }
    });
  }

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
      } else {
        // On success: blobUrl stays as preview — it matches the uploaded image.
        onChanged?.(blobUrl);
      }
    });
  }

  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Clickable avatar circle */}
      <button
        type="button"
        onClick={openDialog}
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

        {/* Spinner / camera badge */}
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
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              {showGrid ? (
                <button
                  onClick={() => setShowGrid(false)}
                  className="flex items-center gap-1 text-sm font-semibold text-white/70 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
              ) : (
                <span className="text-sm font-semibold">Update profile photo</span>
              )}
              <button onClick={closeDialog} className="rounded-full p-1 text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {showGrid ? (
              /* ── Predefined avatar grid ── */
              <div className="max-h-72 overflow-y-auto">
                <div className="grid grid-cols-5 gap-2 pb-2">
                  {PRESET_AVATARS.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => handlePredefinedAvatar(url)}
                      className={`aspect-square overflow-hidden rounded-2xl border-2 transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 ${
                        previewUrl === url ? "border-pink-400" : "border-white/10"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Avatar" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* ── Main menu ── */
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowGrid(true)}
                  className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/10"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-500/20">
                    <Sparkles className="h-4 w-4 text-fuchsia-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Choose an avatar</div>
                    <div className="text-xs text-[var(--color-q4w-muted)]">40 predefined 3-D characters</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={openCamera}
                  className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/10"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-500/20">
                    <Camera className="h-4 w-4 text-pink-400" />
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
                    <ImageIcon className="h-4 w-4 text-teal-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Choose from gallery</div>
                    <div className="text-xs text-[var(--color-q4w-muted)]">JPG, PNG, WEBP or HEIC</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Full-screen in-app camera */}
      {cameraOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`}
          />
          {cameraError ? (
            <p className="absolute inset-x-0 top-[max(env(safe-area-inset-top),20px)] text-center text-sm text-rose-400">
              {cameraError}
            </p>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-10 pb-[max(env(safe-area-inset-bottom),28px)] pt-6">
            <button
              type="button"
              onClick={closeCamera}
              aria-label="Cancel"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
            >
              <X className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={capturePhoto}
              aria-label="Take photo"
              className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/30 transition active:scale-95"
            />
            <button
              type="button"
              onClick={switchCamera}
              aria-label="Switch camera"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
            >
              <SwitchCamera className="h-6 w-6" />
            </button>
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
