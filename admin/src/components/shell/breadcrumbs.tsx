"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

function humanize(seg: string): string {
  return seg
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)} aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-foreground">
        <Home className="size-3.5" />
      </Link>
      {segments.map((seg, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={href} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5 opacity-50" />
            {isLast ? (
              <span className="font-medium text-foreground">{humanize(seg)}</span>
            ) : (
              <Link href={href} className="hover:text-foreground">
                {humanize(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
