"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;     // e.g. dial code / sub-label
  leading?: string;  // e.g. flag emoji
}

interface Props {
  label?: string;
  name?: string;            // emits a hidden <input name=…> so the form posts the value
  options: ComboboxOption[];
  value: string;            // controlled
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

const triggerCls =
  "flex h-12 w-full items-center justify-between gap-2 rounded-2xl border " +
  "border-[var(--color-q4w-border)] bg-[var(--color-q4w-glass)] px-4 text-sm " +
  "text-[var(--color-q4w-text)] transition focus:outline-none focus:border-[var(--color-q4w-primary)] " +
  "focus:ring-2 focus:ring-[var(--color-q4w-primary)]/20";

export function Combobox({
  label, name, options, value, onChange, placeholder, required, error,
  searchPlaceholder = "Search…", emptyMessage = "No matches",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q) ||
      (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [query, options]);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    setTimeout(() => searchRef.current?.focus(), 30);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => { setActive(0); }, [query, open]);

  function pick(v: string) { onChange(v); setOpen(false); setQuery(""); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); if (filtered[active]) pick(filtered[active].value); return; }
  }

  return (
    <div ref={rootRef} className="relative">
      {label ? (
        <div className="mb-1.5 ml-1 text-xs font-medium text-[var(--color-q4w-muted)]">{label}</div>
      ) : null}
      <button
        type="button"
        id={inputId}
        onClick={() => setOpen((o) => !o)}
        className={cn(triggerCls, error && "border-[var(--color-q4w-danger)]")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("flex min-w-0 items-center gap-2", !selected && "text-[var(--color-q4w-muted)]")}>
          {selected?.leading ? <span className="text-base">{selected.leading}</span> : null}
          <span className="truncate">{selected ? selected.label : (placeholder ?? "Select…")}</span>
          {selected?.hint ? (
            <span className="text-xs text-[var(--color-q4w-muted)]">{selected.hint}</span>
          ) : null}
        </span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 20 20" className="opacity-60">
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      {error ? <div className="ml-1 mt-1 text-[11px] text-[var(--color-q4w-danger)]">{error}</div> : null}

      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-2xl border border-[var(--color-q4w-border)] bg-[#10131d]/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={searchPlaceholder}
            className="mb-2 h-10 w-full rounded-xl border border-[var(--color-q4w-border)] bg-[var(--color-q4w-glass)] px-3 text-sm text-[var(--color-q4w-text)] placeholder:text-[var(--color-q4w-muted)] focus:outline-none focus:border-[var(--color-q4w-primary)]"
            autoComplete="off"
          />
          <div ref={listRef} className="max-h-64 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--color-q4w-muted)]">{emptyMessage}</div>
            ) : filtered.map((o, idx) => {
              const isActive = idx === active;
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                    isActive ? "bg-white/8" : "hover:bg-white/5",
                    isSelected && "text-[var(--color-q4w-primary)]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {o.leading ? <span className="text-base">{o.leading}</span> : null}
                    <span className="truncate">{o.label}</span>
                  </span>
                  {o.hint ? <span className="shrink-0 text-xs text-[var(--color-q4w-muted)]">{o.hint}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
