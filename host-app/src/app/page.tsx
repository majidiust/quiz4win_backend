import Link from "next/link";
import { ChevronRight, Zap, Users, Trophy, Clock, Shield, Star, TrendingUp } from "lucide-react";

const STATS = [
  { value: "€850", label: "avg. per show" },
  { value: "< 1 hr", label: "approval time" },
  { value: "10 k+", label: "players / game" },
];

const STEPS = [
  {
    icon: Shield,
    step: "01",
    title: "Apply once",
    body: "Fill your host profile — takes 2 minutes. Our team reviews it, usually the same hour.",
  },
  {
    icon: Star,
    step: "02",
    title: "Get approved",
    body: "Approved hosts receive game invitations and can request open show slots themselves.",
  },
  {
    icon: TrendingUp,
    step: "03",
    title: "Host & earn",
    body: "Go live, entertain thousands of players, and collect earnings instantly when the show ends.",
  },
];

const BENEFITS = [
  { icon: Zap, title: "Instant pay-out", body: "Earnings hit your wallet the moment a show ends. No delays." },
  { icon: Users, title: "Massive audience", body: "Every game surfaces to thousands of active players — you just show up." },
  { icon: Trophy, title: "Build fame", body: "Grow your host rating, collect followers, unlock bigger and better shows." },
  { icon: Clock, title: "Your schedule", body: "Accept only the games that fit your life. Zero minimums." },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-16 pt-[max(env(safe-area-inset-top),28px)]">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="mb-10 flex items-center justify-between">
        <span className="text-sm font-bold tracking-[0.16em]">
          Quiz4Win <span className="text-[var(--color-q4w-primary)]">Host</span>
        </span>
        <Link
          href="/signin"
          className="text-xs text-[var(--color-q4w-muted)] transition hover:text-[var(--color-q4w-text)]"
        >
          Sign in
        </Link>
      </header>

      {/* ── Live badge ───────────────────────────────────────────────── */}
      <div className="mb-5 inline-flex self-start items-center gap-2 rounded-full border border-[var(--color-q4w-primary)]/30 bg-[var(--color-q4w-primary)]/10 px-3 py-1 text-[11px] font-medium text-[var(--color-q4w-primary)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-q4w-primary)]" />
        Accepting new hosts in your region
      </div>

      {/* ── Hero headline ────────────────────────────────────────────── */}
      <h1 className="mb-4 text-[2.6rem] font-bold leading-[1.08] tracking-tight">
        Turn your knowledge<br />
        into{" "}
        <span className="bg-gradient-to-r from-pink-400 via-fuchsia-400 to-teal-400 bg-clip-text text-transparent">
          real income.
        </span>
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-[var(--color-q4w-muted)]">
        Host live quiz shows, engage thousands of real players, and collect
        earnings — all from your phone. Apply once, get approved, start earning.
      </p>

      {/* ── Primary CTA ──────────────────────────────────────────────── */}
      <div className="mb-3">
        <Link
          href="/signup"
          className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-400 via-fuchsia-400 to-teal-400 px-6 text-sm font-semibold text-black shadow-[0_14px_44px_-10px_rgba(236,72,153,0.65)] transition active:scale-[0.98]"
        >
          Apply to become a host <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="mb-10 text-center text-[10px] text-[var(--color-q4w-muted)]">
        Free to apply · No commitment · Approved within the hour
      </p>

      {/* ── Social-proof stats ───────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="glass rounded-2xl py-4 text-center">
            <div className="text-lg font-bold">{s.value}</div>
            <div className="mt-0.5 text-[10px] text-[var(--color-q4w-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-q4w-muted)]">
          How it works
        </h2>
        <div className="flex flex-col gap-3">
          {STEPS.map((s) => (
            <div key={s.step} className="glass flex gap-4 rounded-2xl p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-q4w-primary)]/15 text-[var(--color-q4w-primary)]">
                <s.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="mb-0.5 flex items-center gap-2 text-sm font-semibold">
                  <span className="text-[10px] text-[var(--color-q4w-muted)]">{s.step}</span>
                  {s.title}
                </div>
                <p className="text-[12px] leading-relaxed text-[var(--color-q4w-muted)]">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Benefits grid ────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-q4w-muted)]">
          Why hosts love it
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="glass rounded-2xl p-4">
              <b.icon className="mb-2 h-5 w-5 text-[var(--color-q4w-primary-2)]" />
              <div className="mb-1 text-sm font-semibold">{b.title}</div>
              <p className="text-[11px] leading-relaxed text-[var(--color-q4w-muted)]">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Scarcity nudge ───────────────────────────────────────────── */}
      <div className="mb-10 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-center">
        <p className="text-xs font-medium text-amber-300">
          🔥 Host slots are capped per region to keep quality high. Once we reach capacity, applications close.
        </p>
      </div>

      {/* ── Bottom CTA block ─────────────────────────────────────────── */}
      <section className="glass rounded-3xl p-6 text-center">
        <h2 className="mb-2 text-xl font-bold">Ready to start earning?</h2>
        <p className="mb-5 text-xs leading-relaxed text-[var(--color-q4w-muted)]">
          Join the hosts already making money every week.<br />It only takes 2 minutes to apply.
        </p>
        <Link
          href="/signup"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-400 via-fuchsia-400 to-teal-400 text-sm font-semibold text-black shadow-[0_10px_40px_-10px_rgba(236,72,153,0.5)] transition active:scale-[0.98]"
        >
          Apply now — it&apos;s free <ChevronRight className="h-4 w-4" />
        </Link>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="mt-10 text-center text-[10px] text-[var(--color-q4w-muted)]">
        © Quiz4Win ·{" "}
        <Link href="/signin" className="transition hover:text-white">
          Already a host? Sign in
        </Link>
      </footer>
    </main>
  );
}
