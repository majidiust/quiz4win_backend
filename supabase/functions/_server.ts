/**
 * Quiz4Win API server — Deno entry point.
 *
 * Each function under supabase/functions/<name>/index.ts uses Deno.serve(handler)
 * — the Supabase Edge Function convention. To run them all in a single process
 * (behind one HTTP port at api.quiz4win.com), this module:
 *
 *   1. Shims Deno.serve to capture each function's handler instead of starting
 *      its own listener.
 *   2. Dynamically imports every function directory.
 *   3. Restores Deno.serve and starts a single dispatcher that routes incoming
 *      requests by URL prefix:
 *
 *        /admin/<x>/...  → handler registered by "admin-<x>"
 *        /<x>/...        → handler registered by "<x>"
 *
 * Rule compliance:
 *   - R-01: no secrets read or logged here — handlers continue to read env vars
 *           at their own discretion.
 *   - R-06: this is a pure runtime entrypoint; it does not import any function's
 *           internals, only their top-level module.
 */

type Handler = (req: Request) => Response | Promise<Response>;

const handlers = new Map<string, Handler>();
let currentService = "";

// ─── Shim Deno.serve ─────────────────────────────────────────────────────────
// In recent Deno versions `Deno.serve` is defined as a getter-only property, so
// direct assignment throws. Use Object.defineProperty to override it.
const realServe = Deno.serve.bind(Deno);

const shimServe = (...args: unknown[]): unknown => {
  // Accepted call shapes:
  //   Deno.serve(handler)
  //   Deno.serve(options, handler)
  //   Deno.serve({ ..., handler })
  let handler: Handler | undefined;
  for (const arg of args) {
    if (typeof arg === "function") {
      handler = arg as Handler;
      break;
    }
    if (arg && typeof arg === "object" && typeof (arg as { handler?: unknown }).handler === "function") {
      handler = (arg as { handler: Handler }).handler;
      break;
    }
  }
  if (handler && currentService) {
    handlers.set(currentService, handler);
  }
  // Return a noop "server" so user code can `await server.finished` etc.
  return {
    finished: new Promise<void>(() => {}),
    shutdown: () => Promise.resolve(),
    ref: () => {},
    unref: () => {},
    addr: { transport: "tcp", hostname: "0.0.0.0", port: 0 },
  };
};

Object.defineProperty(Deno, "serve", {
  value: shimServe,
  configurable: true,
  writable: true,
});

// ─── Discover and import every function ──────────────────────────────────────
const FUNCTIONS_DIR = new URL(".", import.meta.url).pathname;
const services: string[] = [];
for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
  if (!entry.isDirectory) continue;
  if (entry.name.startsWith("_")) continue; // _shared, etc.
  try {
    const indexPath = `${FUNCTIONS_DIR}${entry.name}/index.ts`;
    await Deno.stat(indexPath);
    services.push(entry.name);
  } catch {
    // No index.ts — skip.
  }
}
services.sort();

for (const name of services) {
  currentService = name;
  try {
    await import(`./${name}/index.ts`);
  } catch (err) {
    console.error(`[api] failed to load function "${name}":`, err);
  }
}
currentService = "";

// Restore the real Deno.serve for the dispatcher.
Object.defineProperty(Deno, "serve", {
  value: realServe,
  configurable: true,
  writable: true,
});

console.log(`[api] loaded ${handlers.size} services:`, [...handlers.keys()].join(", "));

// ─── Routing ─────────────────────────────────────────────────────────────────
function resolveService(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "admin" && parts[1]) {
    const name = `admin-${parts[1]}`;
    return handlers.has(name) ? name : null;
  }
  return handlers.has(parts[0]) ? parts[0] : null;
}

const PORT = Number(Deno.env.get("PORT") ?? "8000");

// ─── Request tracing ─────────────────────────────────────────────────────────
// Verbose end-to-end tracing of every inbound request.
// API_TRACE=off  → disable tracing entirely
// API_TRACE_RAW=on → print bodies and headers completely unredacted (debug only!)
const TRACE = (Deno.env.get("API_TRACE") ?? "on").toLowerCase() !== "off";
const TRACE_RAW = (Deno.env.get("API_TRACE_RAW") ?? "off").toLowerCase() === "on";
const TRACE_BODY_LIMIT = 4096; // bytes printed of any single body

const SENSITIVE_HEADERS = new Set([
  "authorization", "cookie", "set-cookie", "apikey", "x-api-key",
  "x-supabase-auth", "x-stripe-signature",
]);
const SENSITIVE_BODY_KEYS = /(password|secret|token|otp|access_token|refresh_token|api_key|apikey|client_secret)/i;

function redactHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of h.entries()) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
      out[k] = `<redacted len=${v.length} prefix=${v.slice(0, 12)}…>`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactJsonBody(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const o: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          o[k] = SENSITIVE_BODY_KEYS.test(k)
            ? (typeof val === "string" ? `<redacted len=${val.length}>` : "<redacted>")
            : walk(val);
        }
        return o;
      }
      return v;
    };
    return JSON.stringify(walk(obj));
  } catch {
    return raw; // not JSON — return as-is (already size-capped)
  }
}

async function readBodyForTrace(req: Request): Promise<{ text: string; clone: Request }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  // For multipart we never read the body — it may contain large files.
  if (ct.includes("multipart/form-data")) {
    return { text: `<multipart skipped — content-length=${req.headers.get("content-length") ?? "?"}>`, clone: req };
  }
  const buf = await req.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const fullText = decoder.decode(bytes.slice(0, TRACE_BODY_LIMIT));
  const display = (!TRACE_RAW && ct.includes("application/json")) ? redactJsonBody(fullText) : fullText;
  const suffix = bytes.byteLength > TRACE_BODY_LIMIT ? `…<truncated ${bytes.byteLength - TRACE_BODY_LIMIT}B>` : "";
  // Re-build a request with the same body so the downstream handler can still read it.
  const clone = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: bytes.byteLength === 0 ? undefined : buf,
  });
  return { text: display + suffix, clone };
}

realServe({ port: PORT, hostname: "0.0.0.0" }, async (req: Request) => {
  const url = new URL(req.url);
  const startedAt = Date.now();

  // Health probe — keep silent to avoid log spam from nginx/healthcheck.
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(JSON.stringify({ ok: true, services: handlers.size }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Trace inbound ────────────────────────────────────────────────────────
  let workingReq = req;
  if (TRACE) {
    const headers = TRACE_RAW
      ? Object.fromEntries(req.headers.entries())
      : redactHeaders(req.headers);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let bodyText = "";
    if (hasBody) {
      try {
        const parsed = await readBodyForTrace(req);
        bodyText = parsed.text;
        workingReq = parsed.clone;
      } catch (err) {
        bodyText = `<failed to read body: ${err instanceof Error ? err.message : String(err)}>`;
      }
    }
    console.log(
      `[api] ←IN  ${req.method} ${url.pathname}${url.search} headers=${JSON.stringify(headers)}${
        hasBody ? ` body=${bodyText}` : ""
      }`,
    );
  }

  const service = resolveService(url.pathname);
  const log = (status: number, extra = "") =>
    console.log(
      `[api] →OUT ${req.method} ${url.pathname} → ${service ?? "(none)"} status=${status} ms=${Date.now() - startedAt}${extra ? " " + extra : ""}`,
    );

  if (!service) {
    log(404);
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await handlers.get(service)!(workingReq);
    // Optionally peek small JSON response bodies for tracing.
    if (TRACE) {
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      if (ct.includes("application/json")) {
        const cloned = res.clone();
        const text = (await cloned.text()).slice(0, TRACE_BODY_LIMIT);
        log(res.status, `body=${TRACE_RAW ? text : redactJsonBody(text)}`);
      } else {
        log(res.status, `content-type=${ct || "(none)"}`);
      }
    } else {
      log(res.status);
    }
    return res;
  } catch (err) {
    console.error(`[api] ${service} threw:`, err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : err);
    log(500, "threw");
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
