export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      {/* Glass pill header — mirrors quiz4win.com nav style */}
      <header className="mb-8">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 backdrop-blur-xl">
          <span className="bg-gradient-to-r from-pink-300 via-fuchsia-300 to-teal-300 bg-clip-text text-sm font-bold tracking-tight text-transparent">
            Quiz4Win
          </span>
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
            Host Portal
          </span>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </main>
  );
}
