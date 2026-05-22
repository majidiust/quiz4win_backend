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
 * A postgres.js connection pool optimised for short-lived Edge Function
 * invocations: max 1 connection, no keep-alive, prepare = false
 * (required for Supavisor / pgBouncer in transaction mode).
 */
const queryClient = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: "require",
});

/**
 * The shared Drizzle ORM instance.
 * Import this in your Edge Function handlers.
 */
export const db = drizzle(queryClient, { schema: { ...schema, ...relations } });

/** Re-export the raw postgres client for use cases where raw SQL is needed. */
export { queryClient };
