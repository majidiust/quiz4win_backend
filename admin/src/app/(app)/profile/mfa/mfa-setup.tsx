"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { setOwnMfaEnabled } from "@/lib/actions/profile";

interface EnrollState {
  factorId: string;
  qrSvg: string;
  secret: string;
}

export function MfaSetup({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  async function beginEnroll() {
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      // Remove any leftover unverified factors before starting a new enrollment.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) {
        toast.error(error?.message ?? "Failed to start MFA enrollment");
        return;
      }
      setEnroll({ factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    });
  }

  async function verifyCode() {
    if (!enroll) return;
    if (code.replace(/\s/g, "").length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator");
      return;
    }
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
      if (chalErr || !chal) {
        toast.error(chalErr?.message ?? "Failed to issue challenge");
        return;
      }
      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: chal.id,
        code: code.replace(/\s/g, ""),
      });
      if (verErr) {
        toast.error(verErr.message);
        return;
      }
      const res = await setOwnMfaEnabled({ enabled: true });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("MFA enabled");
      setEnabled(true);
      setEnroll(null);
      setCode("");
      router.refresh();
    });
  }

  async function disable() {
    if (!confirm("Disable MFA on your account? You will no longer be required to enter a code at sign-in.")) return;
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const res = await setOwnMfaEnabled({ enabled: false });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("MFA disabled");
      setEnabled(false);
      router.refresh();
    });
  }

  if (enabled && !enroll) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1"><ShieldCheck className="size-3" /> Enabled</Badge>
          <span className="text-sm text-muted-foreground">A TOTP factor is active on your account.</span>
        </div>
        <Button variant="destructive" loading={pending} onClick={disable}>Disable MFA</Button>
      </div>
    );
  }

  if (!enroll) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="warning" className="gap-1"><ShieldAlert className="size-3" /> Not enabled</Badge>
          <span className="text-sm text-muted-foreground">Add an authenticator app (e.g. 1Password, Authy, Google Authenticator).</span>
        </div>
        <Button loading={pending} onClick={beginEnroll}>Begin setup</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Step 1 — Scan QR code</h3>
        <div
          className="inline-flex rounded-md border bg-white p-3"
          dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
        />
        <p className="text-xs text-muted-foreground">Or enter this secret manually:</p>
        <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{enroll.secret}</code>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Step 2 — Enter the 6-digit code</h3>
        <div className="space-y-1.5">
          <Label htmlFor="otp">Authentication code</Label>
          <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEnroll(null)} disabled={pending}>Cancel</Button>
          <Button loading={pending} onClick={verifyCode}>Verify & enable</Button>
        </div>
      </div>
    </div>
  );
}
