/**
 * Barrel export for the shared DB layer.
 *
 * Import everything you need from a single path:
 *
 *   import { db, profiles, games, transactions } from "../_shared/db/index.ts";
 *
 * This keeps Edge Function import statements terse and
 * avoids reaching outside the functions/ directory for schema types.
 */

// Drizzle client (pre-configured connection to Supabase Postgres)
export { db, queryClient } from "./client.ts";

// All 31 table definitions (Drizzle table objects, column helpers, enums)
export * from "../../../drizzle/schema.ts";

// All foreign-key relations (used by Drizzle's relational query builder)
export * from "../../../drizzle/relations.ts";
