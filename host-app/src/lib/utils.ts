import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (abs < min) return diff >= 0 ? "just now" : "in a moment";
  if (abs < hr) {
    const v = Math.round(abs / min);
    return diff >= 0 ? `${v}m ago` : `in ${v}m`;
  }
  if (abs < day) {
    const v = Math.round(abs / hr);
    return diff >= 0 ? `${v}h ago` : `in ${v}h`;
  }
  const v = Math.round(abs / day);
  return diff >= 0 ? `${v}d ago` : `in ${v}d`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatMoney(value: number | string | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}
