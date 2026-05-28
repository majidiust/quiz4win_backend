"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, HelpCircle, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { updateApplicationStatus, sendCustomEmailToApplicant } from "@/lib/actions/host-applications";

interface Props {
  applicationId: string;
  currentStatus: string;
  adminNotes: string;
}

export function ApplicationActions({ applicationId, currentStatus, adminNotes }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // ── Accept ────────────────────────────────────────────────────────────────
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptNotes, setAcceptNotes] = useState(adminNotes);

  function handleAccept() {
    start(async () => {
      const res = await updateApplicationStatus({ applicationId, status: "accepted", admin_notes: acceptNotes });
      if (res.ok) { toast.success(res.message); setAcceptOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState(adminNotes);

  function handleReject() {
    start(async () => {
      const res = await updateApplicationStatus({ applicationId, status: "rejected", admin_notes: rejectNotes });
      if (res.ok) { toast.success(res.message); setRejectOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  // ── Request info ──────────────────────────────────────────────────────────
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoNotes, setInfoNotes] = useState(adminNotes);

  function handleRequestInfo() {
    start(async () => {
      const res = await updateApplicationStatus({ applicationId, status: "info_requested", admin_notes: infoNotes });
      if (res.ok) { toast.success(res.message); setInfoOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }

  // ── Custom email ──────────────────────────────────────────────────────────
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  function handleSendEmail() {
    if (!emailSubject.trim()) { toast.error("Subject is required"); return; }
    if (emailMessage.trim().length < 10) { toast.error("Message is too short"); return; }
    start(async () => {
      const res = await sendCustomEmailToApplicant({ applicationId, subject: emailSubject.trim(), message: emailMessage.trim() });
      if (res.ok) { toast.success(res.message); setEmailOpen(false); setEmailSubject(""); setEmailMessage(""); }
      else toast.error(res.message);
    });
  }

  const isDone = currentStatus === "accepted" || currentStatus === "rejected";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Accept */}
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogTrigger asChild>
          <Button variant="success" size="sm" disabled={isDone || pending}>
            <Check className="size-3.5" /> Accept
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept application?</DialogTitle>
            <DialogDescription>The applicant will be marked as accepted. Add an optional internal note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="accept-notes">Admin notes (internal)</Label>
            <Textarea id="accept-notes" value={acceptNotes} onChange={(e) => setAcceptNotes(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAcceptOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="success" size="sm" onClick={handleAccept} loading={pending}>Confirm accept</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={isDone || pending}>
            <X className="size-3.5" /> Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
            <DialogDescription>Add a reason below (internal — not sent to applicant unless you use the email action).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-notes">Reason / notes</Label>
            <Textarea id="reject-notes" value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleReject} loading={pending}>Confirm reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request more info */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isDone || pending}>
            <HelpCircle className="size-3.5" /> Request info
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request more information</DialogTitle>
            <DialogDescription>Mark this application as needing more info. Add notes about what is required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="info-notes">Notes (internal)</Label>
            <Textarea id="info-notes" value={infoNotes} onChange={(e) => setInfoNotes(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInfoOpen(false)} disabled={pending}>Cancel</Button>
            <Button size="sm" onClick={handleRequestInfo} loading={pending}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom email */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" disabled={pending}>
            <Mail className="size-3.5" /> Send email
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send custom email to applicant</DialogTitle>
            <DialogDescription>This email will be sent directly to the applicant from Quiz4Win.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input id="email-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} maxLength={200} placeholder="Your Quiz4Win application…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-message">Message</Label>
              <Textarea id="email-message" value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={6} maxLength={5000} placeholder="Write your message…" />
              <p className="text-right text-xs text-muted-foreground">{emailMessage.length}/5000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEmailOpen(false)} disabled={pending}>Cancel</Button>
            <Button size="sm" onClick={handleSendEmail} loading={pending}><Mail className="size-3.5" /> Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
