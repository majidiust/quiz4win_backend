import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal } from "@/lib/utils";
import { CreateTemplateDialog } from "./create-template-dialog";

export const metadata = { title: "Game Templates" };
const PAGE_SIZE = 25;
interface SearchParams { active?: string; page?: string }

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

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Game Templates"
        description="Recurring game configurations. Each active template spawns a new game on its cron schedule."
        actions={<CreateTemplateDialog />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/templates"
          className={`rounded-md border px-3 py-1 text-xs ${!sp.active ? "bg-muted" : "text-muted-foreground"}`}
        >
          All
        </Link>
        <Link
          href="/templates?active=true"
          className={`rounded-md border px-3 py-1 text-xs ${sp.active === "true" ? "bg-muted" : "text-muted-foreground"}`}
        >
          Active
        </Link>
        <Link
          href="/templates?active=false"
          className={`rounded-md border px-3 py-1 text-xs ${sp.active === "false" ? "bg-muted" : "text-muted-foreground"}`}
        >
          Inactive
        </Link>
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/templates/${t.id}`} className="group hover:underline">
                        <div className="text-sm font-medium group-hover:underline">{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.language?.toUpperCase()}
                          {t.ai_enabled ? <span className="ml-1 text-primary">· AI</span> : null}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{t.mode}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.cron_expression}
                      {t.cron_description ? (
                        <div className="text-[10px] text-muted-foreground">{t.cron_description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatMoneyDecimal(t.entry_fee)} <span className="text-muted-foreground">/</span>{" "}
                      <span className="text-success">{formatMoneyDecimal(t.prize_pool)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.total_games_generated ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.last_generated_at) ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={t.is_active ? "default" : "outline"}>
                        {t.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/templates"
              searchParams={{ active: sp.active }}
            />
          </>
        ) : (
          <EmptyState icon={CalendarClock} title="No templates yet" description="Create a template to schedule recurring games." />
        )}
      </Card>
    </>
  );
}
