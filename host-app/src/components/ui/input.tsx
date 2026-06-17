import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

// Inner input — matches quiz4win.com/become-host field style.
const baseInput =
  "h-11 w-full bg-transparent text-white placeholder:text-white/35 text-sm outline-none border-0 focus:ring-0";

// Outer wrapper — rounded glass pill that glows on focus.
const baseWrapper =
  "flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] " +
  "focus-within:border-white/30 focus-within:bg-white/[0.07] transition-all px-4";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...props }, ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="block" htmlFor={inputId}>
      {label ? (
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/55">{label}</div>
      ) : null}
      <div className={cn(baseWrapper, error && "border-rose-400/40 bg-rose-500/5")}>
        <input ref={ref} id={inputId} className={cn(baseInput, className)} {...props} />
      </div>
      {hint && !error ? <div className="mt-1 text-[11px] text-white/40">{hint}</div> : null}
      {error ? <div className="mt-1 text-[11px] text-rose-300">{error}</div> : null}
    </label>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, ...props }, ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="block" htmlFor={inputId}>
      {label ? (
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/55">{label}</div>
      ) : null}
      <div className={cn(baseWrapper, "items-start py-3", error && "border-rose-400/40 bg-rose-500/5")}>
        <textarea
          ref={ref}
          id={inputId}
          className={cn("min-h-[72px] w-full resize-none bg-transparent text-white placeholder:text-white/35 text-sm outline-none border-0 focus:ring-0", className)}
          {...props}
        />
      </div>
      {hint && !error ? <div className="mt-1 text-[11px] text-white/40">{hint}</div> : null}
      {error ? <div className="mt-1 text-[11px] text-rose-300">{error}</div> : null}
    </label>
  );
});
