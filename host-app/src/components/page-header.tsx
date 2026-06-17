import { BackButton } from "@/components/back-button";

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 bg-gradient-to-b from-[var(--color-q4w-bg)] via-[var(--color-q4w-bg)]/85 to-transparent px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur">
      {back ? <BackButton fallback={back} /> : null}
      <div className="flex-1">
        <h1 className="text-lg font-semibold leading-tight">{title}</h1>
        {subtitle ? <div className="text-xs text-[var(--color-q4w-muted)]">{subtitle}</div> : null}
      </div>
      {action}
    </header>
  );
}
