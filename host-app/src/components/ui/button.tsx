import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const STYLES: Record<ButtonVariant, string> = {
  primary: "bg-[var(--color-q4w-primary)] text-white active:bg-[var(--color-q4w-primary-2)]",
  secondary: "glass text-[var(--color-q4w-text)]",
  ghost: "text-[var(--color-q4w-muted)] hover:text-[var(--color-q4w-text)]",
  danger: "bg-[var(--color-q4w-danger)] text-white",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", loading, className, children, disabled, ...props }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center rounded-2xl px-5 text-sm font-medium",
        "transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
        STYLES[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : children}
    </button>
  );
});
