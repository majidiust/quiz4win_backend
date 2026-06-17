import Link from "next/link";
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
    <div className="relative">
      <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-pink-500/30 via-fuchsia-500/20 to-teal-400/30 blur-sm" />
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">

        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Host portal</div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Verify your email</h1>
          <p className="mt-1 text-sm text-white/50">
            Enter the code sent to{" "}
            <span className="text-white/80">{email || "your email"}</span>.
          </p>
        </div>

        {sp.error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {sp.error}
          </div>
        ) : null}
        {sp.info ? (
          <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
            {sp.info}
          </div>
        ) : null}

        <form action={verifyOtpAction} className="flex flex-col gap-3.5">
          <input type="hidden" name="email" value={email} />
          <Input
            label="Verification code"
            name="token"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            maxLength={8}
            placeholder="Enter code from your email"
            className="text-center text-lg tracking-[0.3em]"
            required
          />
          <Button type="submit">Verify &amp; continue</Button>
        </form>

        <form action={resendOtpAction} className="mt-3">
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="w-full py-2 text-center text-xs text-white/40 hover:text-white/70 transition-colors">
            Resend code
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-white/40">
          Wrong email?{" "}
          <Link href="/signup" className="text-pink-300 hover:text-pink-200">Start over</Link>
        </div>
      </div>
    </div>
  );
}
