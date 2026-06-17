import Link from "next/link";
import { UserPen, Share2, FileText, CreditCard, Bell, LogOut, ChevronRight } from "lucide-react";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { signOutAction, getUploadToken } from "./actions";
import { AvatarPickerSection } from "./avatar-picker";

export const metadata = { title: "Profile — Quiz4Win Host" };

interface Host {
  name: string; short_bio: string | null;
  application_status: string; avatar_url: string | null;
}

export default async function SettingsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const [hostResult, uploadToken] = await Promise.all([
    api<{ host: Host }>("/host/me"),
    getUploadToken(),
  ]);
  const h = hostResult.ok ? hostResult.data?.host : null;

  return (
    <>
      <PageHeader title="Profile" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      {h ? (
        <Card className="mb-5">
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

      <SectionLabel>Account</SectionLabel>
      <div className="mb-5 flex flex-col gap-2">
        <Row icon={UserPen} title="Edit profile" subtitle="Country, phone, languages & bio" href="/settings/profile" />
        <Row icon={Share2} title="Social profiles" subtitle="Instagram, TikTok, YouTube & more" href="/settings/social" />
      </div>

      <SectionLabel>Verification & payouts</SectionLabel>
      <div className="mb-5 flex flex-col gap-2">
        <Row icon={FileText} title="Verification files" subtitle="ID, selfie & intro video" href="/files" />
        <Row icon={CreditCard} title="Payout wallets" subtitle="Where we send your earnings" href="/payment-methods" />
      </div>

      <SectionLabel>General</SectionLabel>
      <div className="mb-6 flex flex-col gap-2">
        <Row icon={Bell} title="Notifications" subtitle="Updates about your shows & payouts" href="/notifications" />
      </div>

      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </form>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 px-1 text-[11px] uppercase tracking-widest text-white/40">{children}</div>;
}

function Row({ icon: Icon, title, subtitle, href }: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string; href: string;
}) {
  return (
    <Link href={href} className="glass flex items-center gap-3 rounded-2xl px-4 py-3 transition active:scale-[0.99]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
        <Icon className="h-4 w-4 text-[var(--color-q4w-primary)]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {subtitle ? <div className="truncate text-[11px] text-[var(--color-q4w-muted)]">{subtitle}</div> : null}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-q4w-muted)]" />
    </Link>
  );
}
