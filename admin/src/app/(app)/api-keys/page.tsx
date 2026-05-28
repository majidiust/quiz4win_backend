import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { CreateApiKeyDialog, RevokeApiKeyButton } from "./api-key-actions";

export const metadata = { title: "API Keys" };

interface ApiKeyRow {
  id: string;
  key_id: string;
  secret_hint: string;
  name: string;
  description: string | null;
  role: string;
  allowed_domains: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

function statusOf(k: ApiKeyRow): "active" | "revoked" | "expired" {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

export default async function ApiKeysPage() {
  await requireAdmin(["super_admin"]);
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("api_keys")
    .select(
      "id, key_id, secret_hint, name, description, role, allowed_domains, expires_at, revoked_at, last_used_at, last_used_ip, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  const keys = (data ?? []) as ApiKeyRow[];

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Long-lived keys for server-to-server access to admin Edge Functions. Send them in the X-API-Key header as key_id.secret."
        actions={<CreateApiKeyDialog />}
      />

      <Card className="overflow-hidden">
        {keys.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const status = statusOf(k);
                return (
                  <TableRow key={k.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{k.name}</div>
                        {k.description ? (
                          <div className="truncate text-xs text-muted-foreground">{k.description}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">
                        {k.key_id}<span className="text-muted-foreground">.…{k.secret_hint}</span>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge value={k.role} /></TableCell>
                    <TableCell><StatusBadge value={status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.allowed_domains && k.allowed_domains.length > 0
                        ? k.allowed_domains.join(", ")
                        : "any"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.expires_at ? formatDateTime(k.expires_at) : "never"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.last_used_at ? (
                        <>
                          {formatRelative(k.last_used_at)}
                          {k.last_used_ip ? <span className="ml-1 font-mono">({k.last_used_ip})</span> : null}
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(k.created_at)}
                    </TableCell>
                    <TableCell>
                      {status === "active" ? (
                        <RevokeApiKeyButton id={k.id} name={k.name} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to grant a service account programmatic access."
          />
        )}
      </Card>
    </>
  );
}
