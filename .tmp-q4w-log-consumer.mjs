// Quiz4Win — local debug-log consumer (temporary, no install required).
// Reads RABBITMQ_URL straight from the project .env, ensures the debug queue
// exists, then polls the RabbitMQ HTTP Management API and prints log lines.
// Secrets are never printed.

import { readFileSync } from "node:fs";

const ENV_PATH = "./.env";

function readEnv(key) {
  const txt = readFileSync(ENV_PATH, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  return "";
}

const RABBITMQ_URL    = process.env.RABBITMQ_URL    || readEnv("RABBITMQ_URL");
const DEBUG_LOG_QUEUE = process.env.DEBUG_LOG_QUEUE || readEnv("DEBUG_LOG_QUEUE") || "quiz4win.debug.logs";

if (!RABBITMQ_URL) { console.error("ERROR: RABBITMQ_URL not found in env or .env"); process.exit(1); }

// amqps://user:pass@host/vhost  ->  https management base + basic auth
let scheme, norm;
if (RABBITMQ_URL.startsWith("amqps://"))      { scheme = "https"; norm = "https://" + RABBITMQ_URL.slice(8); }
else if (RABBITMQ_URL.startsWith("amqp://"))  { scheme = "http";  norm = "http://"  + RABBITMQ_URL.slice(7); }
else { console.error("ERROR: RABBITMQ_URL must start with amqp:// or amqps://"); process.exit(1); }

const u = new URL(norm);
const vhost    = u.pathname && u.pathname !== "/" ? decodeURIComponent(u.pathname.slice(1)) : "/";
const base     = `${scheme}://${u.hostname}`;
const auth     = "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
const vhostEnc = encodeURIComponent(vhost);
const queueEnc = encodeURIComponent(DEBUG_LOG_QUEUE);

const C = { reset:"\x1b[0m", grey:"\x1b[90m", cyan:"\x1b[36m", yellow:"\x1b[33m", red:"\x1b[31m", bold:"\x1b[1m" };
const LVL = { info:C.cyan, warn:C.yellow, error:C.red };

function fmt(payload) {
  try {
    const m = JSON.parse(payload);
    const color = LVL[m.lvl] ?? C.cyan;
    const ts  = m.ts ? new Date(m.ts).toLocaleTimeString("en-GB", { hour12:false }) : "??:??:??";
    const svc = m.svc ? `${C.bold}[${m.svc}]${C.reset}` : "";
    const lvl = `${color}${String(m.lvl ?? "log").toUpperCase().padEnd(5)}${C.reset}`;
    return `${C.grey}${ts}${C.reset} ${svc} ${lvl} ${m.msg ?? payload}`;
  } catch { return payload; }
}

async function api(path, method = "GET", body) {
  return await fetch(`${base}/api${path}`, {
    method,
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ensureQueue() {
  // durable=false, auto_delete=false so the queue persists between polls and
  // collects messages even while the consumer is briefly idle.
  const res = await api(`/queues/${vhostEnc}/${queueEnc}`, "PUT", { durable:false, auto_delete:false, arguments:{} });
  if (!res.ok && res.status !== 204 && res.status !== 201) {
    throw new Error(`declare queue failed: HTTP ${res.status} ${await res.text()}`);
  }
}

async function poll() {
  const res = await api(`/queues/${vhostEnc}/${queueEnc}/get`, "POST", {
    count: 50, ackmode: "ack_requeue_false", encoding: "auto",
  });
  if (!res.ok) throw new Error(`get failed: HTTP ${res.status} ${await res.text()}`);
  const msgs = await res.json();
  for (const m of msgs) console.log(fmt(m.payload));
}

console.log(`${C.bold}Quiz4Win Debug Log Consumer (node/management-api)${C.reset}`);
console.log(`Broker host : ${u.hostname}`);
console.log(`Vhost       : ${vhost}`);
console.log(`Queue       : ${DEBUG_LOG_QUEUE}`);

const ov = await api("/overview");
if (ov.status === 401) { console.error(`${C.red}ERROR: management API auth failed (401)${C.reset}`); process.exit(1); }
if (!ov.ok)            { console.error(`${C.red}ERROR: management API HTTP ${ov.status}${C.reset}`); process.exit(1); }
console.log(`${C.grey}[ok] management API reachable${C.reset}`);

await ensureQueue();
console.log(`${C.grey}[ok] queue ensured — waiting for messages (Ctrl-C to stop)…${C.reset}\n`);

for (;;) {
  try { await poll(); }
  catch (e) { console.error(`${C.red}[poll error] ${e.message}${C.reset}`); }
  await new Promise(r => setTimeout(r, 1500));
}
