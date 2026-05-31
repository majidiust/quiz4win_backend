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
      `?status=eq.upcoming&scheduled_at=lte.${encodeURIComponent(now)}&select=id,title,template_id`,
      {
        headers: {
          "apikey": SERVICE_ROLE_KEY!,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Accept": "application/json",
        },
      },
    );
    if (!res.ok) return;
    const games = await res.json() as Array<{ id: string; title: string; template_id: string | null }>;
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

      // Event-driven next-game generation (spec: "create next game when
      // current Upcoming Game changes to Running"). With the relaxed overlap
      // rule (blocks only on 'upcoming'), this call succeeds the moment the
      // current game leaves 'upcoming'.
      if (g.template_id) {
        await generateNextGameForTemplate(g.template_id, g.id);
      }
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err instanceof Error ? err.message : err);
  }
}

async function generateNextGameForTemplate(templateId: string, currentGameId: string): Promise<void> {
  try {
    const res = await fetch(
      `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/generate_game_from_template`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY!,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ p_template_id: templateId }),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[scheduler] next-game RPC HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return;
    }
    const newId = await res.json().catch(() => null) as string | null;
    if (newId) {
      console.log(`[scheduler] generated next game template=${templateId} new=${newId} after=${currentGameId}`);
    }
  } catch (err) {
    console.warn("[scheduler] generateNextGameForTemplate failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Watchdog tick ────────────────────────────────────────────────────────────
// Force-finalises games whose duration_minutes (+ grace) has elapsed but the
// orchestrator never delivered GAME_ENDED. RPC selects status='live' rows and
// atomically flips them to 'completed' with ended_at=NOW().
const WATCHDOG_GRACE_MINUTES = Number(Deno.env.get("WATCHDOG_GRACE_MINUTES") ?? 5);

interface WatchdogRow {
  game_id: string;
  template_id: string | null;
  started_at: string;
  expected_end: string;
}

async function watchdogTick(): Promise<void> {
  try {
    const res = await fetch(
      `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/force_finalize_stuck_games`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY!,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ p_grace_minutes: WATCHDOG_GRACE_MINUTES }),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[watchdog] rpc HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return;
    }
    const rows = await res.json() as WatchdogRow[] | null;
    if (!Array.isArray(rows) || rows.length === 0) return;
    for (const r of rows) {
      console.warn(
        `[watchdog] force-finalized game=${r.game_id} template=${r.template_id ?? "-"} ` +
        `started_at=${r.started_at} expected_end=${r.expected_end}`,
      );
    }
  } catch (err) {
    console.error("[watchdog] tick failed:", err instanceof Error ? err.message : err);
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

// ─── Prize-distribution safety-net tick ───────────────────────────────────────
// The orchestrator calls distribute_prizes() inline at finalize. This tick is
// the safety net for the two cases where that call does not run:
//   (a) the orchestrator crashed between status='completed' and the RPC call;
//   (b) the watchdog force-finalized a stuck game (no orchestrator involved).
// distribute_prizes is idempotent (anchored by games.prizes_distributed_at),
// so calling it twice is safe.

interface PendingDistributionRow { id: string }

async function prizeDistributionTick(): Promise<void> {
  try {
    const url =
      `${REST}/games?status=eq.completed&prizes_distributed_at=is.null` +
      `&select=id&order=ended_at.asc&limit=50`;
    const res = await fetch(url, { headers: restHeaders() });
    if (!res.ok) {
      console.error(`[prize-distribute] fetch HTTP ${res.status}`);
      return;
    }
    const rows = await res.json() as PendingDistributionRow[];
    if (rows.length === 0) return;
    for (const g of rows) {
      const r = await fetch(`${REST}/rpc/distribute_prizes`, {
        method: "POST",
        headers: restHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ p_game_id: g.id }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error(`[prize-distribute] rpc HTTP ${r.status} game=${g.id}: ${t.slice(0, 200)}`);
        continue;
      }
      const out = await r.json().catch(() => null);
      console.log(`[prize-distribute] game=${g.id} →`, out);
    }
  } catch (err) {
    console.error("[prize-distribute] tick failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Prize-notification tick ──────────────────────────────────────────────────
// Finds games that have been distributed but not yet notified, fetches winner
// push tokens via get_winner_push_tokens(p_game_id), sends FCM, and stamps
// games.prize_notifications_sent_at so each game notifies exactly once.

interface PendingNotificationRow { id: string; title: string; prize_pool_currency: string | null }
interface WinnerTokenRow {
  user_id: string;
  token: string;
  platform: string;
  rank: number;
  prize_amount: string;   // numeric → string in PostgREST JSON
  full_name: string | null;
  game_title: string;
  currency: string;
}

async function markPrizeNotificationsSent(gameId: string): Promise<boolean> {
  const res = await fetch(
    `${REST}/games?id=eq.${gameId}&prize_notifications_sent_at=is.null`,
    {
      method: "PATCH",
      headers: restHeaders({ "Content-Type": "application/json", "Prefer": "return=minimal" }),
      body: JSON.stringify({ prize_notifications_sent_at: new Date().toISOString() }),
    },
  );
  return res.ok;
}

async function insertPrizeNotificationRows(
  gameId: string,
  gameTitle: string,
  winnersByUser: Map<string, { rank: number; prize_amount: string; currency: string }>,
): Promise<void> {
  if (winnersByUser.size === 0) return;
  const rows = Array.from(winnersByUser.entries()).map(([user_id, w]) => ({
    user_id,
    type: "prize",
    title: `You won in ${gameTitle}!`,
    body: `Rank #${w.rank} — prize ${w.prize_amount} ${w.currency}`,
    sent_via_push: true,
    data: {
      type: "prize",
      game_id: gameId,
      game_title: gameTitle,
      rank: String(w.rank),
      prize_amount: w.prize_amount,
      currency: w.currency,
    },
  }));
  const res = await fetch(`${REST}/notifications`, {
    method: "POST",
    headers: restHeaders({ "Content-Type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn(`[prize-notify] insert notifications game=${gameId} HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

async function processPrizeNotification(g: PendingNotificationRow): Promise<void> {
  // Claim the row first so a concurrent tick (or restart) cannot double-send.
  const claimed = await markPrizeNotificationsSent(g.id);
  if (!claimed) return;

  const res = await fetch(`${REST}/rpc/get_winner_push_tokens`, {
    method: "POST",
    headers: restHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ p_game_id: g.id }),
  });
  if (!res.ok) {
    console.error(`[prize-notify] tokens rpc HTTP ${res.status} game=${g.id}`);
    return;
  }
  const winners = await res.json() as WinnerTokenRow[];
  if (!Array.isArray(winners) || winners.length === 0) {
    console.log(`[prize-notify] game=${g.id} no winners with push tokens`);
    return;
  }

  // Per-winner notification rows (one DB row per user, even with multi-device).
  const winnersByUser = new Map<string, { rank: number; prize_amount: string; currency: string }>();
  for (const w of winners) {
    if (!winnersByUser.has(w.user_id)) {
      winnersByUser.set(w.user_id, { rank: w.rank, prize_amount: w.prize_amount, currency: w.currency });
    }
  }

  // Fan-out: send each winner a personalised FCM payload (one HTTP per device).
  let delivered = 0, failed = 0;
  const invalidTokens: string[] = [];
  for (const w of winners) {
    const body = `Rank #${w.rank} — you won ${w.prize_amount} ${w.currency}`;
    const data: Record<string, string> = {
      type: "prize",
      game_id: g.id,
      game_title: w.game_title,
      rank: String(w.rank),
      prize_amount: w.prize_amount,
      currency: w.currency,
    };
    const r = await sendFcmToTokens([w.token], { title: `You won in ${w.game_title}!`, body, data });
    delivered += r.delivered;
    failed += r.failed;
    for (const t of r.invalidTokens) invalidTokens.push(t);
  }

  await insertPrizeNotificationRows(g.id, g.title, winnersByUser);
  if (invalidTokens.length > 0) await deleteInvalidTokens(invalidTokens);
  console.log(`[prize-notify] game=${g.id} winners=${winnersByUser.size} delivered=${delivered} failed=${failed}`);
}

async function prizeNotificationTick(): Promise<void> {
  if (!isFcmConfigured()) return;
  try {
    const url =
      `${REST}/games?prizes_distributed_at=not.is.null&prize_notifications_sent_at=is.null` +
      `&select=id,title,prize_pool_currency&order=prizes_distributed_at.asc&limit=50`;
    const res = await fetch(url, { headers: restHeaders() });
    if (!res.ok) {
      console.error(`[prize-notify] fetch HTTP ${res.status}`);
      return;
    }
    const games = await res.json() as PendingNotificationRow[];
    for (const g of games) await processPrizeNotification(g);
  } catch (err) {
    console.error("[prize-notify] tick failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Combined tick ────────────────────────────────────────────────────────────

async function fullTick(): Promise<void> {
  await Promise.all([
    tick(),
    schedulerTick(),
    reminderTick(),
    watchdogTick(),
    prizeDistributionTick(),
    prizeNotificationTick(),
  ]);
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
