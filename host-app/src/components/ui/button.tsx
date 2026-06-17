import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const STYLES: Record<ButtonVariant, string> = {
  // Gradient + pink glow shadow — matches quiz4win.com/become-host CTA style.
  primary:
    "bg-gradient-to-r from-pink-300 via-fuchsia-300 to-teal-300 text-black font-semibold " +
    "shadow-[0_10px_40px_-10px_rgba(236,72,153,0.55)] hover:opacity-90 active:opacity-80",
  secondary: "glass border border-white/10 text-[var(--color-q4w-text)] hover:bg-white/10",
  ghost: "text-white/50 hover:text-white",
  danger:
    "bg-rose-500/20 border border-rose-400/30 text-rose-200 hover:bg-rose-500/30",
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
