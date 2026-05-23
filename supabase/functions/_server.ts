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
const realServe = Deno.serve.bind(Deno);

// deno-lint-ignore no-explicit-any
(Deno as any).serve = (...args: unknown[]): unknown => {
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
// deno-lint-ignore no-explicit-any
(Deno as any).serve = realServe;

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

realServe({ port: PORT, hostname: "0.0.0.0" }, async (req: Request) => {
  const url = new URL(req.url);

  // Health probe.
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(JSON.stringify({ ok: true, services: handlers.size }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const service = resolveService(url.pathname);
  if (!service) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await handlers.get(service)!(req);
  } catch (err) {
    console.error(`[api] ${service} threw:`, err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
