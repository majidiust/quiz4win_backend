import { Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

export const metadata = { title: "App Config" };

export default async function AppConfigPage() {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("app_config")
    .select("key, value, value_type, updated_at")
    .order("key", { ascending: true });
  if (error) throw error;

  return (
    <>
      <PageHeader title="App Config" description="Runtime configuration keys consumed by the mobile clients." />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
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
              {data.map((c) => (
                <TableRow key={c.key}>
                  <TableCell className="font-mono text-xs">{c.key}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">{c.value}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.value_type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(c.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Settings2} title="No configuration keys defined" />
        )}
      </Card>
    </>
  );
}
