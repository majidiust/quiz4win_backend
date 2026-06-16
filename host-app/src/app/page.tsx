import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),24px)]">
      <header className="mb-8 flex items-center justify-between">
        <div className="text-sm uppercase tracking-[0.2em] text-[var(--color-q4w-muted)]">
          Quiz4Win
        </div>
        <div className="text-xs text-[var(--color-q4w-muted)]">Host</div>
      </header>

      <section className="glass rounded-3xl p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)]">
        <h1 className="text-3xl font-semibold leading-tight">
          Run live quiz shows. <span className="text-[var(--color-q4w-primary)]">Get paid.</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--color-q4w-muted)]">
          Apply once, get approved, then host scheduled live games. Track invitations,
          stream readiness and earnings in one place.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/signin"
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--color-q4w-primary)] px-5 text-sm font-medium text-white transition active:scale-[0.98]"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="glass inline-flex h-12 items-center justify-center rounded-2xl px-5 text-sm font-medium"
          >
            Create an account
          </Link>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          { k: "Approved", v: "fast" },
          { k: "Earnings", v: "wallet" },
          { k: "Stream", v: "1-tap" },
        ].map((c) => (
          <div key={c.k} className="glass rounded-2xl px-3 py-4">
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-q4w-muted)]">
              {c.k}
            </div>
            <div className="mt-1 text-sm font-medium">{c.v}</div>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-10 text-center text-[10px] text-[var(--color-q4w-muted)]">
        © Quiz4Win — Host dashboard scaffold
      </footer>
    </main>
  );
}
