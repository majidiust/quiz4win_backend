import Link from "next/link";
import { FileText, CreditCard, Bell, LogOut, ChevronRight } from "lucide-react";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { updateProfileAction, signOutAction, getUploadToken } from "./actions";
import { AvatarPickerSection } from "./avatar-picker";

export const metadata = { title: "Settings — Quiz4Win Host" };

interface Host {
  name: string; country: string | null; phone: string | null; short_bio: string | null;
  bio: string | null; languages: string[] | null; application_status: string; status: string;
  avatar_url: string | null;
  instagram_url: string | null; telegram_url: string | null; youtube_url: string | null;
  tiktok_url: string | null; twitter_url: string | null; website_url: string | null;
}

const LANGS = [
  { code: "en", label: "English" }, { code: "ar", label: "العربية" },
  { code: "fa", label: "فارسی" }, { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" },
  { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
];

export default async function SettingsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const [hostResult, uploadToken] = await Promise.all([
    api<{ host: Host }>("/host/me"),
    getUploadToken(),
  ]);
  const h = hostResult.ok ? hostResult.data?.host : null;
  const myLangs = new Set(h?.languages ?? []);

  return (
    <>
      <PageHeader title="Settings" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      {h ? (
        <Card className="mb-3">
          {/* Telegram-style avatar picker — click circle to open camera/gallery sheet */}
          <AvatarPickerSection
            currentUrl={h.avatar_url}
            name={h.name}
            uploadToken={uploadToken}
          />
          <div className="mt-4 flex items-center justify-between gap-2">
            <CardTitle className="truncate">{h.name}</CardTitle>
            <StatusChip status={h.application_status} />
          </div>
          {h.short_bio ? <CardSubtitle>{h.short_bio}</CardSubtitle> : null}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-col gap-2">
        <Row icon={FileText} title="Verification files" href="/files" />
        <Row icon={CreditCard} title="Payment methods" href="/payment-methods" />
        <Row icon={Bell} title="Notifications" href="/notifications" />
      </div>

      <Card className="mb-3">
        <CardTitle className="mb-3">Profile</CardTitle>
        <form action={updateProfileAction} className="flex flex-col gap-3">
          <Input label="Country" name="country" defaultValue={h?.country ?? ""} />
          <Input label="Phone" name="phone" type="tel" defaultValue={h?.phone ?? ""} />
          <div>
            <div className="mb-1.5 ml-1 text-xs font-medium text-[var(--color-q4w-muted)]">Languages</div>
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
          <Input label="Tagline" name="short_bio" defaultValue={h?.short_bio ?? ""} maxLength={280} />
          <Textarea label="About you" name="bio" defaultValue={h?.bio ?? ""} maxLength={2000} />
          <div className="text-xs font-medium text-[var(--color-q4w-muted)]">Social profiles</div>
          <Input name="instagram_url" defaultValue={h?.instagram_url ?? ""} placeholder="https://instagram.com/…" />
          <Input name="telegram_url" defaultValue={h?.telegram_url ?? ""} placeholder="https://t.me/…" />
          <Input name="youtube_url" defaultValue={h?.youtube_url ?? ""} placeholder="https://youtube.com/@…" />
          <Input name="tiktok_url" defaultValue={h?.tiktok_url ?? ""} placeholder="https://tiktok.com/@…" />
          <Input name="twitter_url" defaultValue={h?.twitter_url ?? ""} placeholder="https://x.com/…" />
          <Input name="website_url" defaultValue={h?.website_url ?? ""} placeholder="https://yoursite.com" />
          <Button type="submit">Save changes</Button>
        </form>
      </Card>

      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </form>
    </>
  );
}

function Row({ icon: Icon, title, href }: { icon: React.ComponentType<{ className?: string }>; title: string; href: string }) {
  return (
    <Link href={href} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
      <Icon className="h-4 w-4 text-[var(--color-q4w-primary)]" />
      <div className="flex-1 text-sm">{title}</div>
      <ChevronRight className="h-4 w-4 text-[var(--color-q4w-muted)]" />
    </Link>
  );
}
