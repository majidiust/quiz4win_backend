import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { verifyOtpAction, resendOtpAction } from "./actions";

export const metadata = { title: "Verify email — Quiz4Win Host" };

export default async function VerifyOtpPage({
  searchParams,
}: { searchParams: Promise<{ email?: string; error?: string; info?: string }> }) {
  const sp = await searchParams;
  const email = sp.email ?? "";
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-semibold">Verify your email</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        Enter the 6-digit code sent to{" "}
        <span className="text-[var(--color-q4w-text)]">{email || "your email"}</span>.
      </p>

      {sp.error ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {sp.error}
        </div>
      ) : null}
      {sp.info ? (
        <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {sp.info}
        </div>
      ) : null}

      <form action={verifyOtpAction} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="email" value={email} />
        <Input
          label="6-digit code"
          name="token"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          className="text-center text-lg tracking-[0.3em]"
          required
        />
        <Button type="submit">Verify & continue</Button>
      </form>

      <form action={resendOtpAction} className="mt-3">
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="w-full py-2 text-center text-xs text-[var(--color-q4w-muted)] hover:text-[var(--color-q4w-text)]">
          Resend code
        </button>
      </form>

      <div className="mt-4 text-center text-xs text-[var(--color-q4w-muted)]">
        Wrong email?{" "}
        <Link href="/signup" className="text-[var(--color-q4w-primary)]">Start over</Link>
      </div>
    </Card>
  );
}
