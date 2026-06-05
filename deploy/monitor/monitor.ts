/**
 * Quiz4Win — Service Monitor
 *
 * A single-purpose Deno container that runs a health loop every
 * MONITOR_INTERVAL_MS and emails an alert (Brevo) when any monitored
 * dependency becomes unhealthy, and a recovery email once all are healthy
 * again. Alerts are transition-based (down→up / up→down) with a periodic
 * re-alert while a service stays down, so a single outage does not spam.
 *
 * Monitored dependencies (each skipped only if its env var is absent):
 *   1. api            — GET ${API_HEALTH_URL} (in-network http://api:8000/health)
 *   2. supabase-rest  — GET ${SUPABASE_URL}/rest/v1/games?select=id&limit=1
 *   3. supabase-auth  — GET ${SUPABASE_URL}/auth/v1/health
 *   4. supabase-db    — TCP connect to SUPABASE_DB_URL host:port (pooler)
 *   5. redis          — TCP AUTH + PING against redis:6379
 *   6. rabbitmq       — GET ${mgmt}/api/overview (basic auth from RABBITMQ_URL)
 *   7. livekit        — GET https form of LIVEKIT_SERVER_URL (reachability)
 *
 * Env vars (R-01: secrets from env only, never logged):
 *   BREVO_API_KEY, EMAIL_FROM, MONITOR_RECIPIENT — email delivery.
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *   SUPABASE_DB_URL, REDIS_URL / REDIS_PASSWORD, RABBITMQ_URL, LIVEKIT_SERVER_URL.
 *   API_HEALTH_URL (default http://api:8000/health).
 *   MONITOR_INTERVAL_MS (default 60000), MONITOR_TIMEOUT_MS (default 12000),
 *   MONITOR_REALERT_MS (default 1800000 = 30 min), MONITOR_ENV (label).
 */

import { buildStatusEmail, type CheckResult, sendEmail } from "./email.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
const REDIS_URL = Deno.env.get("REDIS_URL") ?? "";
const REDIS_PASSWORD = Deno.env.get("REDIS_PASSWORD") ?? "";
const RABBITMQ_URL = Deno.env.get("RABBITMQ_URL") ?? "";
const LIVEKIT_URL = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
const API_HEALTH_URL = Deno.env.get("API_HEALTH_URL") ?? "http://api:8000/health";

const INTERVAL_MS = Number(Deno.env.get("MONITOR_INTERVAL_MS") ?? 60_000);
const TIMEOUT_MS = Number(Deno.env.get("MONITOR_TIMEOUT_MS") ?? 12_000);
const REALERT_MS = Number(Deno.env.get("MONITOR_REALERT_MS") ?? 1_800_000);
const ENV_LABEL = Deno.env.get("MONITOR_ENV") ?? "production";

// ─── HTTP helper with hard timeout ────────────────────────────────────────────
async function timedFetch(url: string, headers: Record<string, string> = {}): Promise<{ status: number; ms: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    // Drain body so the connection can be reused/closed cleanly.
    await res.body?.cancel();
    return { status: res.status, ms: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(t);
  }
}

function result(name: string, ok: boolean, detail: string, ms: number): CheckResult {
  return { name, ok, detail, latencyMs: ms };
}

// ─── Individual checks ────────────────────────────────────────────────────────
async function checkHttp(name: string, url: string, headers: Record<string, string>, okMax = 499): Promise<CheckResult> {
  const start = performance.now();
  try {
    const { status, ms } = await timedFetch(url, headers);
    const ok = status > 0 && status <= okMax;
    return result(name, ok, ok ? `HTTP ${status}` : `HTTP ${status} (unhealthy)`, ms);
  } catch (err) {
    const msg = (err as Error).name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : (err as Error).message;
    return result(name, false, msg, Math.round(performance.now() - start));
  }
}

async function checkTcp(name: string, host: string, port: number): Promise<CheckResult> {
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const conn = await Deno.connect({ hostname: host, port, signal: ctrl.signal } as Deno.ConnectOptions & { signal: AbortSignal });
    conn.close();
    return result(name, true, `TCP open ${host}:${port}`, Math.round(performance.now() - start));
  } catch (err) {
    return result(name, false, `TCP ${host}:${port} — ${(err as Error).message}`, Math.round(performance.now() - start));
  } finally {
    clearTimeout(t);
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = performance.now();
  let host = "redis", port = 6379, pass = REDIS_PASSWORD;
  if (REDIS_URL) {
    try {
      const u = new URL(REDIS_URL);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
      if (u.password) pass = decodeURIComponent(u.password);
    } catch { /* fall back to defaults */ }
  }
  let conn: Deno.TcpConn | undefined;
  const t = setTimeout(() => conn?.close(), TIMEOUT_MS);
  try {
    conn = await Deno.connect({ hostname: host, port });
    const enc = new TextEncoder();
    const cmd = pass
      ? `*2\r\n$4\r\nAUTH\r\n$${pass.length}\r\n${pass}\r\n*1\r\n$4\r\nPING\r\n`
      : `*1\r\n$4\r\nPING\r\n`;
    await conn.write(enc.encode(cmd));
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    const reply = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    const ok = reply.includes("PONG");
    return result("redis", ok, ok ? `PING → PONG (${host}:${port})` : `unexpected reply: ${reply.trim().slice(0, 40)}`, Math.round(performance.now() - start));
  } catch (err) {
    return result("redis", false, `${host}:${port} — ${(err as Error).message}`, Math.round(performance.now() - start));
  } finally {
    clearTimeout(t);
    try { conn?.close(); } catch { /* already closed */ }
  }
}

// Convert an amqp(s):// URI into the CloudAMQP-style management base + basic auth.
function rabbitMgmt(): { base: string; auth: string } | null {
  const raw = RABBITMQ_URL;
  let scheme: string, norm: string;
  if (raw.startsWith("amqps://")) { scheme = "https"; norm = "https://" + raw.slice(8); }
  else if (raw.startsWith("amqp://")) { scheme = "http"; norm = "http://" + raw.slice(7); }
  else return null;
  try {
    const u = new URL(norm);
    return {
      base: `${scheme}://${u.hostname}`,
      auth: "Basic " + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`),
    };
  } catch {
    return null;
  }
}

function hostPortFromDbUrl(): { host: string; port: number } | null {
  if (!DB_URL) return null;
  try {
    const u = new URL(DB_URL);
    return { host: u.hostname, port: u.port ? Number(u.port) : 5432 };
  } catch {
    return null;
  }
}

// ─── Run the full check suite in parallel ─────────────────────────────────────
async function runChecks(): Promise<CheckResult[]> {
  const tasks: Promise<CheckResult>[] = [];

  tasks.push(checkHttp("api", API_HEALTH_URL, {}, 399));

  if (SUPABASE_URL && SERVICE_KEY) {
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    tasks.push(checkHttp("supabase-rest", `${SUPABASE_URL}/rest/v1/games?select=id&limit=1`, h, 399));
    tasks.push(checkHttp("supabase-auth", `${SUPABASE_URL}/auth/v1/health`, { apikey: SERVICE_KEY }, 399));
  }

  const db = hostPortFromDbUrl();
  if (db) tasks.push(checkTcp("supabase-db", db.host, db.port));

  if (REDIS_URL || REDIS_PASSWORD) tasks.push(checkRedis());

  const mgmt = rabbitMgmt();
  if (mgmt) tasks.push(checkHttp("rabbitmq", `${mgmt.base}/api/overview`, { Authorization: mgmt.auth }, 399));

  if (LIVEKIT_URL) {
    const httpBase = LIVEKIT_URL.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/$/, "");
    tasks.push(checkHttp("livekit", httpBase, {}, 499));
  }

  return await Promise.all(tasks);
}

// ─── Alert state machine ──────────────────────────────────────────────────────
// Tracks whether we are currently in an "outage" and when the last alert fired,
// so we email on every up→down / down→up transition and re-alert at most once
// per REALERT_MS while an outage persists.
let inOutage = false;
let lastAlertAt = 0;

async function tick(): Promise<void> {
  const results = await runChecks();
  const down = results.filter((r) => !r.ok);
  const now = Date.now();

  const summary = results.map((r) => `${r.ok ? "UP" : "DOWN"}:${r.name}`).join(" ");
  console.log(`[monitor] ${summary}`);

  if (down.length > 0) {
    const isNew = !inOutage;
    const shouldRepeat = inOutage && now - lastAlertAt >= REALERT_MS;
    if (isNew || shouldRepeat) {
      const sent = await sendEmail(buildStatusEmail({ recovered: false, results, env: ENV_LABEL }));
      if (sent) lastAlertAt = now;
      console.warn(`[monitor] ALERT ${isNew ? "(new outage)" : "(re-alert)"} — down: ${down.map((d) => d.name).join(", ")} | emailed=${sent}`);
    }
    inOutage = true;
  } else if (inOutage) {
    // Recovered: everything is healthy again after an outage.
    const sent = await sendEmail(buildStatusEmail({ recovered: true, results, env: ENV_LABEL }));
    console.log(`[monitor] RECOVERED — all checks healthy | emailed=${sent}`);
    inOutage = false;
    lastAlertAt = 0;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
console.log(`[monitor] starting — interval=${INTERVAL_MS}ms timeout=${TIMEOUT_MS}ms re-alert=${REALERT_MS}ms env=${ENV_LABEL}`);
if (!Deno.env.get("BREVO_API_KEY")) {
  console.warn("[monitor] WARNING: BREVO_API_KEY is not set — checks will run but no email can be sent");
}

await tick();
setInterval(() => {
  tick().catch((err) => console.error(`[monitor] tick error: ${(err as Error).message}`));
}, INTERVAL_MS);
