export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      <header className="mb-6 flex items-center justify-between">
        <div className="text-sm uppercase tracking-[0.2em] text-[var(--color-q4w-muted)]">
          Quiz4Win
        </div>
        <div className="text-xs text-[var(--color-q4w-muted)]">Host</div>
      </header>
      <div className="flex-1">{children}</div>
    </main>
  );
}
