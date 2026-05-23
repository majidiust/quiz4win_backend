"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewKyc } from "@/lib/actions/kyc";

interface Props {
  kycId: string;
  disabled?: boolean;
}

const PRESET_REASONS = [
  "Document is blurry or unreadable",
  "Selfie does not match the ID photo",
  "Document appears expired",
  "Document type not supported in your country",
  "Information mismatch with profile data",
];

export function ReviewActions({ kycId, disabled }: Props) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const res = await reviewKyc({ kyc_id: kycId, decision: "approve" });
      if (res.ok) {
        toast.success(res.message);
        setApproveOpen(false);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  function handleReject() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Please provide a rejection reason");
      return;
    }
    startTransition(async () => {
      const res = await reviewKyc({
        kyc_id: kycId,
        decision: "reject",
        rejection_reason: trimmed,
      });
      if (res.ok) {
        toast.success(res.message);
        setRejectOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger asChild>
          <Button variant="success" size="sm" disabled={disabled || pending}>
            <Check className="size-4" /> Approve
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve KYC submission?</DialogTitle>
            <DialogDescription>
              The player&apos;s identity will be marked as verified and they will be allowed to
              request withdrawals. A notification will be sent to the player.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setApproveOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="success" size="sm" onClick={handleApprove} loading={pending}>
              Confirm approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={disabled || pending}>
            <X className="size-4" /> Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject KYC submission</DialogTitle>
            <DialogDescription>
              The player will be notified with the reason below and may resubmit (up to 3 attempts).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESET_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc-reject-reason">Reason</Label>
              <Textarea
                id="kyc-reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain the issue so the player can resubmit correctly…"
                rows={4}
                maxLength={500}
              />
              <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReject} loading={pending}>
              Reject submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
