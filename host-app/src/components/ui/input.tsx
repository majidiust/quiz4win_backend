import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

const baseField = "h-12 w-full rounded-2xl border border-[var(--color-q4w-border)] " +
  "bg-[var(--color-q4w-glass)] px-4 text-sm text-[var(--color-q4w-text)] " +
  "placeholder:text-[var(--color-q4w-muted)] focus:outline-none " +
  "focus:border-[var(--color-q4w-primary)] focus:ring-2 focus:ring-[var(--color-q4w-primary)]/20 " +
  "transition";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...props }, ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="block" htmlFor={inputId}>
      {label ? (
        <div className="mb-1.5 ml-1 text-xs font-medium text-[var(--color-q4w-muted)]">{label}</div>
      ) : null}
      <input ref={ref} id={inputId} className={cn(baseField, error && "border-[var(--color-q4w-danger)]", className)} {...props} />
      {hint && !error ? <div className="ml-1 mt-1 text-[11px] text-[var(--color-q4w-muted)]">{hint}</div> : null}
      {error ? <div className="ml-1 mt-1 text-[11px] text-[var(--color-q4w-danger)]">{error}</div> : null}
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
        <div className="mb-1.5 ml-1 text-xs font-medium text-[var(--color-q4w-muted)]">{label}</div>
      ) : null}
      <textarea
        ref={ref}
        id={inputId}
        className={cn(baseField.replace("h-12", "min-h-[88px] py-3"), error && "border-[var(--color-q4w-danger)]", className)}
        {...props}
      />
      {hint && !error ? <div className="ml-1 mt-1 text-[11px] text-[var(--color-q4w-muted)]">{hint}</div> : null}
      {error ? <div className="ml-1 mt-1 text-[11px] text-[var(--color-q4w-danger)]">{error}</div> : null}
    </label>
  );
});
