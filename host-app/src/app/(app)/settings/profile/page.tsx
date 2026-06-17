import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { updateProfileAction } from "../actions";

export const metadata = { title: "Edit profile — Quiz4Win Host" };

interface Host {
  country: string | null; phone: string | null;
  short_bio: string | null; bio: string | null; languages: string[] | null;
}

const LANGS = [
  { code: "en", label: "English" }, { code: "ar", label: "العربية" },
  { code: "fa", label: "فارسی" }, { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" },
  { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
];

export default async function EditProfilePage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const hostResult = await api<{ host: Host }>("/host/me");
  const h = hostResult.ok ? hostResult.data?.host : null;
  const myLangs = new Set(h?.languages ?? []);

  return (
    <>
      <PageHeader title="Edit profile" back="/settings" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      <Card>
        <form action={updateProfileAction} className="flex flex-col gap-3">
          <input type="hidden" name="redirect" value="/settings/profile" />
          <input type="hidden" name="has_languages" value="1" />

          <Input label="Country" name="country" defaultValue={h?.country ?? ""} placeholder="e.g. United Arab Emirates" />
          <Input label="Phone" name="phone" type="tel" defaultValue={h?.phone ?? ""} placeholder="+971 …" />

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/55">Languages</div>
            <div className="grid grid-cols-2 gap-2">
              {LANGS.map((l) => (
                <label key={l.code} className="glass flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-sm">
                  <input type="checkbox" name="languages" value={l.code}
                    defaultChecked={myLangs.has(l.code)} className="accent-[var(--color-q4w-primary)]" />
                  {l.label}
                </label>
              ))}
            </div>
          </div>

          <Input label="Tagline" name="short_bio" defaultValue={h?.short_bio ?? ""} maxLength={280}
            placeholder="A short line shown under your name" />
          <Textarea label="About you" name="bio" defaultValue={h?.bio ?? ""} maxLength={2000}
            placeholder="Tell players a bit about yourself" />

          <Button type="submit">Save changes</Button>
        </form>
      </Card>
    </>
  );
}
