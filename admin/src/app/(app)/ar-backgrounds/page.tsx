import { Image } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative, formatDateTime } from "@/lib/utils";
import { UploadARBackgroundDialog, ToggleARBackgroundButton, DeleteARBackgroundButton } from "./ar-background-actions";

export const metadata = { title: "AR Backgrounds" };

interface BgRow {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  admin_users: { name: string; email: string } | null;
}

export default async function ARBackgroundsPage() {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("ar_backgrounds")
    .select("id, name, url, is_active, sort_order, created_at, admin_users!uploaded_by(name, email)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  const backgrounds = (data ?? []) as unknown as BgRow[];
  const activeCnt = backgrounds.filter((b) => b.is_active).length;

  return (
    <>
      <PageHeader
        title="AR Backgrounds"
        description="Manage background images available to hosts during live streams."
        actions={<UploadARBackgroundDialog />}
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Card className="flex items-center gap-3 p-4">
          <Image className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums">{backgrounds.length}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <div>
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-lg font-semibold tabular-nums">{activeCnt}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <div className="h-2 w-2 rounded-full bg-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Inactive</p>
            <p className="text-lg font-semibold tabular-nums">{backgrounds.length - activeCnt}</p>
          </div>
        </Card>
      </div>

      <Card>
        {backgrounds.length === 0 ? (
          <EmptyState icon={Image} title="No backgrounds yet" description="Upload your first AR background to get started." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preview</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backgrounds.map((b) => (
                <TableRow key={b.id} className={b.is_active ? "" : "opacity-50"}>
                  <TableCell>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.url} alt={b.name} className="h-12 w-20 rounded object-cover" />
                  </TableCell>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="tabular-nums text-sm text-muted-foreground">{b.sort_order}</TableCell>
                  <TableCell>
                    <Badge variant={b.is_active ? "success" : "muted"}>
                      {b.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" title={formatDateTime(b.created_at)}>
                    {formatRelative(b.created_at)}
                    {b.admin_users && <span className="block">{b.admin_users.name}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <ToggleARBackgroundButton id={b.id} isActive={b.is_active} />
                      <DeleteARBackgroundButton id={b.id} name={b.name} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
