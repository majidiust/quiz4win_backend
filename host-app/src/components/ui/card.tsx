import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "glass rounded-2xl p-4 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.45)]",
        className,
      )}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-base font-semibold", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-xs text-[var(--color-q4w-muted)]", className)} {...props} />;
}
