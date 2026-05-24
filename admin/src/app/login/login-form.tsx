"use client";

/**
 * Native admin login form — completely independent of Supabase Auth.
 *
 * Flow:
 *   1. POST /api/admin/auth/login  → { step: "mfa_required" | "mfa_setup", challengeToken }
 *   2a. step=mfa_required → show TOTP input → POST /api/admin/auth/mfa/verify
 *   2b. step=mfa_setup    → show QR enrolment → POST /api/admin/auth/mfa/setup
 *   3. On success the server sets q4w_admin_session cookie → redirect to dashboard.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Lock, Mail, ShieldCheck, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

type Step = "credentials" | "mfa_verify" | "mfa_setup";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") ?? "/dashboard";
  const queryError = params.get("error");

  const [step, setStep] = useState<Step>("credentials");
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // MFA setup state
  const [setupSecret, setSetupSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  // ── Phase 1: password ───────────────────────────────────────────────────────
  const onCredentials = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { step?: string; challengeToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Sign in failed");

      setChallengeToken(data.challengeToken!);

      if (data.step === "mfa_setup") {
        // Fetch QR code for enrollment.
        const qrRes = await fetch(
          `/api/admin/auth/mfa/setup?challengeToken=${encodeURIComponent(data.challengeToken!)}`,
        );
        const qrData = (await qrRes.json()) as { secret?: string; qrCodeDataUrl?: string; error?: string };
        if (!qrRes.ok) throw new Error(qrData.error ?? "Failed to load QR code");
        setSetupSecret(qrData.secret!);
        setQrDataUrl(qrData.qrCodeDataUrl!);
        setStep("mfa_setup");
      } else {
        setStep("mfa_verify");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Phase 2a: TOTP verify (already enrolled) ────────────────────────────────
  const onMfaVerify = async () => {
    const cleanCode = code.replace(/\D/g, "");
    if (cleanCode.length !== 6) { toast.error("Enter the 6-digit code"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken, code: cleanCode }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      toast.success("Welcome back");
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code — try again");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Phase 2b: MFA setup (first login) ───────────────────────────────────────
  const onMfaSetup = async () => {
    const cleanCode = code.replace(/\D/g, "");
    if (cleanCode.length !== 6) { toast.error("Enter the 6-digit code from your authenticator app"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/mfa/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken, code: cleanCode, secret: setupSecret }),
      });
      const data = (await res.json()) as { ok?: boolean; recoveryCodes?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setRecoveryCodes(data.recoveryCodes ?? []);
      toast.success("MFA enrolled successfully");
      // Show recovery codes briefly then redirect.
      setTimeout(() => { router.replace(redirectTo); router.refresh(); }, 5000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "MFA setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── MFA verify step ─────────────────────────────────────────────────────────
  if (step === "mfa_verify") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
          <ShieldCheck className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code">Authentication code</Label>
          <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onMfaVerify(); }}}
            autoFocus />
        </div>
        <Button className="w-full" loading={submitting} onClick={() => void onMfaVerify()}>Verify</Button>
        <button type="button" className="w-full text-center text-xs text-muted-foreground hover:underline"
          onClick={() => { setStep("credentials"); setCode(""); setChallengeToken(""); }}>
          Use a different account
        </button>
      </div>
    );
  }

  // ── MFA setup step ──────────────────────────────────────────────────────────
  if (step === "mfa_setup") {
    if (recoveryCodes.length > 0) {
      return (
        <div className="space-y-4">
          <h2 className="font-semibold text-green-600">✓ MFA enrolled</h2>
          <p className="text-sm text-muted-foreground">Save these recovery codes in a safe place. Each can only be used once.</p>
          <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs grid grid-cols-2 gap-1">
            {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <p className="text-xs text-muted-foreground">Redirecting to dashboard in 5 seconds…</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
          <QrCode className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">Scan with your authenticator app to enable 2FA on your account.</p>
        </div>
        {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR Code" className="mx-auto rounded-md border" width={200} height={200} />}
        <div className="space-y-1.5">
          <Label htmlFor="setup-code">Verification code</Label>
          <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onMfaSetup(); }}}
            autoFocus />
        </div>
        <Button className="w-full" loading={submitting} onClick={() => void onMfaSetup()}>Activate MFA & Sign in</Button>
      </div>
    );
  }

  // ── Credentials step ────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit(onCredentials)} className="space-y-4">
      {queryError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            {queryError === "not_admin" ? "This account is not registered as an administrator."
              : queryError === "account_disabled" ? "Your admin account is disabled. Contact a super admin."
              : "Authentication required."}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="email" type="email" autoComplete="email" placeholder="admin@quiz4win.com"
            className="pl-9" {...register("email")} />
        </div>
        {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/auth/forgot-password" className="text-xs text-muted-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••"
            className="pl-9" {...register("password")} />
        </div>
        {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
      </div>

      <Button type="submit" className="w-full" loading={submitting}>Sign in</Button>
    </form>
  );
}

