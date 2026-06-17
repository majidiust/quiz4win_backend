import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signinAction } from "./actions";

export const metadata = { title: "Sign in — Quiz4Win Host" };

export default async function SigninPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; email?: string; next?: string; info?: string }> }) {
  const sp = await searchParams;
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        Sign in to your host account to continue.
      </p>

      {sp.info ? (
        <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {sp.info}
        </div>
      ) : null}

      {sp.error ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {sp.error}
        </div>
      ) : null}

      <form action={signinAction} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          defaultValue={sp.email ?? ""}
          placeholder="you@example.com"
          required
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          minLength={6}
        />
        <Button type="submit" className="mt-2">Sign in</Button>
      </form>

      <div className="mt-5 text-center text-xs text-[var(--color-q4w-muted)]">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[var(--color-q4w-primary)]">Create one</Link>
      </div>
    </Card>
  );
}
