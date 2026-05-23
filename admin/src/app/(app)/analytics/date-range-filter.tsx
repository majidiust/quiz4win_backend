"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? defaultFrom;
  const to = sp.get("to") ?? today;

  const push = (next: Record<string, string>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(e) => push({ from: e.target.value })}
          className="h-8 w-[140px] text-xs"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => push({ to: e.target.value })}
          className="h-8 w-[140px] text-xs"
        />
      </div>
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => {
          const f = new Date(Date.now() - (p.days - 1) * 86400000).toISOString().slice(0, 10);
          const active = from === f && to === today;
          return (
            <Button
              key={p.label}
              size="sm"
              variant={active ? "secondary" : "ghost"}
              className="h-8 px-2.5 text-xs"
              onClick={() => push({ from: f, to: today })}
              disabled={pending}
            >
              {p.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
