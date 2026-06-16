import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyAction } from "./actions";
import { redirect } from "next/navigation";

export const metadata = { title: "Complete your profile — Quiz4Win Host" };

const LANGS = [
  { code: "en", label: "English" }, { code: "ar", label: "العربية" },
  { code: "fa", label: "فارسی" }, { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" },
  { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
];

export default async function ApplyPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const me = await api<{ host: Record<string, unknown> }>("/host/me");
  if (me.ok && me.data?.host) {
    const h = me.data.host as { application_status?: string };
    if (h.application_status === "approved" || h.application_status === "pending") redirect("/dashboard");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      <h1 className="text-2xl font-semibold">Tell us about you</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        Complete your host profile. Admins will review and approve your application.
      </p>

      {sp.error ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {sp.error}
        </div>
      ) : null}

      <form action={applyAction} className="mt-5 flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <Input label="Display name" name="name" required minLength={2} maxLength={80} placeholder="Your on-stage name" />
          <Input label="Country" name="country" placeholder="e.g. Germany" />
          <Input label="Phone" name="phone" type="tel" placeholder="+49 …" />
        </Card>

        <Card>
          <div className="mb-2 text-xs font-medium text-[var(--color-q4w-muted)]">Languages you can host in</div>
          <div className="grid grid-cols-2 gap-2">
            {LANGS.map((l) => (
              <label key={l.code} className="glass flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-sm">
                <input type="checkbox" name="languages" value={l.code} className="accent-[var(--color-q4w-primary)]" />
                {l.label}
              </label>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-3">
          <Input label="Tagline" name="short_bio" maxLength={280} placeholder="One-line intro" />
          <Textarea label="About you" name="bio" maxLength={2000} placeholder="Tell admins (and viewers) about your experience" />
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="text-xs font-medium text-[var(--color-q4w-muted)]">Social profiles (optional)</div>
          <Input name="instagram_url" placeholder="https://instagram.com/…" />
          <Input name="telegram_url"  placeholder="https://t.me/…" />
          <Input name="youtube_url"   placeholder="https://youtube.com/@…" />
          <Input name="tiktok_url"    placeholder="https://tiktok.com/@…" />
          <Input name="twitter_url"   placeholder="https://x.com/…" />
          <Input name="website_url"   placeholder="https://yoursite.com" />
        </Card>

        <Button type="submit">Submit application</Button>
      </form>
    </main>
  );
}
