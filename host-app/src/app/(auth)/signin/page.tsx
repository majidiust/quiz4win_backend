import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signinAction } from "./actions";

export const metadata = { title: "Sign in — Quiz4Win Host" };

export default async function SigninPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; email?: string; next?: string; info?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="relative">
      {/* Outer glow ring */}
      <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-pink-500/30 via-fuchsia-500/20 to-teal-400/30 blur-sm" />
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">

        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Host portal</div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-white/50">
            Sign in to your host account to continue.
          </p>
        </div>

        {sp.info ? (
          <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
            {sp.info}
          </div>
        ) : null}

        {sp.error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {sp.error}
          </div>
        ) : null}

        <form action={signinAction} className="flex flex-col gap-3.5">
          <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
          <Input label="Email" type="email" name="email" autoComplete="email"
            defaultValue={sp.email ?? ""} placeholder="you@example.com" required />
          <Input label="Password" type="password" name="password" autoComplete="current-password"
            placeholder="••••••••" required minLength={6} />
          <Button type="submit" className="mt-1">Sign in</Button>
        </form>

        <div className="mt-5 text-center text-xs text-white/40">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-pink-300 hover:text-pink-200">Create one</Link>
        </div>
      </div>
    </div>
  );
}
