/**
 * Withdrawals Edge Function — Quiz4Win
 *
 * POST /withdrawals/request            — Submit withdrawal request; issues email OTP (API #24)
 * POST /withdrawals/:id/confirm        — Confirm with the emailed OTP → enters review queue
 * POST /withdrawals/:id/resend-otp     — Re-issue a fresh OTP for an unconfirmed request
 * GET  /withdrawals/:withdrawal_id     — Get withdrawal status (API #25)
 * GET  /withdrawals                    — List all withdrawals (API #26)
 *
 * Confirmation flow:
 *   request → status `awaiting_confirmation` (no balance debit yet) + OTP emailed
 *   confirm → OTP verified → earnings_balance debited, status `pending` (finance review)
 *
 * Supported withdrawal methods:
 *   bank_transfer — account_details: { bank_name, iban, swift, account_name }
 *   paypal        — account_details: { email }
 *   crypto        — account_details: { coin, network, address }
 *                   coin: USDT | USDC
 *                   network: TRC20 | ERC20 | BEP20 | SOL | MATIC
 *
 * Rule compliance: R-01 (only the SHA-256 hash of the OTP is stored), R-02, R-03,
 *   R-05 (append-only).
 * INV-05 (updated): KYC required ONLY for withdrawals > 1,000 EUR.
 * INV-15: Withdrawals debit earnings_balance (not wallet_balance).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";
import { sendEmail, withdrawalOtpTemplate } from "../_shared/email.ts";
import { generateNumericCode, sha256Hex } from "../_shared/totp.ts";
import { readMonetization, coinsToUsd } from "../_shared/monetization.ts";

const MIN_WITHDRAWAL = 10;    // €10.00 minimum
const MAX_WITHDRAWAL = 10_000; // €10,000 maximum
const KYC_THRESHOLD  = 1_000; // €1,000 — KYC required above this (INV-05 updated)
const OTP_TTL_MIN      = 10;  // emailed confirmation code lifetime (minutes)
const OTP_MAX_ATTEMPTS = 5;   // wrong-code attempts before the code locks

// Human-readable method labels for the confirmation email.
const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  crypto:        "Crypto",
  paypal:        "PayPal",
};

// ─── Supported crypto assets ──────────────────────────────────────────────────
const SUPPORTED_COINS = ["USDT", "USDC"] as const;
const SUPPORTED_NETWORKS: Record<string, string[]> = {
  USDT: ["TRC20", "ERC20", "BEP20", "SOL", "MATIC"],
  USDC: ["ERC20", "SOL", "MATIC", "BEP20"],
};
type CryptoCoin = typeof SUPPORTED_COINS[number];

interface CryptoAccountDetails {
  coin:    CryptoCoin;
  network: string;
  address: string;
}

function validateCryptoDetails(
  details: Record<string, unknown>,
): { ok: true; data: CryptoAccountDetails } | { ok: false; error: string } {
  const coin    = String(details.coin    ?? "").toUpperCase();
  const network = String(details.network ?? "").toUpperCase();
  const address = String(details.address ?? "").trim();

  if (!(SUPPORTED_COINS as readonly string[]).includes(coin)) {
    return { ok: false, error: `unsupported_coin:${coin}_supported:${SUPPORTED_COINS.join("|")}` };
  }
  const validNetworks = SUPPORTED_NETWORKS[coin] ?? [];
  if (!validNetworks.includes(network)) {
    return { ok: false, error: `unsupported_network:${network}_supported:${validNetworks.join("|")}` };
  }
  if (!address || address.length < 10 || address.length > 200) {
    return { ok: false, error: "invalid_crypto_address" };
  }
  return { ok: true, data: { coin: coin as CryptoCoin, network, address } };
}

/** Generate a 6-digit OTP and return the code, its SHA-256 hash, and expiry (R-01). */
async function makeOtp(): Promise<{ code: string; hash: string; expiresAt: string }> {
  const code = generateNumericCode(6);
  const hash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
  return { code, hash, expiresAt };
}

/** Fire-and-forget confirmation email; a slow/failed provider never blocks the API. */
function sendOtpEmail(opts: {
  email: string;
  name: string;
  code: string;
  amount: number;
  method: string;
}): void {
  const tpl = withdrawalOtpTemplate({
    name: opts.name,
    code: opts.code,
    amountLabel: `€${opts.amount.toFixed(2)}`,
    methodLabel: METHOD_LABELS[opts.method] ?? opts.method,
    ttlMinutes: OTP_TTL_MIN,
  });
  sendEmail({ to: { email: opts.email, name: opts.name || undefined }, ...tpl })
    .catch((err) => console.warn("[withdrawals] OTP email send failed:", err));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/^\/withdrawals\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // POST /withdrawals/request
    if (rawPath === "request" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { amount, method, account_details } = body as Record<string, unknown>;

      const amountNum = typeof amount === "number" ? amount
                      : typeof amount === "string" ? parseFloat(amount as string)
                      : NaN;

      if (!amountNum || isNaN(amountNum) || amountNum <= 0) {
        return errorResponse("invalid_amount", 400);
      }

      // ── Monetization gate (Option A presentation layer) ─────────────────────
      // `none` blocks all cash-out (App Store / Play review-safe). `coin` treats
      // the entered amount as coins and converts to canonical USD at the locked
      // admin rate. `usd` is 1:1. All thresholds/KYC below run on canonical USD.
      const admin = getAdminClient();
      const mon = await readMonetization(admin);
      if (mon.mode === "none") return errorResponse("monetization_disabled", 403);

      let coinAmount: number | null = null;
      let appliedRateMicros: number | null = null;
      let usdAmount = amountNum;
      if (mon.mode === "coin") {
        coinAmount = amountNum;
        appliedRateMicros = mon.rateMicros;
        usdAmount = coinsToUsd(amountNum, mon.rateMicros);
      }

      if (usdAmount < MIN_WITHDRAWAL) {
        return errorResponse(`minimum_withdrawal_${MIN_WITHDRAWAL}`, 400);
      }
      if (usdAmount > MAX_WITHDRAWAL) {
        return errorResponse(`maximum_withdrawal_${MAX_WITHDRAWAL}`, 400);
      }
      if (!method || !account_details || typeof account_details !== "object") {
        return errorResponse("method_and_account_details_required", 400);
      }

      const VALID_METHODS = ["bank_transfer", "crypto", "paypal"];
      if (!VALID_METHODS.includes(String(method))) {
        return errorResponse(`unsupported_method:supported=${VALID_METHODS.join("|")}`, 400);
      }

      // Validate crypto-specific fields and extract structured columns.
      let cryptoCoin: string | null = null;
      let cryptoNetwork: string | null = null;
      let cryptoAddress: string | null = null;

      if (method === "crypto") {
        const cryptoVal = validateCryptoDetails(account_details as Record<string, unknown>);
        if (!cryptoVal.ok) return errorResponse(cryptoVal.error, 400);
        cryptoCoin    = cryptoVal.data.coin;
        cryptoNetwork = cryptoVal.data.network;
        cryptoAddress = cryptoVal.data.address;
      }

      // Fetch earnings balance + KYC status + display name in one query.
      const { data: profile } = await admin
        .from("profiles")
        .select("kyc_status, earnings_balance, full_name")
        .eq("id", user.id)
        .single();

      if (!profile) return errorResponse("profile_not_found", 404);
      if (!user.email) return errorResponse("account_missing_email", 400);

      // INV-05 (updated): KYC required only for amounts > KYC_THRESHOLD (canonical USD).
      if (usdAmount > KYC_THRESHOLD && profile.kyc_status !== "verified") {
        return errorResponse("kyc_required", 403);
      }

      const earningsDollars = Number(profile.earnings_balance ?? 0);
      if (usdAmount > earningsDollars) {
        return errorResponse("insufficient_earnings", 400);
      }

      // Issue an email OTP. The request is parked in `awaiting_confirmation` and
      // is NOT debited until the user confirms the code (POST /:id/confirm).
      const otp = await makeOtp();
      const { data: withdrawal, error: wErr } = await admin
        .from("withdrawals")
        .insert({
          user_id:                 user.id,
          amount:                  usdAmount,   // canonical USD (NUMERIC(12,2))
          method,
          account_details,
          crypto_coin:             cryptoCoin,
          crypto_network:          cryptoNetwork,
          crypto_address:          cryptoAddress,
          monetization_mode:       mon.mode,
          coin_amount:             coinAmount,
          coin_usd_rate_micros:    appliedRateMicros,
          status:                  "awaiting_confirmation",
          confirmation_code_hash:  otp.hash,
          confirmation_expires_at: otp.expiresAt,
          confirmation_attempts:   0,
          requested_at:            new Date().toISOString(),
        })
        .select("id, amount, method, status, requested_at, crypto_coin, crypto_network")
        .single();

      if (wErr) return errorResponse(sanitizeError(wErr), 500);

      sendOtpEmail({
        email:  user.email,
        name:   (profile.full_name as string | null) ?? "",
        code:   otp.code,
        amount: usdAmount,
        method: String(method),
      });

      return successResponse({
        withdrawal,
        requires_confirmation:   true,
        confirmation_expires_at: otp.expiresAt,
        earnings_balance:        earningsDollars,
        kyc_bypassed:            usdAmount <= KYC_THRESHOLD,
        monetization_mode:       mon.mode,
      }, 201);
    }

    // POST /withdrawals/:id/confirm — verify the emailed OTP, debit, enter review
    {
      const seg = rawPath.split("/").filter(Boolean);
      if (seg.length === 2 && seg[1] === "confirm" && req.method === "POST") {
        const withdrawalId = seg[0];
        const body = await req.json().catch(() => ({}));
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!code) return errorResponse("code_required", 400);

        const admin = getAdminClient();
        const { data: w } = await admin
          .from("withdrawals")
          .select("id, user_id, amount, status, confirmation_code_hash, confirmation_expires_at, confirmation_attempts")
          .eq("id", withdrawalId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!w) return errorResponse("withdrawal_not_found", 404);
        if (w.status !== "awaiting_confirmation") {
          return errorResponse("withdrawal_not_awaiting_confirmation", 409);
        }
        if (!w.confirmation_code_hash || !w.confirmation_expires_at) {
          return errorResponse("code_not_requested", 400);
        }
        if (new Date(w.confirmation_expires_at).getTime() < Date.now()) {
          return errorResponse("code_expired", 400);
        }
        if ((w.confirmation_attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
          return errorResponse("code_locked", 429);
        }

        const codeHash = await sha256Hex(code);
        if (codeHash !== w.confirmation_code_hash) {
          await admin
            .from("withdrawals")
            .update({ confirmation_attempts: (w.confirmation_attempts ?? 0) + 1 })
            .eq("id", withdrawalId);
          return errorResponse("code_invalid", 400);
        }

        // Re-check balance at confirmation time (it may have changed since request).
        const amountNum = Number(w.amount ?? 0);
        const { data: profile } = await admin
          .from("profiles")
          .select("earnings_balance")
          .eq("id", user.id)
          .single();
        const earningsDollars = Number(profile?.earnings_balance ?? 0);
        if (amountNum > earningsDollars) {
          return errorResponse("insufficient_earnings", 400);
        }

        const now = new Date().toISOString();
        // Move to the review queue and clear the (now-consumed) OTP.
        const { data: confirmed, error: cErr } = await admin
          .from("withdrawals")
          .update({
            status:                 "pending",
            confirmed_at:           now,
            confirmation_code_hash: null,
          })
          .eq("id", withdrawalId)
          .eq("status", "awaiting_confirmation")   // guard against double-confirm race
          .select("id, amount, method, status, requested_at, confirmed_at, crypto_coin, crypto_network")
          .maybeSingle();

        if (cErr || !confirmed) return errorResponse("confirmation_failed", 409);

        // Debit earnings_balance + write the append-only transaction row (R-05).
        await admin
          .from("profiles")
          .update({ earnings_balance: (earningsDollars - amountNum).toFixed(2), updated_at: now })
          .eq("id", user.id);

        await admin.from("transactions").insert({
          user_id:     user.id,
          type:        "withdrawal",
          amount:      amountNum.toFixed(2),
          status:      "pending",
          reference:   confirmed.id,
          description: "Withdrawal request",
          created_at:  now,
        });

        const { data: updated } = await admin
          .from("profiles")
          .select("earnings_balance")
          .eq("id", user.id)
          .maybeSingle();

        return successResponse({
          withdrawal:       confirmed,
          earnings_balance: Number(updated?.earnings_balance ?? 0),
        });
      }

      // POST /withdrawals/:id/resend-otp — re-issue a fresh code for an unconfirmed request
      if (seg.length === 2 && seg[1] === "resend-otp" && req.method === "POST") {
        const withdrawalId = seg[0];
        if (!user.email) return errorResponse("account_missing_email", 400);

        const admin = getAdminClient();
        const { data: w } = await admin
          .from("withdrawals")
          .select("id, amount, method, status, profiles!withdrawals_user_id_fkey(full_name)")
          .eq("id", withdrawalId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!w) return errorResponse("withdrawal_not_found", 404);
        if (w.status !== "awaiting_confirmation") {
          return errorResponse("withdrawal_not_awaiting_confirmation", 409);
        }

        const otp = await makeOtp();
        await admin
          .from("withdrawals")
          .update({
            confirmation_code_hash:  otp.hash,
            confirmation_expires_at: otp.expiresAt,
            confirmation_attempts:   0,
          })
          .eq("id", withdrawalId);

        const prof = (w.profiles as unknown as { full_name?: string | null } | null) ?? null;
        sendOtpEmail({
          email:  user.email,
          name:   prof?.full_name ?? "",
          code:   otp.code,
          amount: Number(w.amount ?? 0),
          method: String(w.method),
        });

        return successResponse({ message: "Code sent", confirmation_expires_at: otp.expiresAt });
      }
    }

    // GET /withdrawals/supported-crypto — public (post-auth) metadata
    if (rawPath === "supported-crypto" && req.method === "GET") {
      return successResponse({
        coins: SUPPORTED_COINS,
        networks: SUPPORTED_NETWORKS,
      });
    }

    // GET /withdrawals/:withdrawal_id
    if (rawPath && rawPath !== "request" && rawPath !== "supported-crypto" && req.method === "GET") {
      const withdrawalId = rawPath;
      const { data, error } = await supabase
        .from("withdrawals")
        .select("id, amount, method, account_details, status, requested_at, completed_at, confirmed_at, confirmation_expires_at, rejection_reason, transaction_reference, crypto_coin, crypto_network, crypto_address")
        .eq("id", withdrawalId)
        .eq("user_id", user.id)
        .single();

      if (error || !data) return errorResponse("withdrawal_not_found", 404);
      return successResponse({ withdrawal: data });
    }

    // GET /withdrawals (list)
    if (!rawPath && req.method === "GET") {
      const page   = Math.max(1, parseInt(url.searchParams.get("page")   ?? "1"));
      const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const status = url.searchParams.get("status");
      const method = url.searchParams.get("method");
      const offset = (page - 1) * limit;

      let query = supabase
        .from("withdrawals")
        .select(
          "id, amount, method, status, requested_at, completed_at, confirmed_at, rejection_reason, transaction_reference, crypto_coin, crypto_network, crypto_address",
          { count: "exact" },
        )
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        const statuses = status.split("|");
        if (statuses.length === 1) query = query.eq("status", statuses[0]);
        else query = query.in("status", statuses);
      }
      if (method) query = query.eq("method", method);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch withdrawals", 500);

      return successResponse({
        withdrawals: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[withdrawals] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
