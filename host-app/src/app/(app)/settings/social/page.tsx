import { Card, CardSubtitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { updateProfileAction } from "../actions";

export const metadata = { title: "Social profiles — Quiz4Win Host" };

interface Host {
  instagram_url: string | null; telegram_url: string | null; youtube_url: string | null;
  tiktok_url: string | null; twitter_url: string | null; website_url: string | null;
}

const FIELDS = [
  { name: "instagram_url", label: "Instagram", placeholder: "https://instagram.com/…" },
  { name: "telegram_url", label: "Telegram", placeholder: "https://t.me/…" },
  { name: "youtube_url", label: "YouTube", placeholder: "https://youtube.com/@…" },
  { name: "tiktok_url", label: "TikTok", placeholder: "https://tiktok.com/@…" },
  { name: "twitter_url", label: "X (Twitter)", placeholder: "https://x.com/…" },
  { name: "website_url", label: "Website", placeholder: "https://yoursite.com" },
] as const;

export default async function SocialProfilesPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const hostResult = await api<{ host: Host }>("/host/me");
  const h = hostResult.ok ? hostResult.data?.host : null;

  return (
    <>
      <PageHeader title="Social profiles" back="/settings" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      <Card>
        <CardSubtitle className="mb-3">
          Links players can use to find you. Leave any blank to hide it.
        </CardSubtitle>
        <form action={updateProfileAction} className="flex flex-col gap-3">
          <input type="hidden" name="redirect" value="/settings/social" />
          {FIELDS.map((f) => (
            <Input
              key={f.name}
              label={f.label}
              name={f.name}
              defaultValue={(h?.[f.name] as string | null) ?? ""}
              placeholder={f.placeholder}
              type="url"
              spellCheck={false}
              autoCapitalize="off"
            />
          ))}
          <Button type="submit">Save changes</Button>
        </form>
      </Card>
    </>
  );
}
