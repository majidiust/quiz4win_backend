/**
 * Quiz4Win — Game Template Generator
 *
 * A long-running Deno process that wakes every minute and calls the
 * Postgres RPC `generate_games_from_active_templates`. The RPC evaluates
 * every active, non-deleted template against its cron expression and
 * spawns new games for matching templates (respecting overlap +
 * recently-generated dedup guards).
 *
 * Why a dedicated service and not pg_cron?
 *   * Easier to deploy / restart / inspect logs.
 *   * Works against any Postgres (managed or not) without enabling
 *     extensions.
 *   * The same loop can later publish RabbitMQ commands at game start
 *     for AI presenter games (see Phase 4 wiring).
 *
 * Env vars (sourced from the project-root .env via docker-compose):
 *   SUPABASE_URL                  — REST endpoint of the Supabase project.
 *   SUPABASE_SERVICE_ROLE_KEY     — Service-role JWT used to call the RPC.
 *   TEMPLATE_GEN_INTERVAL_MS      — Override the 60 000ms default (optional).
 *
 * Rule compliance:
 *   R-01  Secrets are read from env only, never logged.
 *   R-03  N/A (server-to-server, JWT == service-role).
 *   R-04  Uses SECURITY DEFINER RPC; never touches RLS tables directly.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERVAL_MS = Number(Deno.env.get("TEMPLATE_GEN_INTERVAL_MS") ?? 60_000);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("[template-generator] FATAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  Deno.exit(1);
}

const RPC_URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/generate_games_from_active_templates`;

interface TickEntry {
  template_id: string;
  name: string;
  status: "generated" | "no_match" | "skipped_recent" | "overlap_skipped" | "error";
  game_id?: string;
  error?: string;
}

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY!,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: "{}",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no-body>");
      console.error(`[template-generator] tick HTTP ${res.status}: ${text.slice(0, 500)}`);
      return;
    }

    const entries = (await res.json()) as TickEntry[] | null;
    if (!Array.isArray(entries) || entries.length === 0) {
      console.log(`[template-generator] tick ok — no active templates (${Date.now() - startedAt}ms)`);
      return;
    }

    const summary: Record<string, number> = {};
    for (const e of entries) summary[e.status] = (summary[e.status] ?? 0) + 1;
    console.log(
      `[template-generator] tick ok — ${entries.length} templates evaluated, ` +
      `summary=${JSON.stringify(summary)} (${Date.now() - startedAt}ms)`,
    );

    // Log generated games + errors explicitly (recent_skipped / no_match are routine).
    for (const e of entries) {
      if (e.status === "generated") {
        console.log(`[template-generator]   GENERATED template=${e.name} (${e.template_id}) game=${e.game_id}`);
      } else if (e.status === "error") {
        console.error(`[template-generator]   ERROR template=${e.name} (${e.template_id}): ${e.error}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[template-generator] tick FAILED: ${msg}`);
  }
}

// Graceful shutdown
let shuttingDown = false;
const shutdown = (sig: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[template-generator] received ${sig}, shutting down…`);
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[template-generator] started — interval=${INTERVAL_MS}ms supabase_url=${new URL(SUPABASE_URL).host}`,
);

// Run immediately on boot, then on the interval. Misaligned-by-a-few-seconds
// is fine; the dedup guard in the RPC prevents double-generation.
await tick();
setInterval(tick, INTERVAL_MS);

// Keep the process alive (setInterval alone is enough but make it explicit).
await new Promise(() => {});
