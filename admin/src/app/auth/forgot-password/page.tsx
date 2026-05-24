"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error("Enter your email address"); return; }
    setSubmitting(true);
    try {
      // Always returns 200 to prevent email enumeration.
      await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col bg-gradient-to-br from-primary via-primary/80 to-chart-4 p-10 text-primary-foreground lg:flex">
        <div className="z-10 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-6" />
          Quiz4Win Admin
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-green-500" />
              <h1 className="text-xl font-semibold">Check your inbox</h1>
              <p className="text-sm text-muted-foreground">
                If <strong>{email}</strong> matches an admin account, you will receive a reset link within a few minutes.
                The link expires in 30 minutes.
              </p>
              <p className="text-xs text-muted-foreground">
                Didn&apos;t receive it? Check your spam folder or ask a super admin to reset your password manually.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
                <p className="text-sm text-muted-foreground">
                  Enter your admin email. We will send a reset link via Brevo.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="admin@quiz4win.com"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" loading={submitting}>
                  Send reset link
                </Button>
              </form>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:underline"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
