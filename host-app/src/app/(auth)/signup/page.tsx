import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signupAction } from "./actions";

export const metadata = { title: "Sign up — Quiz4Win Host" };

export default async function SignupPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const sp = await searchParams;
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-semibold">Create your host account</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        We&apos;ll email you a 6-digit code to confirm your address.
      </p>

      {sp.error ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {sp.error}
        </div>
      ) : null}

      <form action={signupAction} className="mt-6 flex flex-col gap-3">
        <Input label="Email" type="email" name="email" autoComplete="email" defaultValue={sp.email ?? ""}
          placeholder="you@example.com" required />
        <Input label="Password" type="password" name="password" autoComplete="new-password"
          placeholder="At least 8 characters" required minLength={8} />
        <Input label="Repeat password" type="password" name="confirm" autoComplete="new-password"
          placeholder="Repeat password" required minLength={8} />
        <Button type="submit" className="mt-2">Create account</Button>
      </form>

      <div className="mt-5 text-center text-xs text-[var(--color-q4w-muted)]">
        Already have an account?{" "}
        <Link href="/signin" className="text-[var(--color-q4w-primary)]">Sign in</Link>
      </div>
    </Card>
  );
}
