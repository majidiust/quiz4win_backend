import { BrainCircuit } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { LlmTemplateDialog, type LlmTemplate } from "./llm-template-dialog";
import { LlmTemplateActions } from "./llm-template-actions";

export const metadata = { title: "LLM Templates" };

interface Row extends LlmTemplate {
  is_active: boolean;
  updated_at: string;
}

export default async function LlmTemplatesPage() {
  await requireAdmin(["super_admin", "admin"]);

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("llm_prompt_templates")
    .select("id, name, description, model, system_prompt, temperature, max_tokens, is_active, updated_at")
    .is("deleted_at", null)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="LLM Templates"
        description="OpenAI prompt/model presets for question generation. The active default is used unless a game template or game overrides it."
        actions={<LlmTemplateDialog />}
      />

      <Card className="overflow-hidden">
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Temp</TableHead>
                <TableHead className="text-right">Max tokens</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{t.name}</div>
                    {t.description ? (
                      <div className="max-w-md truncate text-xs text-muted-foreground">{t.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.model}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(t.temperature).toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.max_tokens}</TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "success" : "muted"}>
                      {t.is_active ? "Default" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(t.updated_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <LlmTemplateDialog template={t} />
                      <LlmTemplateActions id={t.id} isActive={t.is_active} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={BrainCircuit}
            title="No LLM templates yet"
            description="Create a template to customize the question-generation prompt and model. Until then, the orchestrator uses its built-in default."
          />
        )}
      </Card>
    </>
  );
}
