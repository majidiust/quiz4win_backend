import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  verified: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  live: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  testing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  sent: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  accepted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  cancelled: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  expired: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  suspended: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  inactive: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  ended: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  created: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  pending_verification: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  // game-control panel phases
  waiting:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  countdown: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  idle:      "bg-slate-500/15 text-slate-300 border-slate-500/30",
  prepared:  "bg-purple-500/15 text-purple-300 border-purple-500/30",
  closed:    "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function StatusChip({ status, className }: { status: string | null | undefined; className?: string }) {
  const key = (status ?? "").toLowerCase();
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider",
      COLORS[key] ?? "bg-[var(--color-q4w-glass)] text-[var(--color-q4w-muted)] border-[var(--color-q4w-border)]",
      className,
    )}>
      {status ? status.replaceAll("_", " ") : "—"}
    </span>
  );
}
