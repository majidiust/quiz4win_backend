import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import { deleteFileAction } from "./actions";
import { FilePreview } from "./file-preview";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Verification files — Quiz4Win Host" };

interface UploadedFile {
  id: string; file_type: string; url: string; mime_type: string;
  file_size_bytes?: number | null; status: string; rejection_reason?: string | null;
  created_at: string;
}

export default async function FilesPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const r = await api<{ files: UploadedFile[] }>("/host/me/files");
  const files = r.ok ? r.data?.files ?? [] : [];

  return (
    <>
      <PageHeader title="Verification files" subtitle="Documents and intro media" back="/settings" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      <Card className="mb-4">
        <CardTitle className="mb-3">Upload a new file</CardTitle>
        <UploadForm />
      </Card>

      <div className="flex flex-col gap-3">
        {files.length === 0 ? (
          <Card><CardSubtitle>No files uploaded yet.</CardSubtitle></Card>
        ) : files.map((f) => (
          <Card key={f.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="capitalize">{f.file_type.replaceAll("_", " ")}</CardTitle>
                <div className="mt-0.5 text-[11px] text-[var(--color-q4w-muted)]">
                  {f.mime_type} · {formatRelative(f.created_at)}
                </div>
                {f.rejection_reason ? (
                  <div className="mt-2 text-xs text-rose-300">Rejected: {f.rejection_reason}</div>
                ) : null}
              </div>
              <StatusChip status={f.status} />
            </div>
            <div className="mt-3 flex gap-2">
              <FilePreview fileId={f.id} mime={f.mime_type} label={f.file_type.replaceAll("_", " ")} />
              {f.status === "pending" ? (
                <form action={deleteFileAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="text-xs text-rose-300">Delete</button>
                </form>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
