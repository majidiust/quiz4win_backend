"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = "loading" | "error" | "form" | "success";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  // Supabase encodes the tokens in the URL hash — must be read client-side.
  useEffect(() => {
    const hash = window.location.hash.slice(1); // strip leading #
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    const errorCode = params.get("error_code");
    const errorDescription = params.get("error_description");

    if (errorCode || errorDescription) {
      setState("error");
      setErrorMsg(errorDescription ?? errorCode ?? "Recovery link is invalid.");
      return;
    }

    if (!accessToken || !refreshToken) {
      setState("error");
      setErrorMsg("The recovery link is missing required tokens. Please request a new one.");
      return;
    }

    if (type !== "recovery") {
      setState("error");
      setErrorMsg(`Unexpected link type: "${type ?? "unknown"}". Only recovery links are accepted here.`);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setState("error");
          setErrorMsg(error.message);
        } else {
          setState("form");
        }
      });
  }, []);

  function submit() {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }

    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
      } else {
        await supabase.auth.signOut();
        setState("success");
      }
    });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col bg-gradient-to-br from-primary via-primary/80 to-chart-4 p-10 text-primary-foreground lg:flex">
        <div className="z-10 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-6" />
          Quiz4Win
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
      </div>

      {/* Content panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          {state === "loading" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Verifying your recovery link…</p>
            </div>
          )}

          {state === "error" && (
            <div className="space-y-4 text-center">
              <AlertCircle className="mx-auto size-10 text-destructive" />
              <h1 className="text-xl font-semibold">Link invalid or expired</h1>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <p className="text-xs text-muted-foreground">Contact support or ask an administrator to send a new recovery email.</p>
            </div>
          )}

          {state === "form" && (
            <>
              <div className="space-y-2 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
                <p className="text-sm text-muted-foreground">Choose a strong password for your account.</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-password">New password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rp-password" type="password" className="pl-9" placeholder="Minimum 8 characters"
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
                Your password has been changed. You can now sign in with your new credentials.
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
