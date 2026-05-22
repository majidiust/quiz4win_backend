import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col bg-gradient-to-br from-primary via-primary/80 to-chart-4 p-10 text-primary-foreground lg:flex">
        <div className="z-10 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-6" />
          Quiz4Win Admin
        </div>
        <div className="z-10 mt-auto space-y-4">
          <blockquote className="space-y-2">
            <p className="text-2xl font-light leading-snug">
              &ldquo;The control center for live quiz games, finance operations, and player trust.&rdquo;
            </p>
            <footer className="text-sm opacity-80">Operations Console · v0.1</footer>
          </blockquote>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in with your admin credentials</p>
          </div>
          <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-muted" />}>
            <LoginForm />
          </Suspense>
          <p className="text-center text-xs text-muted-foreground">
            Restricted to authorized administrators. All actions are logged.
          </p>
        </div>
      </div>
    </div>
  );
}
