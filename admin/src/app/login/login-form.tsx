"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Lock, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") ?? "/dashboard";
  const queryError = params.get("error");
  const mfaParam = params.get("mfa");

  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Middleware can redirect here with ?mfa=required when an aal1 session exists
  // but aal2 is needed. Auto-fetch the factor and go straight to the MFA step.
  useEffect(() => {
    if (mfaParam !== "required") return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp.find((f) => f.status === "verified");
      if (totp) {
        setFactorId(totp.id);
        setStep("mfa");
      }
    });
  }, [mfaParam]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onCredentials = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) throw error;

      // Check whether a second factor is required (mfa_enabled + verified TOTP factor).
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp.find((f) => f.status === "verified");
        if (totp) {
          setFactorId(totp.id);
          setCode("");
          setStep("mfa");
          return;
        }
      }

      toast.success("Welcome back");
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onMfa = async () => {
    if (!factorId) return;
    const cleanCode = code.replace(/\s/g, "");
    if (cleanCode.length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chalErr || !chal) throw chalErr ?? new Error("Challenge failed");
      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: chal.id,
        code: cleanCode,
      });
      if (verErr) throw verErr;
      toast.success("Welcome back");
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code — try again");
    } finally {
      setSubmitting(false);
    }
  };

  // ── MFA step ────────────────────────────────────────────────────────────────
  if (step === "mfa") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
          <ShieldCheck className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app to continue.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mfa-code">Authentication code</Label>
          <Input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void onMfa(); }
            }}
            autoFocus
          />
        </div>

        <Button className="w-full" loading={submitting} onClick={() => void onMfa()}>
          Verify
        </Button>

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:underline"
          onClick={async () => {
            await createSupabaseBrowserClient().auth.signOut();
            setStep("credentials");
            setFactorId(null);
            setCode("");
          }}
        >
          Use a different account
        </button>
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
            {queryError === "not_admin"
              ? "This account is not registered as an administrator."
              : queryError === "account_disabled"
                ? "Your admin account is disabled. Contact a super admin."
                : "Authentication required."}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="admin@quiz4win.com"
            className="pl-9"
            {...register("email")}
          />
        </div>
        {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className="pl-9"
            {...register("password")}
          />
        </div>
        {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
      </div>

      <Button type="submit" className="w-full" loading={submitting}>
        Sign in
      </Button>
    </form>
  );
}
