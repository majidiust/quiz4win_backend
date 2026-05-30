import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { EditTemplateForm } from "./edit-template-form";

export const metadata = { title: "Edit template" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: tpl, error } = await db
    .from("game_templates")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !tpl) notFound();

  return <EditTemplateForm templateId={id} template={tpl} />;
}
