import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Reusable building blocks for entity detail pages (hosts, applications, …).
 *
 * - DetailSection — a titled card with an optional icon and header actions.
 * - DetailGrid    — responsive two-column wrapper for stacked DetailFields.
 * - DetailField   — label-on-top / value-below pair (use inside DetailGrid).
 * - DetailRow     — label-left / value-right pair (use in narrow sidebars).
 * - SummaryCell   — compact stat cell for summary grids.
 */

export function DetailSection({
  title, icon: Icon, actions, className, contentClassName, children,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          {Icon ? <Icon className="size-4" /> : null}
          {title}
        </CardTitle>
        {actions ?? null}
      </CardHeader>
      <CardContent className={cn("space-y-3 text-sm", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function DetailGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</dl>;
}

export function DetailField({
  label, icon: Icon, children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3" /> : null}
        {label}
      </dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function DetailRow({
  label, value, icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3" /> : null}
        {label}
      </dt>
      <dd className="text-right text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function SummaryCell({
  label, value, highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={highlight ? "rounded-md bg-foreground/5 p-2" : "p-2"}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
