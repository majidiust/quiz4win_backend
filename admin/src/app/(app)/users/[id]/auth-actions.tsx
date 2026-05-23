"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MailCheck, Mail, MailOpen, Ban, Undo2, LogOut, Trash2, MoreHorizontal, AtSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  setUserPassword, updateUserEmail, setEmailConfirmation, banUser, unbanUser,
  revokeAllSessions, sendAuthLink, deleteAuthUser,
} from "@/lib/actions/auth-users";

interface Props {
  userId: string;
  userEmail: string;
  isBanned: boolean;
  emailConfirmed: boolean;
}

/* ----------------------------- Set password ----------------------------- */
function PasswordDialog({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pwd.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    startTransition(async () => {
      const res = await setUserPassword({ id: userId, new_password: pwd });
      if (res.ok) { toast.success(res.message); setOpen(false); setPwd(""); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><KeyRound className="size-3.5" /> Set password</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set new password</DialogTitle>
          <DialogDescription>Directly overwrites the stored password. The user will be able to sign in immediately with this value.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="new-pwd">New password</Label>
          <Input id="new-pwd" type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Minimum 8 characters" autoComplete="new-password" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Set password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Change email ----------------------------- */
function EmailDialog({ userId, currentEmail }: { userId: string; currentEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!email.includes("@")) { toast.error("Enter a valid email"); return; }
    startTransition(async () => {
      const res = await updateUserEmail({ id: userId, new_email: email, email_confirm: true });
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}><AtSign className="size-3.5" /> Change email</DropdownMenuItem></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email address</DialogTitle>
          <DialogDescription>Current: <span className="font-mono">{currentEmail}</span>. The new email will be marked as confirmed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="new-email">New email</Label>
          <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new@example.com" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Change email</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Ban ----------------------------- */
function BanDialog({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<"1h" | "24h" | "7d" | "30d" | "365d" | "permanent">("24h");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 3) { toast.error("Reason is required"); return; }
    startTransition(async () => {
      const res = await banUser({ id: userId, duration, reason: reason.trim() });
      if (res.ok) { toast.success(res.message); setOpen(false); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }} className="text-destructive"><Ban className="size-3.5" /> Ban user</DropdownMenuItem></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>The user will be unable to sign in for the chosen duration.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <Select value={duration} onValueChange={(v) => setDuration(v as typeof duration)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="24h">24 hours</SelectItem>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="365d">1 year</SelectItem>
                <SelectItem value="permanent">Permanent (100 years)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ban-reason">Reason</Label>
            <Textarea id="ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Multi-account abuse." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" variant="destructive" loading={pending} onClick={submit}>Ban user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Confirm dialog (generic) ----------------------------- */
function DangerItem({ label, icon: Icon, title, description, confirmLabel, action, destructive }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<{ ok: boolean; message: string }>;
  destructive?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await action();
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className={destructive ? "text-destructive" : ""}>
          <Icon className="size-3.5" /> {label}
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={pending} className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}>
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ----------------------------- Root component ----------------------------- */
export function AuthActions({ userId, userEmail, isBanned, emailConfirmed }: Props) {
  return (
    <div className="flex items-center gap-2">
      <PasswordDialog userId={userId} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><MoreHorizontal className="size-3.5" /> Auth</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Authentication</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DangerItem
            label="Send recovery email"
            icon={Mail}
            title="Send password recovery email?"
            description={`A password reset link will be emailed to ${userEmail}.`}
            confirmLabel="Send email"
            action={() => sendAuthLink({ id: userId, type: "recovery" })}
          />
          <DangerItem
            label="Send magic link"
            icon={MailOpen}
            title="Send magic-link email?"
            description={`A one-click sign-in link will be emailed to ${userEmail}.`}
            confirmLabel="Send link"
            action={() => sendAuthLink({ id: userId, type: "magiclink" })}
          />

          {!emailConfirmed && (
            <DangerItem
              label="Confirm email"
              icon={MailCheck}
              title="Mark email as confirmed?"
              description="Skip the email-verification step. The user will be treated as if they had clicked the confirmation link."
              confirmLabel="Confirm email"
              action={() => setEmailConfirmation({ id: userId, confirm: true })}
            />
          )}

          <EmailDialog userId={userId} currentEmail={userEmail} />

          <DropdownMenuSeparator />

          <DangerItem
            label="Revoke all sessions"
            icon={LogOut}
            title="Revoke all active sessions?"
            description="The user will be signed out of every device. They will need to sign in again."
            confirmLabel="Revoke sessions"
            action={() => revokeAllSessions({ id: userId })}
          />

          {isBanned ? (
            <DangerItem
              label="Unban user"
              icon={Undo2}
              title="Unban user?"
              description="The user will immediately regain access to sign in."
              confirmLabel="Unban"
              action={() => unbanUser({ id: userId })}
            />
          ) : (
            <BanDialog userId={userId} />
          )}

          <DropdownMenuSeparator />

          <DangerItem
            label="Delete user"
            icon={Trash2}
            title="Permanently delete this user?"
            description="This deletes the auth account and all related data. This action cannot be undone."
            confirmLabel="Delete user"
            destructive
            action={() => deleteAuthUser({ id: userId })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

