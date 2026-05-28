"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileUploadInput } from "@/components/file-upload-input";
import { createHost } from "@/lib/actions/shows";

export function CreateHostDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pending, start] = useTransition();

  function reset() { setName(""); setBio(""); setAvatarUrl(""); }

  function submit() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    start(async () => {
      const res = await createHost({
        name: name.trim(),
        bio: bio.trim() || undefined,
        avatar_url: avatarUrl.trim() || undefined,
      });
      if (res.ok) { toast.success(res.message); setOpen(false); reset(); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><UserPlus className="size-3.5" /> Add host</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create show host</DialogTitle>
          <DialogDescription>Add a new host to the talent roster.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="host-name">Name *</Label>
            <Input id="host-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Alex Rivers" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="host-bio">Bio</Label>
            <Textarea id="host-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} placeholder="Short biography…" />
          </div>
          <div className="space-y-1.5">
            <Label>Avatar</Label>
            <FileUploadInput kind="host-avatar" value={avatarUrl} onChange={setAvatarUrl} label="Avatar" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Create host</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
