"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys";

function SecretReveal({ token, onCopy, onClose }: {
  token: string; onCopy: () => void; onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>API key created</DialogTitle>
        <DialogDescription>
          This secret will not be shown again. Copy it now and store it somewhere safe.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label>Token</Label>
        <div className="flex items-center gap-2">
          <Input value={token} readOnly className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={onCopy} title="Copy">
            <Copy className="size-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Send this value in the <code className="font-mono">X-API-Key</code> header on every request.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Revoke button                                                        */
/* ------------------------------------------------------------------ */
export function RevokeApiKeyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await revokeApiKey({ id });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <>
      <Button size="icon" variant="ghost" className="size-7" onClick={() => setOpen(true)} title="Revoke">
        <ShieldOff className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke API key</DialogTitle>
            <DialogDescription>
              {`Revoking "${name}" immediately blocks any further requests using this key. This cannot be undone — issue a new key if needed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" loading={pending} onClick={submit}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ROLES = ["super_admin", "admin", "moderator", "finance", "support"] as const;
type Role = typeof ROLES[number];

/* ------------------------------------------------------------------ */
/* Create dialog (with one-time secret reveal)                         */
/* ------------------------------------------------------------------ */
export function CreateApiKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [expiresAt, setExpiresAt] = useState("");
  const [domains, setDomains] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  function reset() {
    setName(""); setDescription(""); setRole("admin");
    setExpiresAt(""); setDomains(""); setIssuedToken(null);
  }

  function closeAndRefresh() {
    setOpen(false);
    reset();
    router.refresh();
  }

  function submit() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    const allowed_domains = domains
      .split(/[\n,]/).map((d) => d.trim()).filter(Boolean);
    start(async () => {
      const res = await createApiKey({
        name: name.trim(),
        description: description.trim() || undefined,
        role,
        expires_at: expiresAt || undefined,
        allowed_domains,
      });
      if (res.ok && res.token) {
        setIssuedToken(res.token);
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  async function copyToken() {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" /> New API key
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeAndRefresh(); else setOpen(true); }}>
        <DialogContent className="sm:max-w-lg">
          {!issuedToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  The secret is shown only once after creation. Store it somewhere safe.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ak-name">Name *</Label>
                  <Input id="ak-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CI pipeline" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ak-desc">Description</Label>
                  <Textarea
                    id="ak-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this key is used for"
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ak-exp">Expires (optional)</Label>
                    <Input
                      id="ak-exp"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ak-domains">Allowed origins (optional)</Label>
                  <Textarea
                    id="ak-domains"
                    value={domains}
                    onChange={(e) => setDomains(e.target.value)}
                    placeholder="https://app.example.com&#10;https://admin.example.com"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    One per line or comma-separated. Leave empty to allow any origin (typical for server-to-server).
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeAndRefresh}>Cancel</Button>
                <Button loading={pending} onClick={submit}>Create key</Button>
              </DialogFooter>
            </>
          ) : (
            <SecretReveal token={issuedToken} onClose={closeAndRefresh} onCopy={copyToken} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
