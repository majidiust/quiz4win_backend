import { Music2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative, formatDateTime } from "@/lib/utils";
import { SOUND_USAGES, type SoundUsage } from "@/lib/actions/sounds";
import {
  UploadSoundDialog, EditSoundDialog,
  ToggleSoundButton, DeleteSoundButton,
} from "./sound-actions";

export const metadata = { title: "Sounds" };

interface SoundRow {
  id: string;
  name: string;
  usage: SoundUsage;
  url: string;
  mime_type: string;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  is_active: boolean;
  created_at: string;
  admin_users: { name: string; email: string } | null;
}

function usageLabel(value: SoundUsage): string {
  return SOUND_USAGES.find((u) => u.value === value)?.label ?? value;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function SoundsPage() {
  await requireAdmin(["super_admin", "admin"]);
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("app_sounds")
    .select("id, name, usage, url, mime_type, file_size_bytes, duration_seconds, is_active, created_at, admin_users!uploaded_by(name, email)")
    .order("usage", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  const sounds = (data ?? []) as unknown as SoundRow[];

  const activeCnt = sounds.filter((s) => s.is_active).length;

  return (
    <>
      <PageHeader
        title="Sounds"
        description="Manage in-app audio assets. Each sound is assigned a usage slot that the mobile app maps to a UI event."
        actions={<UploadSoundDialog />}
      />

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Card className="flex items-center gap-3 p-4">
          <Music2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums">{sounds.length}</p>
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
            <p className="text-lg font-semibold tabular-nums">{sounds.length - activeCnt}</p>
          </div>
        </Card>
      </div>

      <Card>
        {sounds.length === 0 ? (
          <EmptyState icon={Music2} title="No sounds yet" description="Upload your first sound to get started." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sounds.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="whitespace-nowrap">
                      {usageLabel(s.usage)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {/* Native HTML5 audio player — no JS bundle overhead */}
                    <audio
                      controls
                      preload="none"
                      src={s.url}
                      className="h-8 w-48 min-w-[12rem]"
                    />
                  </TableCell>
                  <TableCell className="tabular-nums text-sm text-muted-foreground">
                    {formatBytes(s.file_size_bytes)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.is_active ? "success" : "muted"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" title={formatDateTime(s.created_at)}>
                    {formatRelative(s.created_at)}
                    {s.admin_users && (
                      <span className="block">{s.admin_users.name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <EditSoundDialog id={s.id} name={s.name} usage={s.usage} />
                      <ToggleSoundButton id={s.id} isActive={s.is_active} />
                      <DeleteSoundButton id={s.id} name={s.name} />
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
