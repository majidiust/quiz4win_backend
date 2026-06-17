import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardSubtitle } from "@/components/ui/card";

export const metadata = { title: "Application Status — Quiz4Win Host" };

interface Host {
  name: string;
  application_status: string;
  status: string;
  rejection_notes?: string | null;
}

export default async function StatusPage() {
  const me = await api<{ host: Host }>("/host/me");

  if (!me.ok) {
    if (me.status === 401) redirect("/signin");
    redirect("/onboarding/apply");
  }

  const host = me.data.host;
  if (!host) redirect("/onboarding/apply");

  // If somehow approved (race condition), let them through.
  if (host.application_status === "approved" && host.status !== "suspended") {
    redirect("/dashboard");
  }

  const isPending  = host.application_status === "pending";
  const isRejected = host.application_status === "rejected";
  const isSuspended = host.status === "suspended";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      {isPending && !isSuspended && <PendingScreen name={host.name} />}
      {isRejected && !isSuspended && <RejectedScreen notes={host.rejection_notes} />}
      {isSuspended && <SuspendedScreen />}
      {!isPending && !isRejected && !isSuspended && <PendingScreen name={host.name} />}
    </main>
  );
}

function PendingScreen({ name }: { name: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      {/* Animated glow orb */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
        <div className="absolute inset-2 animate-pulse rounded-full bg-amber-500/15" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
          <svg className="h-10 w-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
          </svg>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Hi {name} 👋</h1>
        <p className="mt-2 text-[var(--color-q4w-muted)]">Your application is under review</p>
      </div>

      {/* Progress steps */}
      <Card className="w-full">
        <ol className="flex flex-col gap-4">
          <Step done label="Profile submitted" description="Your application is on file." />
          <Step active label="Admin review" description="Our team is reviewing your profile and intro video." />
          <Step label="Approved" description="You'll receive an email and can start hosting shows." />
        </ol>
      </Card>

      <CardSubtitle className="text-center">
        We&apos;ll email you when your application is reviewed. This usually takes 1–3 business days.
      </CardSubtitle>

      <div className="flex w-full flex-col gap-3">
        <a href="/onboarding/status" className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white/5 text-sm font-medium text-[var(--color-q4w-muted)] transition hover:bg-white/10">
          Refresh status
        </a>
        <Link href="/onboarding/intro-video" className="text-center text-xs text-[var(--color-q4w-muted)] underline underline-offset-2">
          Upload intro video
        </Link>
        <Link href="/signin" className="text-center text-xs text-[var(--color-q4w-muted)]">Sign out</Link>
      </div>
    </div>
  );
}

function RejectedScreen({ notes }: { notes?: string | null }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
        <svg className="h-10 w-10 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Application not approved</h1>
        <p className="mt-2 text-sm text-[var(--color-q4w-muted)]">
          Unfortunately your application was not approved at this time.
        </p>
      </div>
      {notes ? (
        <Card className="w-full border border-rose-500/20 bg-rose-500/5 text-left">
          <div className="mb-1 text-xs font-medium text-rose-400">Feedback from our team</div>
          <p className="text-sm text-[var(--color-q4w-text)]">{notes}</p>
        </Card>
      ) : null}
      <div className="flex w-full flex-col gap-3">
        <Link href="/onboarding/apply" className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[var(--color-q4w-primary)] text-sm font-medium text-white transition">
          Submit a new application
        </Link>
        <Link href="/signin" className="text-center text-xs text-[var(--color-q4w-muted)]">Sign out</Link>
      </div>
    </div>
  );
}

function SuspendedScreen() {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
        <svg className="h-10 w-10 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Account suspended</h1>
        <p className="mt-2 text-sm text-[var(--color-q4w-muted)]">
          Your account has been suspended. Please contact support if you believe this is a mistake.
        </p>
      </div>
      <Link href="/signin" className="text-center text-xs text-[var(--color-q4w-muted)]">Sign out</Link>
    </div>
  );
}

function Step({ done, active, label, description }: { done?: boolean; active?: boolean; label: string; description: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition ${
        done  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
        : active ? "border-amber-500/50 bg-amber-500/15 text-amber-400 animate-pulse"
        : "border-white/10 bg-white/5 text-[var(--color-q4w-muted)]"
      }`}>
        {done ? "✓" : active ? "…" : "○"}
      </div>
      <div className="text-left">
        <div className={`text-sm font-medium ${active ? "text-amber-200" : done ? "text-emerald-200" : "text-[var(--color-q4w-muted)]"}`}>{label}</div>
        <div className="text-[11px] text-[var(--color-q4w-muted)]">{description}</div>
      </div>
    </li>
  );
}
