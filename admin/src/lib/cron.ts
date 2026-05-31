import { CronExpressionParser } from "cron-parser";

/**
 * Compute the next N occurrences of a cron expression (in UTC).
 * Returns an empty array if the expression is invalid.
 */
export function nextCronRuns(expression: string | null | undefined, count = 3, from?: Date): Date[] {
  if (!expression || !expression.trim()) return [];
  try {
    const it = CronExpressionParser.parse(expression.trim(), {
      currentDate: from ?? new Date(),
      tz: "UTC",
    });
    const out: Date[] = [];
    for (let i = 0; i < count; i++) {
      out.push(it.next().toDate());
    }
    return out;
  } catch {
    return [];
  }
}

/** Compute only the next run (or null if the expression is invalid). */
export function nextCronRun(expression: string | null | undefined, from?: Date): Date | null {
  const runs = nextCronRuns(expression, 1, from);
  return runs[0] ?? null;
}

/** Whether a cron expression is parseable. */
export function isValidCron(expression: string | null | undefined): boolean {
  if (!expression || !expression.trim()) return false;
  try {
    CronExpressionParser.parse(expression.trim(), { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}
