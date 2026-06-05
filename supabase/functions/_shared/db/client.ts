/**
 * Drizzle ORM client for Supabase Edge Functions (Deno).
 *
 * Usage in any Edge Function:
 *   import { db } from "../_shared/db/client.ts";
 *   const rows = await db.select().from(profiles).limit(10);
 *
 * The connection string is read from the environment variable
 * `SUPABASE_DB_URL` which must be set in each Edge Function's
 * Supabase secret (or injected locally via `.env`).
 *
 * Rule compliance:
 *  - R-01: No secrets embedded in source code — URL from env only.
 *  - R-03: JWT validation is NOT done here; each function must call
 *           `validateJwt()` from `_shared/auth.ts` before querying.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../../drizzle/schema.ts";
import * as relations from "../../../drizzle/relations.ts";

const connectionString = Deno.env.get("SUPABASE_DB_URL");
if (!connectionString) {
  throw new Error(
    "SUPABASE_DB_URL environment variable is not set. " +
    "Add it as a Supabase secret: `supabase secrets set SUPABASE_DB_URL=...`"
  );
}

/**
 * A postgres.js connection pool shared across the combined `_server.ts`
 * process (all functions run in a single long-lived Deno runtime, not the
 * isolated per-invocation model of hosted Edge Functions). Settings:
 *  - max 5: a small pool that serves concurrent public reads without
 *    exhausting the limited direct-connection slots on the Postgres tier.
 *  - prepare = false: required for Supavisor / pgBouncer transaction mode.
 *  - connect_timeout 10s: fail fast instead of hanging the full request
 *    budget when the database is unreachable.
 *  - idle_timeout 20s: release idle connections promptly.
 *  - ssl "require": Supabase rejects non-TLS connections.
 */
const queryClient = postgres(connectionString, {
  max: 5,
  prepare: false,
  ssl: "require",
  connect_timeout: 10,
  idle_timeout: 20,
});

/**
 * The shared Drizzle ORM instance.
 * Import this in your Edge Function handlers.
 */
export const db = drizzle(queryClient, { schema: { ...schema, ...relations } });

/** Re-export the raw postgres client for use cases where raw SQL is needed. */
export { queryClient };
