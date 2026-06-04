"use client";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * Multi-select for a game/template's `target_languages` — the COMPLETE set of
 * languages every generated question must be produced in. The `primary`
 * language (the default display language) is always kept selected and locked,
 * so the target set can never drop below the primary language.
 */
const LANGS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "fa", label: "Persian" },
  { value: "tr", label: "Turkish" },
] as const;

export function LanguageMultiSelect({
  value,
  primary,
  onChange,
  disabled,
}: {
  value: string[];
  primary?: string;
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(code: string, checked: boolean) {
    const set = new Set(value);
    if (checked) set.add(code);
    else set.delete(code);
    if (primary) set.add(primary); // primary is mandatory
    // Preserve canonical ordering and only emit supported codes.
    onChange(LANGS.map((l) => l.value).filter((v) => set.has(v)));
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {LANGS.map((l) => {
        const isPrimary = l.value === primary;
        const checked = value.includes(l.value) || isPrimary;
        return (
          <label
            key={l.value}
            className="flex items-center gap-1.5 text-sm cursor-pointer select-none"
          >
            <Checkbox
              checked={checked}
              disabled={disabled || isPrimary}
              onCheckedChange={(c) => toggle(l.value, c === true)}
            />
            <span>
              {l.label}
              {isPrimary ? <span className="text-muted-foreground"> (primary)</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
