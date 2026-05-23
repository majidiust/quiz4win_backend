"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff, ShieldBan, ShieldCheck, Wallet, Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { updateUserStatus, adjustWallet, sendNotification } from "@/lib/actions/users";

interface Props {
  userId: string;
  currentStatus: string;
}

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */
function StatusDialog({ userId, currentStatus }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"active" | "suspended" | "banned">("suspended");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function handleOpen() {
    setStatus(currentStatus === "active" ? "suspended" : "active");
    setReason("");
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const res = await updateUserStatus({ id: userId, status, reason: reason.trim() || undefined });
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={currentStatus === "active" ? "destructive" : "success"} size="sm" onClick={handleOpen}>
          {currentStatus === "active" ? <><ShieldOff className="size-3.5" /> Suspend</> : <><ShieldCheck className="size-3.5" /> Reactivate</>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change player status</DialogTitle>
          <DialogDescription>This will immediately affect the player's access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="banned">Banned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status !== "active" && (
            <div className="space-y-1.5">
              <Label htmlFor="status-reason">Reason</Label>
              <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                rows={3} maxLength={500} placeholder="e.g. Repeated AML alerts, awaiting review." />
              <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending}
            disabled={status !== "active" && reason.trim().length < 3}
            variant={status === "active" ? "success" : "destructive"}
            onClick={submit}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Ban (shortcut when already suspended)                               */
/* ------------------------------------------------------------------ */
function BanButton({ userId, currentStatus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (currentStatus !== "suspended") return null;
  function ban() {
    startTransition(async () => {
      const res = await updateUserStatus({ id: userId, status: "banned", reason: "Escalated from suspension" });
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Button variant="destructive" size="sm" loading={pending} onClick={ban}>
      <ShieldBan className="size-3.5" /> Ban
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet adjust                                                        */
/* ------------------------------------------------------------------ */
function WalletDialog({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { toast.error("Enter a valid positive amount"); return; }
    if (reason.trim().length < 3) { toast.error("Reason is required"); return; }
    startTransition(async () => {
      const res = await adjustWallet({ id: userId, type, amount: n, reason: reason.trim() });
      if (res.ok) { toast.success(res.message); setOpen(false); setAmount(""); setReason(""); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Wallet className="size-3.5" /> Adjust wallet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual wallet adjustment</DialogTitle>
          <DialogDescription>Adds or removes funds from the player's wallet. An audit record is created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Operation</Label>
            <Select value={type} onValueChange={(v) => setType(v as "credit" | "debit")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Credit (add funds)</SelectItem>
                <SelectItem value="debit">Debit (remove funds)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-amount">Amount ($)</Label>
            <Input id="wallet-amount" type="number" min="0.01" step="0.01" max="100000"
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-reason">Reason</Label>
            <Textarea id="wallet-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              rows={3} maxLength={500} placeholder="e.g. Compensation for failed game entry." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Notify                                                               */
/* ------------------------------------------------------------------ */
function NotifyDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!title.trim() || !body.trim()) { toast.error("Title and body are required"); return; }
    startTransition(async () => {
      const res = await sendNotification({ id: userId, title: title.trim(), body: body.trim() });
      if (res.ok) { toast.success(res.message); setOpen(false); setTitle(""); setBody(""); }
      else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Bell className="size-3.5" /> Notify</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send notification</DialogTitle>
          <DialogDescription>Sends an in-app push notification to this player.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="notify-title">Title</Label>
            <Input id="notify-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Account update" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notify-body">Message</Label>
            <Textarea id="notify-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={500} placeholder="e.g. Your KYC documents have been reviewed." />
            <p className="text-right text-xs text-muted-foreground">{body.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Exports                                                              */
/* ------------------------------------------------------------------ */
export function UserActions({ userId, currentStatus }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusDialog userId={userId} currentStatus={currentStatus} />
      <BanButton userId={userId} currentStatus={currentStatus} />
      <WalletDialog userId={userId} />
      <NotifyDialog userId={userId} />
    </div>
  );
}
