"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Trash2, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleVoucherStatus, cancelVoucher, issueVoucher } from "@/lib/actions/vouchers";

interface Props {
  voucherId: string;
  currentStatus: string;
}

/* ------------------------------------------------------------------ */
/* Pause / Resume                                                       */
/* ------------------------------------------------------------------ */
export function ToggleStatusButton({ voucherId, currentStatus }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isPaused = currentStatus === "paused";

  function handle() {
    start(async () => {
      const res = await toggleVoucherStatus(voucherId, isPaused ? "active" : "paused");
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  if (!["active", "paused"].includes(currentStatus)) return null;

  return (
    <Button size="sm" variant="outline" loading={pending} onClick={handle}>
      {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
      {isPaused ? "Resume" : "Pause"}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */
export function CancelVoucherButton({ voucherId, currentStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  const [pending, start] = useTransition();

  function handle() {
    start(async () => {
      const res = await cancelVoucher(voucherId, reason.trim() || undefined);
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  if (currentStatus === "cancelled") return null;

  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Cancel voucher
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel voucher?</DialogTitle>
            <DialogDescription>This is permanent and cannot be undone. The voucher will be deactivated immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for cancellation…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Keep voucher</Button>
            <Button variant="destructive" loading={pending} onClick={handle}>Cancel permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Issue to user                                                        */
/* ------------------------------------------------------------------ */
export function IssueVoucherButton({ voucherId, currentStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [shouldSendEmail, setShouldSendEmail] = useState(true);
  const router = useRouter();
  const [pending, start] = useTransition();

  function handle() {
    if (!userId.trim()) { toast.error("User ID is required"); return; }
    start(async () => {
      const res = await issueVoucher({
        voucherId,
        userId: userId.trim(),
        note: note.trim() || undefined,
        sendEmail: shouldSendEmail,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        setUserId("");
        setNote("");
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  if (currentStatus !== "active") return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Issue to user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue voucher to user</DialogTitle>
            <DialogDescription>Directly grant this voucher to a specific user by their ID.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="issue-user">User ID (UUID) *</Label>
              <Input id="issue-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="issue-note">Note (optional)</Label>
              <Textarea id="issue-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Compensation for game issue" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="send-email" checked={shouldSendEmail} onCheckedChange={(v) => setShouldSendEmail(!!v)} />
              <Label htmlFor="send-email" className="text-sm font-normal">Send branded notification email to user</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={handle}><Send className="size-4" /> Issue voucher</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
