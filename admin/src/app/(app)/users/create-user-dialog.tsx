"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createAuthUser, inviteUserByEmail } from "@/lib/actions/auth-users";

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "invite">("create");

  // create-user state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(true);

  // invite state
  const [inviteEmail, setInviteEmail] = useState("");

  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail(""); setPassword(""); setFullName(""); setAutoConfirm(true);
    setInviteEmail("");
  }

  function submitCreate() {
    if (!email.includes("@")) { toast.error("Enter a valid email"); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    startTransition(async () => {
      const res = await createAuthUser({
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
        email_confirm: autoConfirm,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        if (res.userId) router.push(`/users/${res.userId}`);
        else router.refresh();
      } else toast.error(res.message);
    });
  }

  function submitInvite() {
    if (!inviteEmail.includes("@")) { toast.error("Enter a valid email"); return; }
    startTransition(async () => {
      const res = await inviteUserByEmail({ email: inviteEmail.trim() });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus className="size-3.5" /> Add user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new user</DialogTitle>
          <DialogDescription>Create a user with email + password, or send an invite email.</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create"><UserPlus className="size-3.5" /> Create user</TabsTrigger>
            <TabsTrigger value="invite"><Mail className="size-3.5" /> Send invite</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="cu-email">Email</Label>
              <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-password">Password</Label>
              <Input id="cu-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-name">Full name (optional)</Label>
              <Input id="cu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="text-sm font-medium">Auto-confirm email</div>
                <div className="text-xs text-muted-foreground">Skip the email verification step.</div>
              </div>
              <Switch checked={autoConfirm} onCheckedChange={setAutoConfirm} />
            </div>
          </TabsContent>

          <TabsContent value="invite" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="cu-invite">Email</Label>
              <Input id="cu-invite" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" autoComplete="off" />
              <p className="text-xs text-muted-foreground">An invitation email will be sent. The user sets their own password by clicking the link.</p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={mode === "create" ? submitCreate : submitInvite}>
            {mode === "create" ? "Create user" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
