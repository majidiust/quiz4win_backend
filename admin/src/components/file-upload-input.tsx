"use client";

import { useRef, useTransition } from "react";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadAsset } from "@/lib/actions/upload";

/**
 * Reusable image-upload control. Uploads the selected file to S3 via
 * `uploadAsset` and calls `onChange` with the resulting public URL.
 * Intended for forms where the owning entity does not yet exist.
 */
interface Props {
  kind: "host-avatar";
  value: string;
  onChange: (url: string) => void;
  label?: string;
}

export function FileUploadInput({ kind, value, onChange, label = "Image" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      const res = await uploadAsset(kind, fd);
      if (res.ok && res.url) {
        onChange(res.url);
        toast.success(`${label} uploaded`);
      } else {
        toast.error(res.message);
      }
    });
    e.target.value = "";
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={label} className="h-16 w-16 rounded-md border object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">None</div>
      )}
      <div className="flex flex-col gap-1.5">
        <Button type="button" size="sm" variant="outline" loading={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-3.5" /> {value ? "Replace" : "Upload"}
        </Button>
        {value && !pending && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
            <X className="size-3.5" /> Remove
          </Button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={handleFile} />
    </div>
  );
}
