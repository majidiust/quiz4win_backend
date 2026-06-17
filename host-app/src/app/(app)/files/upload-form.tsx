"use client";

/**
 * Clean upload form for verification files. Replaces the raw native <select>
 * + <input type="file"> (which rendered with messy browser chrome) with:
 *   • a styled document-type picker (selectable pills, emits hidden file_type)
 *   • a tap/drag dropzone that previews the chosen file (thumbnail + size)
 * The actual upload still posts to the existing uploadFileAction server action.
 */

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, File as FileIcon, FileText, Film, ImageIcon, Sparkles, UploadCloud, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFileAction } from "./actions";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: "selfie", label: "Selfie holding ID", Icon: User },
  { value: "id_document", label: "ID document", Icon: FileText },
  { value: "intro_video", label: "Intro video", Icon: Film },
  { value: "screenshot", label: "Screenshot", Icon: ImageIcon },
  { value: "avatar", label: "Avatar photo", Icon: Sparkles },
  { value: "other", label: "Other", Icon: FileIcon },
] as const;

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf,video/mp4,video/quicktime,video/webm";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const Icon = file.type.startsWith("video/") ? Film : file.type === "application/pdf" ? FileText : FileIcon;
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Icon className="h-5 w-5 text-white/50" />}
    </span>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} disabled={disabled}>Upload file</Button>;
}

export function UploadForm() {
  const [type, setType] = useState<string>("selfie");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the real <input type="file"> in sync so the form always posts the
  // chosen file — required for drag-and-drop, where the drop target isn't the input.
  function pick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      if (inputRef.current) inputRef.current.files = dt.files;
    } catch { /* DataTransfer unsupported — picker path already set input.files */ }
  }

  function clear() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <form action={uploadFileAction} className="flex flex-col gap-4">
      <input type="hidden" name="file_type" value={type} />

      <div>
        <div className="mb-2 ml-1 text-[11px] uppercase tracking-widest text-white/55">Document type</div>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map(({ value, label, Icon }) => {
            const on = type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={cn(
                  "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left text-sm transition active:scale-[0.98]",
                  on ? "border-[var(--color-q4w-primary)] bg-[var(--color-q4w-primary)]/10"
                     : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                )}
              >
                <span className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                  on ? "bg-[var(--color-q4w-primary)]/20 text-[var(--color-q4w-primary)]" : "bg-white/5 text-white/50",
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn("min-w-0 flex-1 truncate", on ? "text-white" : "text-white/70")}>{label}</span>
                {on ? <Check className="h-4 w-4 shrink-0 text-[var(--color-q4w-primary)]" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 ml-1 text-[11px] uppercase tracking-widest text-white/55">File</div>
        {file ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <FileThumb file={file} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{file.name}</div>
              <div className="text-[11px] text-white/45">{formatBytes(file.size)}</div>
            </div>
            <button type="button" onClick={clear} aria-label="Remove file"
              className="rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition",
              drag ? "border-[var(--color-q4w-primary)] bg-[var(--color-q4w-primary)]/5"
                   : "border-white/15 bg-white/[0.02] hover:bg-white/[0.04]",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
              <UploadCloud className="h-6 w-6 text-white/50" />
            </span>
            <span className="text-sm text-white/70">Tap to choose or drop a file here</span>
            <span className="text-[11px] text-white/40">JPEG, PNG, WebP, HEIC, PDF, MP4, MOV, WebM · Max 25 MB</span>
          </button>
        )}
        <input ref={inputRef} type="file" name="file" accept={ACCEPT} className="hidden"
          onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <SubmitButton disabled={!file} />
    </form>
  );
}
