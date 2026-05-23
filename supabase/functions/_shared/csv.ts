/**
 * CSV export helpers for Quiz4Win admin Edge Functions.
 *
 * - Renders rows + column spec as RFC-4180 compliant CSV
 * - Quotes any field containing comma, quote, CR/LF
 * - Returns a text/csv response with Content-Disposition: attachment
 *
 * Rule compliance:
 *  - R-01: callers MUST exclude secret/PII columns before passing rows here
 *  - R-02: monetary values must be pre-formatted by caller (cents → decimal)
 */

import { corsHeaders } from "./cors.ts";

export type CsvColumn<T> = {
  /** Column header in the rendered CSV */
  header: string;
  /** Extractor returning a primitive (string/number/boolean/null) */
  value: (row: T) => string | number | boolean | null | undefined;
};

/** RFC-4180 quote a single CSV field. */
function quote(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Render an array of rows as a CSV string using the supplied column spec.
 * Always emits a header line.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => quote(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => quote(c.value(r))).join(","))
    .join("\r\n");
  return body ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

/** Build a downloadable text/csv response. */
export function csvResponse(csv: string, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

/** Convenience: ISO date in yyyymmdd for filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}
