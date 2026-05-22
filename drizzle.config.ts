/**
 * Drizzle Kit configuration for the Quiz4Win backend.
 *
 * Pulls schema from the live Supabase Postgres database (introspection).
 * Uses the Supavisor session-mode pooler because direct connections
 * (`db.<ref>.supabase.co`) only have IPv6 records, which most local
 * networks cannot route.
 *
 * Reads credentials from `.env` — see NEXT_PUBLIC_SUPABASE_POSTGRESQLURL.
 */
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const directUrl = process.env.NEXT_PUBLIC_SUPABASE_POSTGRESQLURL;
if (!directUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_POSTGRESQLURL is not set in .env");
}

const url = new URL(directUrl);
const host = url.hostname;
const projectRef = host.split(".")[1];
const password = decodeURIComponent(url.password);

const POOLER_REGION = process.env.SUPABASE_POOLER_REGION ?? "eu-west-1";
const poolerUrl =
  `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}` +
  `@aws-0-${POOLER_REGION}.pooler.supabase.com:5432/postgres`;

export default defineConfig({
  dialect: "postgresql",
  schema: "./supabase/drizzle/schema.ts",
  out: "./supabase/drizzle",
  schemaFilter: ["public"],
  dbCredentials: {
    url: poolerUrl,
    ssl: "require",
  },
  introspect: {
    casing: "preserve",
  },
  verbose: true,
  strict: true,
});
