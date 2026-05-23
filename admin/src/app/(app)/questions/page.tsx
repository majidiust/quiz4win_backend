import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { SearchInput } from "@/components/search-input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatNumber } from "@/lib/utils";
import { CreateQuestionDialog, BulkImportDialog } from "./create-question-dialog";

export const metadata = { title: "Questions" };
const PAGE_SIZE = 25;

interface SearchParams {
  q?: string;
  category?: string;
  difficulty?: string;
  language?: string;
  page?: string;
}

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("questions")
    .select("id, text, category, difficulty, language, used_count, active, created_at", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.q) q = q.ilike("text", `%${sp.q}%`);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.difficulty) q = q.eq("difficulty", sp.difficulty);
  if (sp.language) q = q.eq("language", sp.language);

  const { data, count, error } = await q;
  if (error) throw error;

  const difficulties = ["Easy", "Medium", "Hard"];
  const langs = ["en", "ar", "fa", "tr"];

  return (
    <>
      <PageHeader
        title="Questions"
        description="Question bank powering all quiz games."
        actions={
          <div className="flex items-center gap-2">
            <BulkImportDialog />
            <CreateQuestionDialog />
          </div>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <SearchInput placeholder="Search question text…" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {difficulties.map((d) => (
              <Link
                key={d}
                href={`/questions?difficulty=${d}`}
                className={`rounded border px-2 py-0.5 ${sp.difficulty === d ? "bg-muted" : "text-muted-foreground"}`}
              >
                {d}
              </Link>
            ))}
            {langs.map((l) => (
              <Link
                key={l}
                href={`/questions?language=${l}`}
                className={`rounded border px-2 py-0.5 uppercase ${sp.language === l ? "bg-muted" : "text-muted-foreground"}`}
              >
                {l}
              </Link>
            ))}
          </div>
        </div>

        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Lang</TableHead>
                  <TableHead className="text-right">Uses</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="max-w-xl truncate text-sm">
                      <Link href={`/questions/${q.id}`} className="hover:underline">{q.text}</Link>
                    </TableCell>
                    <TableCell className="text-xs">{q.category}</TableCell>
                    <TableCell><StatusBadge value={q.difficulty} /></TableCell>
                    <TableCell className="text-xs uppercase">{q.language}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(q.used_count)}</TableCell>
                    <TableCell><StatusBadge value={q.active ? "active" : "inactive"} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/questions"
              searchParams={{ q: sp.q, category: sp.category, difficulty: sp.difficulty, language: sp.language }}
            />
          </>
        ) : (
          <EmptyState icon={BookOpen} title="No questions match these filters" />
        )}
      </Card>
    </>
  );
}
