import { Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

export const metadata = { title: "Live Shows" };

export default async function ShowsPage() {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("show_hosts")
    .select("id, name, bio, avatar_url, shows_hosted, avg_rating, status")
    .order("shows_hosted", { ascending: false });
  if (error) throw error;

  return (
    <>
      <PageHeader title="Show Hosts" description="Talent roster, performance and availability." />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead>Bio</TableHead>
                <TableHead className="text-right">Shows hosted</TableHead>
                <TableHead className="text-right">Avg rating</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-8">
                        {h.avatar_url ? <AvatarImage src={h.avatar_url} alt={h.name} /> : null}
                        <AvatarFallback className="text-[10px]">{initials(h.name)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{h.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs text-muted-foreground">{h.bio ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.shows_hosted}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.avg_rating ?? "—"}</TableCell>
                  <TableCell><StatusBadge value={h.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Radio} title="No show hosts yet" description="Hosts will appear here once added." />
        )}
      </Card>
    </>
  );
}
