"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getHostFileSignedUrl } from "@/lib/actions/hosts";

/**
 * Opens a host_uploaded_files object in a new tab. Resolves a short-lived
 * presigned URL on click so private files (KYC, intro video) never need a
 * persisted public link.
 */
export function HostFileLink({ fileId, label }: { fileId: string; label: string }) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const res = await getHostFileSignedUrl(fileId);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else toast.error(res.message);
    });
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
    >
      {label}
      {pending ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
    </button>
  );
}

/**
 * Inline player for the host's onboarding intro video.
 *
 * Accepts a server-side pre-generated presigned URL (`src`) so the video
 * displays immediately without a client-side fetch. Falls back to an on-demand
 * load when `src` is null (presigning failed on the server).
 *
 * Also renders an "Open in new tab" link as a fallback for browsers or
 * environments where CORS blocks inline video playback from DO Spaces.
 */
export function IntroVideoPlayer({ src, fileId }: { src: string | null; fileId: string }) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src);
  const [pending, start] = useTransition();

  function loadFallback() {
    start(async () => {
      const res = await getHostFileSignedUrl(fileId);
      if (res.ok) setResolvedSrc(res.url);
      else toast.error(res.message);
    });
  }

  if (resolvedSrc) {
    return (
      <div className="space-y-1.5">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={resolvedSrc}
          controls
          playsInline
          className="aspect-video w-full rounded-md border bg-black"
        />
        <a
          href={resolvedSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="size-3" /> Open in new tab
        </a>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={loadFallback} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
      {pending ? "Loading…" : "Watch intro video"}
    </Button>
  );
}

/**
 * Inline viewer for image-type verification files (selfie, id_document, avatar).
 *
 * Shows the image inline when a `src` URL is available (server-pre-signed or
 * direct public URL). Falls back to an on-demand link otherwise.
 */
export function InlineImageViewer({ src, fileId, label }: { src: string | null; fileId: string; label: string }) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src);
  const [pending, start] = useTransition();

  function loadFallback() {
    start(async () => {
      const res = await getHostFileSignedUrl(fileId);
      if (res.ok) setResolvedSrc(res.url);
      else toast.error(res.message);
    });
  }

  if (resolvedSrc) {
    return (
      <div className="space-y-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolvedSrc}
          alt={label}
          className="max-h-64 w-full rounded-md border object-contain bg-muted"
        />
        <a
          href={resolvedSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="size-3" /> Full size
        </a>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={loadFallback} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
      {pending ? "Loading…" : `View ${label}`}
    </Button>
  );
}
