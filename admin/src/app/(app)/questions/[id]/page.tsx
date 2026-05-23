import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { QuestionEditForm } from "./question-edit-form";

export const metadata = { title: "Question detail" };

export default async function QuestionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: question, error } = await db
    .from("questions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !question) notFound();

  const options = Array.isArray(question.options) ? question.options as string[] : [];

  return (
    <>
      <PageHeader
        title="Question detail"
        description={question.category}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/questions"><ArrowLeft className="size-4" /> All questions</Link>
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Metadata</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Category">{question.category}</Row>
            <Row label="Difficulty"><StatusBadge value={question.difficulty} /></Row>
            <Row label="Language"><span className="uppercase">{question.language}</span></Row>
            <Row label="Status"><StatusBadge value={question.active ? "active" : "inactive"} /></Row>
            <Row label="Used">{formatNumber(question.used_count)} times</Row>
            <Row label="Created">{formatDateTime(question.created_at)}</Row>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Question & answers</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-medium leading-relaxed">{question.text}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {options.map((opt, i) => (
                <div
                  key={i}
                  className={`rounded-md border px-3 py-2 text-sm ${i === question.correct_index ? "border-success bg-success/10 font-semibold text-success" : "text-muted-foreground"}`}
                >
                  <span className="mr-2 text-xs font-bold uppercase">{["A", "B", "C", "D"][i]}.</span>
                  {opt}
                </div>
              ))}
            </div>
            {question.explanation ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <div className="mb-1 font-medium">Explanation</div>
                <p className="text-muted-foreground">{question.explanation}</p>
              </div>
            ) : null}
            {question.media_url ? (
              <div className="text-xs text-muted-foreground">Media: <a href={question.media_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{question.media_url}</a></div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Edit question</CardTitle></CardHeader>
          <CardContent>
            <QuestionEditForm question={question} options={options} />
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
