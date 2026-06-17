"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { approveHostWithdrawal, rejectHostWithdrawal, completeHostWithdrawal } from "@/lib/actions/finance";

const REJECT_REASONS = [
  "Wallet address invalid or unsupported network",
  "Insufficient verified earnings",
  "Suspicious activity — flagged for review",
  "Duplicate request",
  "Network temporarily unavailable",
  "Host account suspended",
];

interface Props { id: string; status: string }

export function HostWithdrawalActions({ id, status }: Props) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [txRef, setTxRef] = useState("");
  const [pending, startTransition] = useTransition();

  const canApprove = status === "pending";
  const canReject = status === "pending" || status === "processing";
  const canComplete = status === "processing";

  function run(fn: () => Promise<{ ok: boolean; message: string }>, onSuccess: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message); onSuccess(); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? (
        <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
          <DialogTrigger asChild>
            <Button variant="success" size="sm" disabled={pending}><Check className="size-4" /> Approve</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve payout?</DialogTitle>
              <DialogDescription>Moves to <strong>processing</strong>. Mark completed once funds are sent.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="approve-note">Internal note (optional)</Label>
              <Textarea id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setApproveOpen(false)} disabled={pending}>Cancel</Button>
              <Button variant="success" size="sm" loading={pending}
                onClick={() => run(() => approveHostWithdrawal({ id, note: note.trim() || undefined }), () => { setApproveOpen(false); setNote(""); })}
              >Approve</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canComplete ? (
        <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
          <DialogTrigger asChild>
            <Button variant="default" size="sm" disabled={pending}><Send className="size-4" /> Mark completed</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark payout completed</DialogTitle>
              <DialogDescription>Record the blockchain transaction hash. The host will be notified.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tx-ref">Transaction hash (TX ID)</Label>
                <Input id="tx-ref" value={txRef} onChange={(e) => setTxRef(e.target.value)} placeholder="e.g. 0xabc123... or T9vGH..." maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="complete-note">Internal note (optional)</Label>
                <Textarea id="complete-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setCompleteOpen(false)} disabled={pending}>Cancel</Button>
              <Button size="sm" loading={pending} disabled={txRef.trim().length < 2}
                onClick={() => run(() => completeHostWithdrawal({ id, transaction_reference: txRef.trim(), note: note.trim() || undefined }), () => { setCompleteOpen(false); setTxRef(""); setNote(""); })}
              >Confirm completed</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canReject ? (
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={pending}><X className="size-4" /> Reject</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject payout</DialogTitle>
              <DialogDescription>The held amount will be refunded to the host&apos;s wallet balance.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setReason(r)} className="rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted">{r}</button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reject-reason">Reason</Label>
                <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={500} />
                <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)} disabled={pending}>Cancel</Button>
              <Button variant="destructive" size="sm" loading={pending} disabled={reason.trim().length < 3}
                onClick={() => run(() => rejectHostWithdrawal({ id, reason: reason.trim() }), () => { setRejectOpen(false); setReason(""); })}
              >Reject &amp; refund</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
