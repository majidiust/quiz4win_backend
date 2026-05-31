import Link from "next/link";
import { CalendarClock, Power, Bot, Gamepad2, History as HistoryIcon, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchInput } from "@/components/search-input";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber, formatRelative } from "@/lib/utils";
import { nextCronRun } from "@/lib/cron";
import { CreateTemplateDialog } from "./create-template-dialog";

export const metadata = { title: "Game Templates" };
const PAGE_SIZE = 25;
const MODES = ["live", "timed", "battle", "daily", "tournament"] as const;

interface SearchParams { active?: string; mode?: string; ai?: string; q?: string; page?: string }

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("game_templates")
    .select(
      "id, name, mode, language, cron_expression, cron_description, entry_fee, prize_pool, prize_pool_currency, is_active, ai_enabled, total_games_generated, last_generated_at, created_at",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.active === "true") q = q.eq("is_active", true);
  if (sp.active === "false") q = q.eq("is_active", false);
  if (sp.mode) q = q.eq("mode", sp.mode);
  if (sp.ai === "true") q = q.eq("ai_enabled", true);
  if (sp.ai === "false") q = q.eq("ai_enabled", false);
  if (sp.q) {
    const safe = sp.q.replace(/[%_]/g, "").trim();
    if (safe) q = q.ilike("name", `%${safe}%`);
  }

  // Run summary aggregates in parallel — they ignore the current filter
  // intentionally so the KPI strip always reflects the entire population.
  const [{ data, count, error }, totalsRes, activeRes, aiRes, generatedRes] = await Promise.all([
    q,
    db.from("game_templates").select("id", { count: "exact", head: true }).is("deleted_at", null),
    db.from("game_templates").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true),
    db.from("game_templates").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("ai_enabled", true),
    db.from("game_templates").select("total_games_generated").is("deleted_at", null),
  ]);
  if (error) throw error;

  const totalTemplates = totalsRes.count ?? 0;
  const activeTemplates = activeRes.count ?? 0;
  const aiTemplates = aiRes.count ?? 0;
  const totalGenerated = (generatedRes.data ?? []).reduce(
    (sum, r: { total_games_generated: number | null }) => sum + (r.total_games_generated ?? 0),
    0,
  );

  const buildHref = (overrides: Partial<SearchParams>) => {
    const merged: SearchParams = { ...sp, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== "" && k !== "page") params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/templates?${qs}` : "/templates";
  };

  const filterActive = !!(sp.active || sp.mode || sp.ai || sp.q);

  return (
    <>
      <PageHeader
        title="Game Templates"
        description="Recurring game configurations. Each active template spawns a new game on its cron schedule."
        actions={<CreateTemplateDialog />}
      />

      {/* KPI strip — population totals (ignore filters) */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={CalendarClock} label="Templates" value={formatNumber(totalTemplates)} />
        <Kpi icon={Power} label="Active" value={
          <span className="text-success">{formatNumber(activeTemplates)}</span>
        } sub={`${formatNumber(totalTemplates - activeTemplates)} inactive`} />
        <Kpi icon={HistoryIcon} label="Games generated" value={formatNumber(totalGenerated)} />
        <Kpi icon={Sparkles} label="AI-enabled" value={formatNumber(aiTemplates)} sub={
          totalTemplates > 0 ? `${Math.round((aiTemplates / totalTemplates) * 100)}%` : "—"
        } />
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search by name…" paramKey="q" />
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
          <FilterChip href={buildHref({ active: undefined })} active={!sp.active}>All</FilterChip>
          <FilterChip href={buildHref({ active: "true" })} active={sp.active === "true"}>Active</FilterChip>
          <FilterChip href={buildHref({ active: "false" })} active={sp.active === "false"}>Inactive</FilterChip>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Mode</span>
          <FilterChip href={buildHref({ mode: undefined })} active={!sp.mode}>All</FilterChip>
          {MODES.map((m) => (
            <FilterChip key={m} href={buildHref({ mode: m })} active={sp.mode === m}>{m}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI</span>
          <FilterChip href={buildHref({ ai: undefined })} active={!sp.ai}>All</FilterChip>
          <FilterChip href={buildHref({ ai: "true" })} active={sp.ai === "true"}>On</FilterChip>
          <FilterChip href={buildHref({ ai: "false" })} active={sp.ai === "false"}>Off</FilterChip>
        </div>
        {filterActive && (
          <Link href="/templates" className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline">
            Clear filters
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Entry / Pool</TableHead>
                  <TableHead className="text-right">Generated</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => {
                  const next = t.is_active ? nextCronRun(t.cron_expression) : null;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/templates/${t.id}`} className="group hover:underline">
                          <div className="flex items-center gap-1.5 text-sm font-medium group-hover:underline">
                            {t.name}
                            {t.ai_enabled ? <Bot className="size-3 text-primary" /> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">{t.language?.toUpperCase()}</div>
                        </Link>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="capitalize"><Gamepad2 className="mr-1 size-3" />{t.mode}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">
                        {t.cron_expression}
                        {t.cron_description ? (
                          <div className="font-sans text-[10px] text-muted-foreground">{t.cron_description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatMoneyDecimal(t.entry_fee, t.prize_pool_currency)}{" "}
                        <span className="text-muted-foreground">/</span>{" "}
                        <span className="text-success">{formatMoneyDecimal(t.prize_pool, t.prize_pool_currency)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(t.total_games_generated ?? 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.last_generated_at ? formatRelative(t.last_generated_at) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {next ? (
                          <span title={formatDateTime(next.toISOString())} className="tabular-nums">
                            {formatRelative(next.toISOString())}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.is_active ? "success" : "muted"}>
                          {t.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/templates"
              searchParams={{ active: sp.active, mode: sp.mode, ai: sp.ai, q: sp.q }}
            />
          </>
        ) : (
          <EmptyState
            icon={CalendarClock}
            title={filterActive ? "No templates match the current filter" : "No templates yet"}
            description={filterActive ? "Adjust your search or clear filters to see more results." : "Create a template to schedule recurring games."}
          />
        )}
      </Card>
    </>
  );
}

function Kpi({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-2.5 py-0.5 text-xs capitalize transition-colors ${active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </Link>
  );
}
