/**
 * Quiz4Win — Game Template Generator + Game Scheduler
 *
 * Two responsibilities per tick (every 60 seconds):
 *
 *   1. Template generation (original role)
 *      Calls `generate_games_from_active_templates()` RPC to spawn games
 *      from active cron-scheduled templates.
 *
 *   2. Game scheduler (§3.1 — Game Scheduler)
 *      Finds games with status=upcoming and scheduled_at <= NOW(), then
 *      publishes a `StartGame` command to RabbitMQ so the Game Orchestrator
 *      picks it up and initialises the Redis session + question loop.
 *
 * Env vars (R-01: secrets from env only, never logged):
 *   SUPABASE_URL                — Supabase REST endpoint.
 *   SUPABASE_SERVICE_ROLE_KEY   — Service-role JWT.
 *   TEMPLATE_GEN_INTERVAL_MS    — Loop interval (default 60 000 ms).
 *   RABBITMQ_URL                — AMQP URI; leave empty to skip publishing.
 *   RABBITMQ_VHOST              — Optional vhost override.
 *   MQ_COMMAND_EXCHANGE         — Exchange name (default = "").
 *   MQ_ORCHESTRATOR_QUEUE       — Routing key (default = "quiz.game.commands").
 *   FCM_SERVICE_ACCOUNT_PATH    — Path to Firebase service-account JSON
 *                                 (optional; default in fcm.ts).
 */

import { isFcmConfigured, sendFcmToTokens } from "./fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERVAL_MS = Number(Deno.env.get("TEMPLATE_GEN_INTERVAL_MS") ?? 60_000);
const RABBITMQ_URL = Deno.env.get("RABBITMQ_URL") ?? "";
const RABBITMQ_VHOST_OVERRIDE = Deno.env.get("RABBITMQ_VHOST");
const MQ_EXCHANGE = Deno.env.get("MQ_COMMAND_EXCHANGE") ?? "";
const MQ_ORCHESTRATOR_QUEUE = Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands";

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

// ─── Game Scheduler (§3.1) ────────────────────────────────────────────────────
// Finds games whose scheduled_at has arrived and publishes StartGame to MQ.

function parseRabbitMgmtUrl(raw: string): { url:string; user:string; pass:string; vhost:string } | null {
  if (!raw) return null;
  let normalised: string;
  let scheme: string;
  if (raw.startsWith("amqps://")) { scheme = "https"; normalised = "https://" + raw.slice(8); }
  else if (raw.startsWith("amqp://")) { scheme = "http"; normalised = "http://" + raw.slice(7); }
  else if (raw.startsWith("http://") || raw.startsWith("https://")) { scheme = raw.split(":")[0]; normalised = raw; }
  else return null;
  try {
    const u = new URL(normalised);
    const isAmqp = raw.startsWith("amqp");
    const hostPart = isAmqp ? u.hostname : u.host;
    const vhostPath = u.pathname && u.pathname !== "/" ? decodeURIComponent(u.pathname.slice(1)) : "/";
    return {
      url: `${scheme}://${hostPart}`,
      user: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password),
      vhost: RABBITMQ_VHOST_OVERRIDE || vhostPath,
    };
  } catch { return null; }
}

async function publishStartGame(gameId: string, gameTitle: string): Promise<void> {
  const cfg = parseRabbitMgmtUrl(RABBITMQ_URL);
  if (!cfg?.url) return; // RabbitMQ not configured — skip silently
  const vhostEnc = encodeURIComponent(cfg.vhost);
  const exchangeEnc = encodeURIComponent(MQ_EXCHANGE);
  const endpoint = `${cfg.url}/api/exchanges/${vhostEnc}/${exchangeEnc}/publish`;
  const payload = {
    type: "StartGame",
    gameId,
    gameTitle,
    correlationId: crypto.randomUUID(),
    publishedAt: new Date().toISOString(),
  };
  const body = {
    properties: { content_type: "application/json", delivery_mode: 2 },
    routing_key: MQ_ORCHESTRATOR_QUEUE,
    payload: JSON.stringify(payload),
    payload_encoding: "string",
  };
  const auth = "Basic " + btoa(`${cfg.user}:${cfg.pass}`);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[scheduler] publishStartGame HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } else {
      console.log(`[scheduler] published StartGame gameId=${gameId}`);
    }
  } catch (err) {
    console.error("[scheduler] publishStartGame failed:", err instanceof Error ? err.message : err);
  }
}

async function schedulerTick(): Promise<void> {
  if (!RABBITMQ_URL) return; // nothing to do without MQ
  try {
    const now = new Date().toISOString();
    const res = await fetch(
      `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/games` +
      `?status=eq.upcoming&scheduled_at=lte.${encodeURIComponent(now)}&select=id,title`,
      {
        headers: {
          "apikey": SERVICE_ROLE_KEY!,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Accept": "application/json",
        },
      },
    );
    if (!res.ok) return;
    const games = await res.json() as Array<{ id: string; title: string }>;
    if (!games.length) return;
    console.log(`[scheduler] ${games.length} game(s) ready to start`);
    for (const g of games) {
      // Atomically flip status to 'open' so we don't double-publish
      const patchRes = await fetch(
        `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/games?id=eq.${g.id}&status=eq.upcoming`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": SERVICE_ROLE_KEY!,
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ status: "open" }),
        },
      );
      if (!patchRes.ok) {
        console.warn(`[scheduler] failed to flip game ${g.id} to open`);
        continue;
      }
      await publishStartGame(g.id, g.title);
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Start-reminder tick ──────────────────────────────────────────────────────
// Sends FCM "game starts in X" pushes at three windows (60m / 10m / 1m).
// Each window is fired at most once per game via reminder_*_sent_at columns
// added by migration 20260531180000_games_start_reminders.sql.
//
// Notification payload carries: game_id, game_title, prize_pool, accent_color,
// glow_color, gradient_colors, minutes_until_start, scheduled_at.

interface ReminderGame {
  id: string;
  title: string;
  prize_pool: string;     // numeric → string in PostgREST JSON
  accent_color: string | null;
  glow_color: string | null;
  gradient_colors: string[] | null;
  scheduled_at: string;
}

interface ReminderWindow {
  minutes: 60 | 10 | 1;
  column: "reminder_60m_sent_at" | "reminder_10m_sent_at" | "reminder_1m_sent_at";
  bodyKey: string;
}

const REMINDER_WINDOWS: ReminderWindow[] = [
  { minutes: 60, column: "reminder_60m_sent_at", bodyKey: "in 1 hour" },
  { minutes: 10, column: "reminder_10m_sent_at", bodyKey: "in 10 minutes" },
  { minutes:  1, column: "reminder_1m_sent_at",  bodyKey: "in 1 minute" },
];

const REST = `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1`;
const restHeaders = (extra: Record<string, string> = {}) => ({
  "apikey": SERVICE_ROLE_KEY!,
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "Accept": "application/json",
  ...extra,
});

let _cachedTokens: { at: number; rows: Array<{ user_id: string; token: string; platform: string }> } | null = null;
const TOKEN_CACHE_TTL_MS = 60_000;

async function fetchEligibleTokens(): Promise<Array<{ user_id: string; token: string; platform: string }>> {
  if (_cachedTokens && Date.now() - _cachedTokens.at < TOKEN_CACHE_TTL_MS) return _cachedTokens.rows;
  const res = await fetch(`${REST}/rpc/get_game_reminder_push_tokens`, {
    method: "POST",
    headers: restHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) {
    console.error(`[reminder] rpc tokens HTTP ${res.status}`);
    return [];
  }
  const rows = await res.json() as Array<{ user_id: string; token: string; platform: string }>;
  _cachedTokens = { at: Date.now(), rows };
  return rows;
}

async function deleteInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const inList = tokens.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",");
  await fetch(`${REST}/push_tokens?token=in.(${encodeURIComponent(inList)})`, {
    method: "DELETE",
    headers: restHeaders({ "Prefer": "return=minimal" }),
  }).catch((e) => console.warn("[reminder] cleanup invalid tokens failed:", e instanceof Error ? e.message : e));
}

async function markReminderSent(gameId: string, column: ReminderWindow["column"]): Promise<boolean> {
  const res = await fetch(`${REST}/games?id=eq.${gameId}&${column}=is.null`, {
    method: "PATCH",
    headers: restHeaders({ "Content-Type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify({ [column]: new Date().toISOString() }),
  });
  return res.ok;
}

async function insertNotificationRows(gameId: string, gameTitle: string, body: string, data: Record<string, string>, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = userIds.map((user_id) => ({
    user_id,
    type: "show_reminder",
    title: gameTitle,
    body,
    sent_via_push: true,
    data,
  }));
  // Chunk to keep request size sane.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await fetch(`${REST}/notifications`, {
      method: "POST",
      headers: restHeaders({ "Content-Type": "application/json", "Prefer": "return=minimal" }),
      body: JSON.stringify(rows.slice(i, i + CHUNK)),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[reminder] insert notifications game=${gameId} HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  }
}

async function processReminderWindow(win: ReminderWindow): Promise<void> {
  const now = Date.now();
  const upper = new Date(now + win.minutes * 60_000).toISOString();
  const lower = new Date(now).toISOString();
  // Games whose scheduled_at falls in (now, now + window] and this column is still null.
  const url =
    `${REST}/games?status=in.(upcoming,open)` +
    `&scheduled_at=gt.${encodeURIComponent(lower)}` +
    `&scheduled_at=lte.${encodeURIComponent(upper)}` +
    `&${win.column}=is.null` +
    `&select=id,title,prize_pool,accent_color,glow_color,gradient_colors,scheduled_at`;
  const res = await fetch(url, { headers: restHeaders() });
  if (!res.ok) {
    console.error(`[reminder] fetch games (${win.minutes}m) HTTP ${res.status}`);
    return;
  }
  const games = await res.json() as ReminderGame[];
  if (games.length === 0) return;

  const tokens = await fetchEligibleTokens();
  if (tokens.length === 0) {
    // Still mark as sent so we don't keep retrying when no audience exists.
    for (const g of games) await markReminderSent(g.id, win.column);
    return;
  }

  for (const g of games) {
    const won = await markReminderSent(g.id, win.column);
    if (!won) continue; // another tick already claimed this reminder
    const data: Record<string, string> = {
      type: "show_reminder",
      game_id: g.id,
      game_title: g.title,
      prize_pool: String(g.prize_pool ?? ""),
      accent_color: g.accent_color ?? "",
      glow_color: g.glow_color ?? "",
      gradient_colors: (g.gradient_colors ?? []).join(","),
      minutes_until_start: String(win.minutes),
      scheduled_at: g.scheduled_at,
    };
    const title = g.title;
    const body = `Starts ${win.bodyKey} — prize ${g.prize_pool}`;
    const deviceTokens = tokens.map((t) => t.token);
    const result = await sendFcmToTokens(deviceTokens, { title, body, data });
    const userIds = Array.from(new Set(tokens.map((t) => t.user_id)));
    await insertNotificationRows(g.id, title, body, data, userIds);
    if (result.invalidTokens.length > 0) await deleteInvalidTokens(result.invalidTokens);
    console.log(`[reminder] game=${g.id} window=${win.minutes}m delivered=${result.delivered} failed=${result.failed}`);
  }
}

async function reminderTick(): Promise<void> {
  if (!isFcmConfigured()) return; // silently skip when FCM credentials are absent
  try {
    for (const win of REMINDER_WINDOWS) await processReminderWindow(win);
  } catch (err) {
    console.error("[reminder] tick failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Combined tick ────────────────────────────────────────────────────────────

async function fullTick(): Promise<void> {
  await Promise.all([tick(), schedulerTick(), reminderTick()]);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

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
  `[template-generator] started — interval=${INTERVAL_MS}ms ` +
  `supabase_url=${new URL(SUPABASE_URL!).host} rabbitmq=${RABBITMQ_URL ? "configured" : "disabled"}`,
);

await fullTick();
setInterval(fullTick, INTERVAL_MS);
await new Promise(() => {});
