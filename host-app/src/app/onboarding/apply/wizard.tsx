"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { COUNTRIES, COUNTRIES_BY_CODE, flagEmoji } from "@/lib/data/countries";
import { applyAction } from "./actions";
import { cn } from "@/lib/utils";

const LANGS = [
  { code: "en", label: "English" }, { code: "ar", label: "العربية" },
  { code: "fa", label: "فارسی" }, { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" },
  { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
] as const;

type State = {
  name: string; country: string; dial: string; phoneNational: string;
  languages: string[]; short_bio: string; bio: string;
  instagram_url: string; telegram_url: string; youtube_url: string;
  tiktok_url: string; twitter_url: string; website_url: string;
};

const STEPS = ["Basics", "Languages", "About", "Socials", "Review"] as const;

const countryOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code, label: c.name, hint: c.dial, leading: flagEmoji(c.code),
}));

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code, label: `${c.dial}`, hint: c.name, leading: flagEmoji(c.code),
}));

export default function ApplyWizard({ initialError }: { initialError?: string }) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [s, setS] = useState<State>({
    name: "", country: "", dial: "", phoneNational: "",
    languages: [], short_bio: "", bio: "",
    instagram_url: "", telegram_url: "", youtube_url: "",
    tiktok_url: "", twitter_url: "", website_url: "",
  });
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((prev) => ({ ...prev, [k]: v }));

  // Auto-pick the same country in the dial-code combobox the first time
  // the user selects a country. They can still change it manually after.
  const onCountry = (code: string) => {
    setS((prev) => ({ ...prev, country: code, dial: prev.dial || code }));
  };

  const phoneComposed = useMemo(() => {
    const d = COUNTRIES_BY_CODE[s.dial]?.dial ?? "";
    const num = s.phoneNational.replace(/[^0-9]/g, "");
    if (!d && !num) return "";
    return `${d} ${num}`.trim();
  }, [s.dial, s.phoneNational]);

  function validateStep(): boolean {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!s.name || s.name.trim().length < 2) e.name = "At least 2 characters";
      if (!s.country) e.country = "Pick your country";
      const digits = s.phoneNational.replace(/[^0-9]/g, "");
      if (!s.dial) e.dial = "Pick dial code";
      if (digits.length < 6) e.phoneNational = "Enter at least 6 digits";
    }
    if (step === 1) {
      if (s.languages.length < 1) e.languages = "Pick at least one language";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() { if (validateStep()) setStep((i) => Math.min(i + 1, STEPS.length - 1)); }
  function back() { setStep((i) => Math.max(i - 1, 0)); }

  function toggleLang(code: string) {
    setS((prev) => ({
      ...prev,
      languages: prev.languages.includes(code)
        ? prev.languages.filter((l) => l !== code) : [...prev.languages, code],
    }));
  }

  return (
    <>
      <Stepper step={step} />

      {initialError ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {initialError}
        </div>
      ) : null}

      <form action={applyAction} className="mt-5 flex flex-col gap-4">
        {/* Hidden fields persist values from every step across the whole form */}
        <input type="hidden" name="name" value={s.name} />
        {/* Send the country NAME (admin-readable). ISO code is internal-only. */}
        <input type="hidden" name="country" value={COUNTRIES_BY_CODE[s.country]?.name ?? ""} />
        <input type="hidden" name="phone" value={phoneComposed} />
        {s.languages.map((l) => <input key={l} type="hidden" name="languages" value={l} />)}
        <input type="hidden" name="short_bio" value={s.short_bio} />
        <input type="hidden" name="bio" value={s.bio} />
        <input type="hidden" name="instagram_url" value={s.instagram_url} />
        <input type="hidden" name="telegram_url" value={s.telegram_url} />
        <input type="hidden" name="youtube_url" value={s.youtube_url} />
        <input type="hidden" name="tiktok_url" value={s.tiktok_url} />
        <input type="hidden" name="twitter_url" value={s.twitter_url} />
        <input type="hidden" name="website_url" value={s.website_url} />

        {step === 0 ? (
          <Card className="flex flex-col gap-3">
            <Input
              label="Display name" value={s.name} onChange={(e) => set("name", e.target.value)}
              placeholder="Your on-stage name" maxLength={80} error={errors.name}
            />
            <Combobox
              label="Country" options={countryOptions} value={s.country} onChange={onCountry}
              placeholder="Select your country" searchPlaceholder="Search country…"
              error={errors.country}
            />
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <Combobox
                label="Code" options={dialOptions} value={s.dial} onChange={(v) => set("dial", v)}
                placeholder="+…" searchPlaceholder="Search…" error={errors.dial}
              />
              <Input
                label="Phone" inputMode="numeric" type="tel"
                value={s.phoneNational} onChange={(e) => set("phoneNational", e.target.value)}
                placeholder="1234 567 890" error={errors.phoneNational}
              />
            </div>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card>
            <div className="mb-1 text-xs font-medium text-[var(--color-q4w-muted)]">Languages you can host in</div>
            <div className="mb-3 text-[11px] text-[var(--color-q4w-muted)]">Select all that apply.</div>
            <div className="grid grid-cols-2 gap-2">
              {LANGS.map((l) => {
                const on = s.languages.includes(l.code);
                return (
                  <button
                    type="button"
                    key={l.code}
                    onClick={() => toggleLang(l.code)}
                    className={cn(
                      "glass flex h-11 items-center justify-center gap-2 rounded-2xl px-3 text-sm transition active:scale-[0.98]",
                      on
                        ? "border-[var(--color-q4w-primary)] bg-[var(--color-q4w-primary)]/15 text-[var(--color-q4w-text)]"
                        : "text-[var(--color-q4w-muted)]",
                    )}
                  >
                    <span className={cn("inline-block h-2 w-2 rounded-full", on ? "bg-[var(--color-q4w-primary)]" : "bg-white/20")} />
                    {l.label}
                  </button>
                );
              })}
            </div>
            {errors.languages ? (
              <div className="ml-1 mt-2 text-[11px] text-[var(--color-q4w-danger)]">{errors.languages}</div>
            ) : null}
          </Card>
        ) : null}

        {step === 2 ? (
          <Card className="flex flex-col gap-3">
            <Input
              label="Tagline" value={s.short_bio} onChange={(e) => set("short_bio", e.target.value)}
              maxLength={280} placeholder="One-line intro"
              hint="Shown next to your name on shows."
            />
            <Textarea
              label="About you" value={s.bio} onChange={(e) => set("bio", e.target.value)}
              maxLength={2000} placeholder="Tell admins (and viewers) about your experience"
            />
          </Card>
        ) : null}

        {step === 3 ? (
          <Card className="flex flex-col gap-3">
            <div className="text-xs font-medium text-[var(--color-q4w-muted)]">Social profiles (optional)</div>
            <Input value={s.instagram_url} onChange={(e) => set("instagram_url", e.target.value)} placeholder="https://instagram.com/…" />
            <Input value={s.telegram_url}  onChange={(e) => set("telegram_url", e.target.value)}  placeholder="https://t.me/…" />
            <Input value={s.youtube_url}   onChange={(e) => set("youtube_url", e.target.value)}   placeholder="https://youtube.com/@…" />
            <Input value={s.tiktok_url}    onChange={(e) => set("tiktok_url", e.target.value)}    placeholder="https://tiktok.com/@…" />
            <Input value={s.twitter_url}   onChange={(e) => set("twitter_url", e.target.value)}   placeholder="https://x.com/…" />
            <Input value={s.website_url}   onChange={(e) => set("website_url", e.target.value)}   placeholder="https://yoursite.com" />
          </Card>
        ) : null}

        {step === 4 ? (
          <ReviewCard s={s} phone={phoneComposed} />
        ) : null}

        <div className="mt-2 flex gap-3">
          {step > 0 ? (
            <Button type="button" variant="secondary" onClick={back}>Back</Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>Continue</Button>
          ) : (
            <Button type="submit">Submit application</Button>
          )}
        </div>
      </form>
    </>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--color-q4w-muted)]">
        <span>Step {step + 1} of {STEPS.length}</span>
        <span>{STEPS[step]}</span>
      </div>
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition",
              i <= step ? "bg-[var(--color-q4w-primary)]" : "bg-white/10",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ s, phone }: { s: State; phone: string }) {
  const country = COUNTRIES_BY_CODE[s.country];
  const langLabels = s.languages.map((c) => LANGS.find((l) => l.code === c)?.label ?? c).join(", ");
  return (
    <Card>
      <div className="mb-2 text-xs font-medium text-[var(--color-q4w-muted)]">Review</div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
        <dt className="text-[var(--color-q4w-muted)]">Name</dt><dd>{s.name || "—"}</dd>
        <dt className="text-[var(--color-q4w-muted)]">Country</dt>
        <dd>{country ? `${flagEmoji(country.code)} ${country.name}` : "—"}</dd>
        <dt className="text-[var(--color-q4w-muted)]">Phone</dt><dd>{phone || "—"}</dd>
        <dt className="text-[var(--color-q4w-muted)]">Languages</dt><dd>{langLabels || "—"}</dd>
        <dt className="text-[var(--color-q4w-muted)]">Tagline</dt><dd>{s.short_bio || "—"}</dd>
      </dl>
    </Card>
  );
}


