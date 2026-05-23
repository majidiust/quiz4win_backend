import { UserCog } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatRelative, initials } from "@/lib/utils";
import { InviteAdminDialog, EditAdminButton } from "./admin-user-actions";

export const metadata = { title: "Admin Users" };

export default async function AdminUsersPage() {
  await requireAdmin(["super_admin"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("admin_users")
    .select("id, email, name, role, status, mfa_enabled, last_login_at, last_login_ip, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Admin Users"
        description="Back-office operators with access to this panel."
        actions={<InviteAdminDialog />}
      />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>MFA</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[10px]">{initials(a.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge value={a.role} /></TableCell>
                  <TableCell><StatusBadge value={a.status} /></TableCell>
                  <TableCell>
                    <StatusBadge value={a.mfa_enabled ? "enabled" : "disabled"} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelative(a.last_login_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.last_login_ip ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                  <TableCell>
                    <EditAdminButton
                      adminId={a.id}
                      currentRole={a.role}
                      currentStatus={a.status}
                      currentName={a.name}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={UserCog} title="No admin users found" />
        )}
      </Card>
    </>
  );
}
