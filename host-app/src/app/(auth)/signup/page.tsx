import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signupAction } from "./actions";

export const metadata = { title: "Sign up — Quiz4Win Host" };

export default async function SignupPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; email?: string; name?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="relative">
      <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-pink-500/30 via-fuchsia-500/20 to-teal-400/30 blur-sm" />
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">

        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Host portal</div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Create your host account</h1>
          <p className="mt-1 text-sm text-white/50">
            We&apos;ll email you a verification code to confirm your address.
          </p>
        </div>

        {sp.error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {sp.error}
          </div>
        ) : null}

        <form action={signupAction} className="flex flex-col gap-3.5">
          <Input label="Full name" type="text" name="name" autoComplete="name"
            defaultValue={sp.name ?? ""} placeholder="Your name" required minLength={2} />
          <Input label="Email" type="email" name="email" autoComplete="email"
            defaultValue={sp.email ?? ""} placeholder="you@example.com" required />
          <Input label="Password" type="password" name="password" autoComplete="new-password"
            placeholder="At least 8 characters" required minLength={8} />
          <Input label="Repeat password" type="password" name="confirm" autoComplete="new-password"
            placeholder="Repeat password" required minLength={8} />
          <Button type="submit" className="mt-1">Create account</Button>
        </form>

        <div className="mt-5 text-center text-xs text-white/40">
          Already have an account?{" "}
          <Link href="/signin" className="text-pink-300 hover:text-pink-200">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
