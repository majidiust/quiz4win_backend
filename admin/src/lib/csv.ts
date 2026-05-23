/**
 * CSV helpers for the Quiz4Win admin panel (server-only).
 *
 * Mirrors supabase/functions/_shared/csv.ts so both surfaces (Edge Functions
 * for external API consumers and the admin route-handlers used by the UI)
 * emit identical, RFC-4180 compliant CSV.
 *
 * Rule compliance:
 *  - R-01: callers must exclude secret/PII columns they don't intend to export
 *  - R-02: monetary fields are emitted as raw integer cents unless the
 *          column expressly maps to a decimal value
 */

import "server-only";

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

function quote(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => quote(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => quote(c.value(r))).join(",")).join("\r\n");
  return body ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}
