// Diagnostic: does majid.sadeghi.alavijeh@gmail.com exist as
//   (a) a Supabase auth.users row, and
//   (b) an active admin_users row?
// Prints booleans + non-sensitive fields only. Service-role key is never logged.
//
// Usage:
//   node scripts/check-admin-login.mjs [email]
//
// Defaults to ADMIN_EMAIL from .env if no arg is provided.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY;
const email = (process.argv[2] || env.ADMIN_EMAIL || "").trim().toLowerCase();

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
if (!email) {
  console.error("Pass an email arg or set ADMIN_EMAIL in .env");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

console.log(`\nChecking admin-login viability for: ${email}\n`);

// 1) auth.users
let authUser = null;
{
  let page = 1;
  while (page < 20) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error("auth.admin.listUsers error:", error.message); break; }
    authUser = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (authUser || !data.users.length || data.users.length < 200) break;
    page++;
  }
}

if (!authUser) {
  console.log("auth.users          : NOT FOUND  ← cannot sign in until this exists");
} else {
  console.log("auth.users          : FOUND");
  console.log(`  id                : ${authUser.id}`);
  console.log(`  email_confirmed   : ${authUser.email_confirmed_at ? "YES" : "NO  ← blocks sign-in"}`);
  console.log(`  banned_until      : ${authUser.banned_until ?? "-"}`);
  console.log(`  last_sign_in_at   : ${authUser.last_sign_in_at ?? "-"}`);
  console.log(`  created_at        : ${authUser.created_at}`);
}

// 2) admin_users
const { data: adminRow, error: adminErr } = await sb
  .from("admin_users")
  .select("id, email, name, role, status, mfa_enabled, last_login_at, created_at")
  .ilike("email", email)
  .maybeSingle();

if (adminErr) {
  console.log(`\nadmin_users         : QUERY ERROR — ${adminErr.message}`);
} else if (!adminRow) {
  console.log("\nadmin_users         : NOT FOUND  ← login succeeds at Supabase but admin panel rejects with 'not_admin'");
} else {
  console.log("\nadmin_users         : FOUND");
  console.log(`  id                : ${adminRow.id}`);
  console.log(`  email             : ${adminRow.email}`);
  console.log(`  role              : ${adminRow.role}`);
  console.log(`  status            : ${adminRow.status}${adminRow.status !== "active" ? "  ← blocks admin access" : ""}`);
  console.log(`  mfa_enabled       : ${adminRow.mfa_enabled}`);
  console.log(`  id matches auth?  : ${authUser ? (adminRow.id === authUser.id ? "YES" : "NO  ← schema mismatch") : "n/a"}`);
}

// 3) MFA factors — does the user have a verified TOTP factor?
if (authUser) {
  try {
    const { data: f, error: fErr } = await sb.auth.admin.mfa.listFactors({ userId: authUser.id });
    if (fErr) {
      console.log(`\nmfa factors         : query error — ${fErr.message}`);
    } else {
      const factors = f?.factors ?? [];
      console.log(`\nmfa factors         : ${factors.length} factor(s)`);
      for (const ff of factors) {
        console.log(`  - type=${ff.factor_type} status=${ff.status} friendly=${ff.friendly_name ?? "-"}`);
      }
      const verified = factors.filter((x) => x.status === "verified");
      if (verified.length === 0) {
        console.log("  no verified TOTP factor → middleware will NOT require MFA");
      } else {
        console.log(`  ${verified.length} verified factor(s) → middleware WILL require AAL2 (TOTP code)`);
      }
    }
  } catch (e) {
    console.log(`\nmfa factors         : exception — ${e.message}`);
  }
}

// 4) profiles (only to confirm not accidentally created as a player profile)
const { data: profile } = await sb
  .from("profiles")
  .select("id, email, status")
  .ilike("email", email)
  .maybeSingle();
console.log(`\nprofiles            : ${profile ? `FOUND (status=${profile.status})` : "not found"}`);

console.log("");
