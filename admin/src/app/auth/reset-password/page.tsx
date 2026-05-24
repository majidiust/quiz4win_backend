"use client";

/**
 * Admin password-reset page.
 *
 * The user arrives here via a link sent by /api/admin/auth/forgot-password:
 *   https://panel.quiz4win.com/auth/reset-password?token=<raw_token>
 *
 * This is 100% independent of Supabase Auth — the token lives in our
 * admin_password_reset_tokens table; submission goes to
 * /api/admin/auth/reset-password.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ShieldCheck, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State = "loading" | "error" | "form" | "success";

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");

  const [state, setState] = useState<State>(token ? "form" : "error");
  const [errorMsg, setErrorMsg] = useState(token ? "" : "No reset token found. Please request a new link.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (password.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (!token) {
      toast.error("Reset token missing");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/admin/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.status === 401) {
          setState("error");
          setErrorMsg(data.error ?? "Reset link is invalid or expired. Please request a new one.");
        } else {
          toast.error(data.error ?? "Failed to update password. Try again.");
        }
      } else {
        setState("success");
      }
    });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col bg-gradient-to-br from-primary via-primary/80 to-chart-4 p-10 text-primary-foreground lg:flex">
        <div className="z-10 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-6" /> Quiz4Win Admin
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          {state === "error" && (
            <div className="space-y-4 text-center">
              <AlertCircle className="mx-auto size-10 text-destructive" />
              <h1 className="text-xl font-semibold">Link invalid or expired</h1>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <p className="text-xs text-muted-foreground">
                Request a new link from the{" "}
                <a href="/auth/forgot-password" className="underline">forgot password</a> page.
              </p>
            </div>
          )}

          {state === "form" && (
            <>
              <div className="space-y-2 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
                <p className="text-sm text-muted-foreground">
                  Must be ≥12 chars with uppercase, lowercase, digit, and symbol.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-password">New password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rp-password" type="password" className="pl-9" placeholder="Minimum 12 characters"
                      value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-confirm">Confirm password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rp-confirm" type="password" className="pl-9" placeholder="Re-enter your password"
                      value={confirm} onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
                  </div>
                </div>
                <Button className="w-full" loading={pending} onClick={submit}>
                  Update password
                </Button>
              </div>
            </>
          )}

          {state === "success" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-green-500" />
              <h1 className="text-xl font-semibold">Password updated!</h1>
              <p className="text-sm text-muted-foreground">
                Your password has been changed. All previous sessions have been revoked.
                You can now sign in with your new credentials.
              </p>
              <Button className="w-full" onClick={() => router.push("/login")}>
                Back to sign in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
