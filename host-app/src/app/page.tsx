import Link from "next/link";
import { ChevronRight, Zap, Users, Trophy, Clock, Shield, Star, TrendingUp, Radio } from "lucide-react";

// Stats sourced from quiz4win.com/become-host
const STATS = [
  { value: "2.4k", label: "shows / month" },
  { value: "180+", label: "active hosts" },
  { value: "47", label: "countries" },
];

const STEPS = [
  {
    icon: Shield,
    step: "01",
    title: "Apply to host a show",
    body: "Sign up on the host portal — onboarding takes under 5 minutes, no waiting list.",
  },
  {
    icon: Star,
    step: "02",
    title: "Get onboarded live",
    body: "Production support, stage graphics, and live ops are all handled by Quiz4Win. You just bring your energy.",
  },
  {
    icon: TrendingUp,
    step: "03",
    title: "Host & earn per show",
    body: "Earn a flat fee of $150–$1,000 scaled by your real audience size, plus 1%–5% revenue share of participant entries.",
  },
];

const BENEFITS = [
  { icon: Zap, title: "Transparent payouts", body: "Fixed fee confirmed before the show, revenue share paid out right after. No surprises." },
  { icon: Users, title: "Keep your community", body: "Bring your audience — they stay yours. Cross-promo on every show amplifies your reach." },
  { icon: Trophy, title: "Full production support", body: "Stage graphics, live ops, and tech all handled by Quiz4Win. You focus on the show." },
  { icon: Clock, title: "Real revenue share", body: "Earn 1%–5% of participant entries every show, on top of your guaranteed flat fee." },
];

export default async function HomePage() {
  // Fetch live/upcoming counts as social proof — fail gracefully on error.
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");
  let liveCount = 0;
  let upcomingCount = 0;
  try {
    const [liveRes, upcomingRes] = await Promise.allSettled([
      fetch(`${apiBase}/public-hosts/live?limit=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${apiBase}/public-hosts/upcoming?limit=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (liveRes.status === "fulfilled" && liveRes.value?.pagination?.total)
      liveCount = liveRes.value.pagination.total;
    if (upcomingRes.status === "fulfilled" && upcomingRes.value?.pagination?.total)
      upcomingCount = upcomingRes.value.pagination.total;
  } catch { /* silently ignore — static copy still renders */ }

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
        Step on the stage.<br />
        <span className="bg-gradient-to-r from-pink-400 via-fuchsia-400 to-teal-400 bg-clip-text text-transparent">
          Get paid every show.
        </span>
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-[var(--color-q4w-muted)]">
        Quiz4Win turns creators and presenters into prime-time hosts. Bring your
        audience, host live competitions, and earn a flat fee per show plus a
        real share of participation revenue.
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
        Free to apply · No waiting list · Under 5 minutes to onboard
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

      {/* ── Live activity strip ──────────────────────────────────────── */}
      {(liveCount > 0 || upcomingCount > 0) ? (
        <div className="mb-8 flex items-center gap-3 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-2.5 text-xs">
          {liveCount > 0 ? (
            <>
              <Radio className="h-3 w-3 shrink-0 text-red-400" />
              <span className="font-medium text-red-300">
                {liveCount} host{liveCount !== 1 ? "s" : ""} live right now
              </span>
            </>
          ) : null}
          {liveCount > 0 && upcomingCount > 0 ? (
            <span className="text-white/20">·</span>
          ) : null}
          {upcomingCount > 0 ? (
            <span className="text-[var(--color-q4w-muted)]">
              {upcomingCount} show{upcomingCount !== 1 ? "s" : ""} upcoming
            </span>
          ) : null}
        </div>
      ) : null}

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

      {/* ── Earnings breakdown ───────────────────────────────────────── */}
      <div className="mb-10 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Your earnings</p>
        <div className="flex justify-between gap-3">
          <div>
            <div className="text-base font-bold text-white">$150 – $1,000</div>
            <div className="text-[10px] text-amber-200/70">per-show fee, scaled by audience</div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold text-white">1% – 5%</div>
            <div className="text-[10px] text-amber-200/70">revenue share of entries</div>
          </div>
        </div>
      </div>

      {/* ── Bottom CTA block ─────────────────────────────────────────── */}
      <section className="glass rounded-3xl p-6 text-center">
        <h2 className="mb-2 text-xl font-bold">Ready to go live?</h2>
        <p className="mb-5 text-xs leading-relaxed text-[var(--color-q4w-muted)]">
          180+ hosts across 47 countries are already earning every show.<br />Onboarding takes under 5 minutes — no waiting list.
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
