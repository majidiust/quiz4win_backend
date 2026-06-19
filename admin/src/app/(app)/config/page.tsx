import { Settings2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { ConfigValueCell, MaintenanceModeToggle, HostApplicationsToggle, MonetizationModeControl, ReferralBonusControl } from "./config-actions";

export const metadata = { title: "App Config" };

// Keys that have a dedicated control above. They are hidden from the raw
// key/value table so each setting has exactly one editor — editing them as
// free text would bypass validation and cause conflicting state.
const MANAGED_KEYS = new Set([
  "monetization_mode",
  "coin_usd_rate_micros",
  "coin_name",
  "coin_symbol",
  "feature_host_applications",
  "maintenance_mode",
  "maintenance_message",
  "referral_referrer_bonus_usd",
  "referral_referee_bonus_usd",
  "referral_eligibility_days",
  "feature_user_vouchers",
]);

export default async function AppConfigPage() {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("app_config")
    .select("key, value, value_type, updated_at")
    .order("key", { ascending: true });
  if (error) throw error;

  const valueOf = (key: string) => data?.find((c) => c.key === key)?.value;

  const maintenanceEnabled = valueOf("maintenance_mode") === "true";
  const hostAppsEnabled = valueOf("feature_host_applications") !== "false"; // default open when row missing

  const monMode = (valueOf("monetization_mode") ?? "usd") as "none" | "coin" | "usd";
  const monRateMicros = parseInt(valueOf("coin_usd_rate_micros") ?? "10000", 10) || 10000;
  const monCoinName = valueOf("coin_name") ?? "Coins";
  const monCoinSymbol = valueOf("coin_symbol") ?? "C";

  const referrerBonus    = parseFloat(valueOf("referral_referrer_bonus_usd") ?? "10.00") || 10;
  const refereeBonus     = parseFloat(valueOf("referral_referee_bonus_usd")  ?? "5.00")  || 5;
  const eligibilityDays  = parseInt(valueOf("referral_eligibility_days") ?? "30", 10) || 30;

  // Only keys without a dedicated control are shown in the advanced table.
  const otherRows = (data ?? []).filter((c) => !MANAGED_KEYS.has(c.key));

  return (
    <>
      <PageHeader title="App Config" description="Runtime configuration consumed by the mobile clients." />

      <section className="space-y-2 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground">Feature controls</h2>
        <MonetizationModeControl
          key={`mon-${monMode}-${monRateMicros}-${monCoinName}-${monCoinSymbol}`}
          mode={monMode}
          coinName={monCoinName}
          coinSymbol={monCoinSymbol}
          rateMicros={monRateMicros}
        />
        <HostApplicationsToggle key={`host-${hostAppsEnabled}`} enabled={hostAppsEnabled} />
        <ReferralBonusControl key={`ref-${referrerBonus}-${refereeBonus}-${eligibilityDays}`} referrerBonus={referrerBonus} refereeBonus={refereeBonus} eligibilityDays={eligibilityDays} />
        <MaintenanceModeToggle key={`maint-${maintenanceEnabled}`} enabled={maintenanceEnabled} />
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-sm">Other configuration keys</CardTitle>
          <CardDescription className="text-xs">
            Advanced runtime keys. The settings above (monetization, host applications, maintenance) are
            managed by their dedicated controls and are intentionally hidden here to prevent conflicting edits.
          </CardDescription>
        </CardHeader>
        {otherRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {otherRows.map((c) => (
                <TableRow key={c.key}>
                  <TableCell className="font-mono text-xs">{c.key}</TableCell>
                  <TableCell>
                    <ConfigValueCell configKey={c.key} value={c.value ?? ""} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.value_type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(c.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Settings2} title="No other configuration keys" />
        )}
      </Card>
    </>
  );
}
