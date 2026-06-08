"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Upload, Trash2, ToggleLeft, ToggleRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { uploadSound, updateSound, deleteSound, SOUND_USAGES, type SoundUsage } from "@/lib/actions/sounds";

/* ── Upload Dialog ─────────────────────────────────────────────────── */

export function UploadSoundDialog() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [usage, setUsage] = useState<SoundUsage | "">("");
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
    if (!file || !name.trim() || !usage) {
      toast.error("Please fill in all fields and select a file.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name.trim());
    fd.append("usage", usage);
    start(async () => {
      const res = await uploadSound(fd);
      if (res.ok) {
        toast.success("Sound uploaded");
        setOpen(false);
        setName(""); setUsage(""); setFileName("");
        if (fileRef.current) fileRef.current.value = "";
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Upload className="mr-2 h-4 w-4" />Upload Sound</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Upload Sound</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="sound-file">Audio file (MP3, WAV, OGG, AAC, M4A · max 50 MB)</Label>
            <Input id="sound-file" type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.aac,.m4a"
              ref={fileRef} onChange={handleFile} required />
            {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="sound-name">Name</Label>
            <Input id="sound-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Correct Answer Chime" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sound-usage">Usage</Label>
            <Select value={usage} onValueChange={v => setUsage(v as SoundUsage)}>
              <SelectTrigger id="sound-usage"><SelectValue placeholder="Select placement…" /></SelectTrigger>
              <SelectContent>
                {SOUND_USAGES.map(u => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

/* ── Edit Dialog ────────────────────────────────────────────────────── */

export function EditSoundDialog({ id, name: initName, usage: initUsage }: { id: string; name: string; usage: SoundUsage }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState(initName);
  const [usage, setUsage] = useState<SoundUsage>(initUsage);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateSound(id, { name, usage });
      if (res.ok) { toast.success("Sound updated"); setOpen(false); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Edit"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Edit Sound</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Usage</Label>
            <Select value={usage} onValueChange={v => setUsage(v as SoundUsage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOUND_USAGES.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Toggle Active Button ───────────────────────────────────────────── */

export function ToggleSoundButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" disabled={pending}
      title={isActive ? "Deactivate" : "Activate"}
      onClick={() => start(async () => {
        const res = await updateSound(id, { is_active: !isActive });
        if (res.ok) toast.success(isActive ? "Sound deactivated" : "Sound activated");
        else toast.error(res.message);
      })}>
      {isActive
        ? <ToggleRight className="h-4 w-4 text-success" />
        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}

/* ── Delete Button ──────────────────────────────────────────────────── */

export function DeleteSoundButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" disabled={pending}
      title="Delete sound"
      onClick={() => {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        start(async () => {
          const res = await deleteSound(id);
          if (res.ok) toast.success("Sound deleted");
          else toast.error(res.message);
        });
      }}>
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
