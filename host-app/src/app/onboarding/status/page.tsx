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
  const me = await api<{ host: Host; onboarding_complete?: boolean }>("/host/me");

  if (!me.ok) {
    if (me.status === 401) redirect("/signin");
    redirect("/onboarding/apply");
  }

  const host = me.data.host;
  if (!host) redirect("/onboarding/apply");

  const isSuspended = host.status === "suspended";

  // Approved (and not suspended) → straight into the app.
  if (host.application_status === "approved" && !isSuspended) {
    redirect("/dashboard");
  }

  // Suspended / rejected get their own terminal screens.
  if (!isSuspended && host.application_status === "rejected") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
        <RejectedScreen notes={host.rejection_notes} />
      </main>
    );
  }

  // Anything not yet approved (pending or unknown) must FINISH onboarding before
  // we show the "under review" screen. A host who applied but never recorded
  // their intro video is sent back to complete it — on every login.
  if (!isSuspended && !me.data.onboarding_complete) {
    redirect("/onboarding/intro-video");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      {isSuspended ? <SuspendedScreen /> : <PendingScreen name={host.name} />}
    </main>
  );
}

function PendingScreen({ name }: { name: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      {/* Animated glow orb — pink/fuchsia theme */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-pink-500/15" />
        <div className="absolute inset-2 animate-pulse rounded-full bg-fuchsia-500/10" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-pink-500/40 bg-gradient-to-br from-pink-500/20 to-fuchsia-500/10">
          <svg className="h-10 w-10 text-pink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
          </svg>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Hi {name} 👋</h1>
        <p className="mt-2 text-white/50">Your application is under review</p>
      </div>

      {/* Progress steps */}
      <Card className="w-full">
        <ol className="flex flex-col gap-4">
          <Step done label="Profile submitted" description="Your application is on file." />
          <Step active label="Admin review" description="Our team is reviewing your profile and intro video." />
          <Step label="Approved" description="You'll receive an email and can start hosting shows." />
        </ol>
      </Card>

      <p className="text-center text-xs text-white/40">
        We&apos;ll email you when your application is reviewed. This usually takes 1–3 business days.
      </p>

      <div className="flex w-full flex-col gap-3">
        <a href="/onboarding/status" className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
          Refresh status
        </a>
        <Link href="/onboarding/intro-video" className="text-center text-xs text-white/40 underline underline-offset-2 hover:text-white/70">
          Re-record intro video
        </Link>
        <Link href="/signin" className="text-center text-xs text-white/35 hover:text-white/60">Sign out</Link>
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
        <Link href="/onboarding/apply" className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-pink-300 via-fuchsia-300 to-teal-300 text-sm font-semibold text-black shadow-[0_10px_40px_-10px_rgba(236,72,153,0.5)] transition hover:opacity-90">
          Submit a new application
        </Link>
        <Link href="/signin" className="text-center text-xs text-white/35 hover:text-white/60">Sign out</Link>
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
        done  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
        : active ? "border-pink-400/50 bg-pink-500/15 text-pink-300 animate-pulse"
        : "border-white/10 bg-white/5 text-white/30"
      }`}>
        {done ? "✓" : active ? "…" : "○"}
      </div>
      <div className="text-left">
        <div className={`text-sm font-medium ${active ? "text-pink-200" : done ? "text-emerald-200" : "text-white/40"}`}>{label}</div>
        <div className="text-[11px] text-white/35">{description}</div>
      </div>
    </li>
  );
}
