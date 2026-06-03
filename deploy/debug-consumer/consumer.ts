/**
 * Quiz4Win — Debug Log Consumer
 *
 * Connects to RabbitMQ and streams structured log messages from the debug
 * queue to stdout in real time. Run this locally to watch server logs live.
 *
 * Usage:
 *   # Option A — env var inline
 *   RABBITMQ_URL=amqps://user:pass@host/vhost deno run --allow-net --allow-env consumer.ts
 *
 *   # Option B — load from project .env
 *   set -a && source ../../.env && set +a
 *   deno run --allow-net --allow-env consumer.ts
 *
 * Optional overrides:
 *   DEBUG_LOG_QUEUE=quiz4win.debug.logs   (default shown)
 *
 * The queue is declared non-durable + auto-delete so it disappears when the
 * last consumer disconnects — no stale messages accumulate on the broker.
 */

// deno-lint-ignore-file no-explicit-any
import { connect } from "https://deno.land/x/amqp@v0.24.0/mod.ts";

const RABBITMQ_URL    = Deno.env.get("RABBITMQ_URL") ?? "";
const DEBUG_LOG_QUEUE = Deno.env.get("DEBUG_LOG_QUEUE") ?? "quiz4win.debug.logs";

if (!RABBITMQ_URL) {
  console.error("ERROR: RABBITMQ_URL is required.");
  console.error("  Set it in your shell or load from .env:");
  console.error("  set -a && source ../../.env && set +a");
  Deno.exit(1);
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

const C = {
  reset : "\x1b[0m",
  grey  : "\x1b[90m",
  cyan  : "\x1b[36m",
  yellow: "\x1b[33m",
  red   : "\x1b[31m",
  bold  : "\x1b[1m",
};

const LVL_COLOR: Record<string, string> = {
  info : C.cyan,
  warn : C.yellow,
  error: C.red,
};

function fmt(raw: string): string {
  try {
    const m = JSON.parse(raw) as { ts?: string; svc?: string; lvl?: string; msg?: string };
    const color = LVL_COLOR[m.lvl ?? ""] ?? C.cyan;
    const ts    = m.ts ? new Date(m.ts).toLocaleTimeString("en-GB", { hour12: false }) : "??:??:??";
    const svc   = m.svc ? `${C.bold}[${m.svc}]${C.reset}` : "";
    const lvl   = `${color}${(m.lvl ?? "log").toUpperCase().padEnd(5)}${C.reset}`;
    return `${C.grey}${ts}${C.reset} ${svc} ${lvl} ${m.msg ?? raw}`;
  } catch {
    return raw;
  }
}

// ─── Consumer loop ────────────────────────────────────────────────────────────

const decoder = new TextDecoder();

console.log(`${C.bold}Quiz4Win Debug Log Consumer${C.reset}`);
console.log(`Queue : ${DEBUG_LOG_QUEUE}`);
console.log(`Press Ctrl-C to stop.\n`);

while (true) {
  try {
    const conn = await connect(RABBITMQ_URL);
    const ch   = await conn.openChannel();

    // Non-durable, auto-delete: the queue vanishes when no consumer is attached.
    await ch.declareQueue({ queue: DEBUG_LOG_QUEUE, durable: false, autoDelete: true });
    console.log(`${C.grey}[consumer] connected — waiting for messages…${C.reset}`);

    await ch.consume({ queue: DEBUG_LOG_QUEUE, noAck: true }, (_args: any, _props: any, data: Uint8Array) => {
      console.log(fmt(decoder.decode(data)));
    });

    await ch.closed();
    console.warn(`${C.yellow}[consumer] channel closed — reconnecting…${C.reset}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${C.red}[consumer] connection failed: ${msg}${C.reset}`);
    console.error(`  retrying in 5 s…`);
    await new Promise<void>(r => setTimeout(r, 5_000));
  }
}
