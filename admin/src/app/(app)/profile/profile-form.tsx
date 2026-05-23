"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOwnProfile, changeOwnPassword } from "@/lib/actions/profile";

export function ProfileForm({ currentName }: { currentName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(currentName);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }
    if (trimmed === currentName) {
      toast.info("No changes to save");
      return;
    }
    start(async () => {
      const res = await updateOwnProfile({ name: trimmed });
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 space-y-1.5 min-w-[200px]">
        <Label htmlFor="profile-name">Name</Label>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button loading={pending} onClick={submit}>Save changes</Button>
    </div>
  );
}

export function PasswordForm() {
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit() {
    if (!current || !next) {
      toast.error("Both passwords are required");
      return;
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      toast.error("New passwords do not match");
      return;
    }
    start(async () => {
      const res = await changeOwnPassword({ current_password: current, new_password: next });
      if (res.ok) {
        toast.success(res.message);
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cur-pw">Current password</Label>
        <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-pw">New password</Label>
        <Input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-pw">Confirm new password</Label>
        <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <div className="pt-1">
        <Button loading={pending} onClick={submit}>Update password</Button>
      </div>
    </div>
  );
}
