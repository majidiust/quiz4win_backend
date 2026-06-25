"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Upload, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadARBackground, updateARBackground, deleteARBackground } from "@/lib/actions/ar-backgrounds";

/* ── Upload Dialog ─────────────────────────────────────────────────── */

export function UploadARBackgroundDialog() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFileName(f.name);
      if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) { toast.error("Please fill in all fields and select a file."); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name.trim());
    start(async () => {
      const res = await uploadARBackground(fd);
      if (res.ok) {
        toast.success("Background uploaded");
        setOpen(false); setName(""); setFileName("");
        if (fileRef.current) fileRef.current.value = "";
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Upload className="mr-2 h-4 w-4" />Upload Background</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Upload AR Background</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="bg-file">Image (JPEG, PNG, WEBP · max 10 MB)</Label>
            <Input id="bg-file" type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
              ref={fileRef} onChange={handleFile} required />
            {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="bg-name">Name</Label>
            <Input id="bg-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Office" required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Toggle Active ──────────────────────────────────────────────────── */

export function ToggleARBackgroundButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" disabled={pending}
      title={isActive ? "Deactivate" : "Activate"}
      onClick={() => start(async () => {
        const res = await updateARBackground(id, { is_active: !isActive });
        if (res.ok) toast.success(isActive ? "Deactivated" : "Activated");
        else toast.error(res.message);
      })}>
      {isActive
        ? <ToggleRight className="h-4 w-4 text-success" />
        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}

/* ── Delete ─────────────────────────────────────────────────────────── */

export function DeleteARBackgroundButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" disabled={pending}
      title="Delete background"
      onClick={() => {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        start(async () => {
          const res = await deleteARBackground(id);
          if (res.ok) toast.success("Background deleted");
          else toast.error(res.message);
        });
      }}>
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
