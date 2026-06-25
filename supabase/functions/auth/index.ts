/**
 * Auth Edge Function — Quiz4Win
 *
 * Handles all authentication routes for the customer app:
 *   POST /auth/signup   (alias /auth/register) — Register new user (API #1)
 *   POST /auth/signin   (alias /auth/login)    — Email + password sign in (API #2)
 *   POST /auth/token                           — Refresh access token (API #3)
 *   POST /auth/signout  (alias /auth/logout)   — Revoke current session (API #4)
 *   POST /auth/forgot-password   — Send OTP email (API #5)
 *   POST /auth/verify-otp        — Verify password-reset OTP (API #6)
 *   POST /auth/update-password   — Set new password post-OTP (API #7)
 *   POST /auth/change-password   — Logged-in password change (verifies current pwd)
 *
 * Rule compliance: R-01 (no secrets in code), R-03 (JWT validated before writes)
 */

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, tooManyRequests } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient, getPublicClient } from "../_shared/supabase.ts";
import { sendEmail, confirmEmailTemplate, recoveryTemplate, hostWelcomeTemplate, adminHostEventTemplate } from "../_shared/email.ts";

// Common frontend naming aliases → canonical backend paths. Lets the iOS
// and admin apps call either `/auth/login` or `/auth/signin` etc. without
// the customer team having to track which spelling we picked.
const PATH_ALIASES: Record<string, string> = {
  login: "signin",
  logout: "signout",
  register: "signup",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/^\/auth/, "").replace(/^\//, "");
  const path = PATH_ALIASES[rawPath] ?? rawPath;

  try {
    // ── POST /auth/signup ──────────────────────────────────────────────────
    if (path === "signup" && req.method === "POST") {
      const { name, email: rawEmail, password, referral_code, flow } = await req.json();
      // Normalize the email defensively — native clients may send it with
      // trailing/leading whitespace or mixed case, which GoTrue's RFC
      // validator rejects as "invalid format". The web app trims client-side,
      // but mobile does not, so we always normalize here.
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
      if (!email || !password || !name) {
        return errorResponse("Missing required fields: name, email, password", 400);
      }
      // flow='otp' suppresses the magic-link button in the confirmation email
      // and surfaces the OTP code as the primary call-to-action. Used by the
      // host-app where a mail scanner pre-fetching the link would silently
      // burn the underlying GoTrue token and make the OTP unusable.
      const otpOnlyFlow = flow === "otp";

      const admin = getAdminClient();

      // Validate referral code if provided (no `is_active` column in schema).
      if (referral_code) {
        const { data: rc } = await admin
          .from("referral_codes")
          .select("code, expires_at, max_uses, use_count")
          .eq("code", referral_code)
          .single();
        if (!rc) return errorResponse("invalid_referral", 400);
        if (rc.expires_at && new Date(rc.expires_at) < new Date()) {
          return errorResponse("invalid_referral", 400);
        }
        if (rc.max_uses !== null && rc.use_count >= rc.max_uses) {
          return errorResponse("invalid_referral", 400);
        }
      }

      // Create the user and generate the email-confirmation link in one admin
      // call. Unlike supabase.auth.signUp(), generateLink() does NOT trigger
      // Supabase's default (unbranded) confirmation email, so we send our own
      // branded one via Brevo with a redirect we control (R-01: no secrets).
      const redirectTo = (Deno.env.get("EMAIL_CONFIRM_REDIRECT_URL") ??
        ((Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "") + "/auth/callback"));

      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { data: { full_name: name, referral_code: referral_code ?? null }, redirectTo },
      });
      if (error) {
        console.warn(`[auth] signup failed for ${email}: ${error.message}`);
        const msg = error.message.toLowerCase();
        if (msg.includes("already registered") || msg.includes("already been registered")) {
          return errorResponse("email_taken", 409);
        }
        if (msg.includes("password")) {
          return errorResponse("weak_password", 400);
        }
        return errorResponse(error.message, 400);
      }

      // Create the profiles row (auth only writes to auth.users). Use the admin
      // client so we bypass RLS on first insert, then continue regardless of
      // duplicate-key races (e.g. retry after a transient error).
      if (data.user) {
        const { error: profileErr } = await admin.from("profiles").insert({
          id: data.user.id,
          email: data.user.email,
          full_name: name,
        });
        if (profileErr && !profileErr.message.toLowerCase().includes("duplicate")) {
          console.warn(`[auth] profile insert failed for ${email}: ${profileErr.message}`);
        }

        // Wire referral: create referral_uses row (trigger auto-increments
        // use_count), then pay the referee their welcome bonus immediately
        // (INV-08, Option B — referrer bonus fires on first paid game join).
        if (referral_code && data.user.id) {
          try {
            const { data: rc } = await admin
              .from("referral_codes")
              .select("owner_id")
              .eq("code", referral_code.toUpperCase())
              .single();

            if (rc?.owner_id && rc.owner_id !== data.user.id) {
              // UNIQUE on referred_user_id — idempotent on retry.
              const { data: useRow } = await admin
                .from("referral_uses")
                .insert({
                  code: referral_code.toUpperCase(),
                  referred_user_id: data.user.id,
                  referrer_user_id: rc.owner_id,
                })
                .select("id")
                .single();

              if (useRow?.id) {
                await admin.rpc("pay_referee_bonus", { p_referral_use_id: useRow.id });
              }
            }
          } catch (refErr) {
            // Non-fatal: referral bonus failure must never block signup.
            console.warn(`[auth] referral wiring failed user=${data.user.id}:`, (refErr as Error).message);
          }
        }
      }

      // Send the branded confirmation email — non-blocking so a Brevo hiccup
      // never fails the signup. For `flow:'otp'` we omit the action_link to
      // immunise the OTP against mail-scanner prefetch (they share one GoTrue
      // token; a prefetched link kills the OTP too).
      const actionUrl = (data.properties as { action_link?: string } | null)?.action_link;
      const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
      if (data.user?.email && (otpOnlyFlow ? otp : actionUrl)) {
        const tpl = confirmEmailTemplate({
          name,
          actionUrl: otpOnlyFlow ? "" : (actionUrl ?? ""),
          otp,
          otpOnly: otpOnlyFlow,
        });
        sendEmail({ to: { email: data.user.email, name }, ...tpl }).catch((err) =>
          console.warn("[auth] confirmation email failed:", err)
        );
      } else {
        console.warn(`[auth] signup: no action_link/otp generated for ${email}`);
      }

      return successResponse({ user: data.user, requires_confirmation: true }, 201);
    }

    // ── POST /auth/signin ──────────────────────────────────────────────────
    if (path === "signin" && req.method === "POST") {
      const { email: rawEmail, password } = await req.json();
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
      if (!email || !password) return errorResponse("Missing email or password", 400);

      const supabase = getPublicClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.warn(`[auth] signin failed for ${email}: ${error.message}`);
        if (error.message.toLowerCase().includes("invalid")) {
          return errorResponse("invalid_credentials", 401);
        }
        return errorResponse(error.message, 401);
      }

      // Check if account is suspended/banned
      const admin = getAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .single();
      if (profile?.status === "suspended" || profile?.status === "banned") {
        await supabase.auth.signOut();
        return errorResponse("account_suspended", 403);
      }

      return successResponse({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_in: data.session?.expires_in ?? 3600,
      });
    }

    // ── POST /auth/token (refresh) ─────────────────────────────────────────
    if (path === "token" && req.method === "POST") {
      const { grant_type, refresh_token } = await req.json();
      if (grant_type !== "refresh_token" || !refresh_token) {
        return errorResponse("grant_type must be refresh_token and refresh_token is required", 400);
      }
      const supabase = getPublicClient();
      const { data, error } = await supabase.auth.refreshSession({ refresh_token });
      if (error) {
        const code = error.message.toLowerCase().includes("expired") ? "token_expired" : "token_revoked";
        return errorResponse(code, 401);
      }
      return successResponse({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_in: data.session?.expires_in ?? 3600,
      });
    }

    // ── POST /auth/signout ─────────────────────────────────────────────────
    if (path === "signout" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const supabase = getAnonClient(req);
      await supabase.auth.signOut();
      return successResponse({ message: "Signed out successfully" });
    }

    // ── POST /auth/forgot-password ─────────────────────────────────────────
    // Generates the recovery link via the admin client (no email is sent by
    // Supabase) and dispatches our own branded email through Brevo so the
    // customer receives the same Q4W look-and-feel as every other transactional
    // message (R-01: no secrets exposed; always returns 200 to prevent
    // account-enumeration regardless of whether the email exists).
    if (path === "forgot-password" && req.method === "POST") {
      const { email: rawEmail } = await req.json();
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
      if (!email) return errorResponse("email is required", 400);
      const redirectTo = (Deno.env.get("APP_URL") ?? "https://app.quiz4win.com")
        .replace(/\/$/, "") + "/auth/reset-password";

      // Fire-and-forget — never block the response on email work, never leak
      // whether the account exists via timing or error codes.
      (async () => {
        try {
          const admin = getAdminClient();
          const { data, error } = await admin.auth.admin.generateLink({
            type: "recovery",
            email,
            options: { redirectTo },
          });
          if (error || !data) {
            console.warn(`[auth] generateLink failed for ${email}: ${error?.message ?? "no data"}`);
            return;
          }
          const actionUrl = (data.properties as { action_link?: string } | null)?.action_link;
          const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
          if (!actionUrl) {
            console.warn(`[auth] generateLink returned no action_link for ${email}`);
            return;
          }
          // Pull the customer's display name from profiles for personalisation.
          let name = "";
          if (data.user?.id) {
            const { data: profile } = await admin
              .from("profiles")
              .select("full_name")
              .eq("id", data.user.id)
              .maybeSingle();
            name = (profile?.full_name as string | null | undefined) ?? "";
          }
          const tpl = recoveryTemplate({ name, actionUrl, otp });
          await sendEmail({ to: { email, name: name || undefined }, ...tpl });
        } catch (err) {
          console.warn("[auth] recovery email failed:", err);
        }
      })();

      return successResponse({ message: "OTP sent if account exists" });
    }

    // ── POST /auth/verify-otp ──────────────────────────────────────────────
    // Accepts:
    //   type='recovery' — password-reset OTP from /auth/forgot-password
    //   type='signup' (or 'email') — email-confirmation OTP from /auth/signup
    //                                  (host-app sign-up flow uses this)
    if (path === "verify-otp" && req.method === "POST") {
      const { email: rawEmail, token, type } = await req.json();
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
      const normType: "recovery" | "signup" | null =
        type === "recovery" ? "recovery"
        : (type === "signup" || type === "email") ? "signup"
        : null;
      if (!email || !token || !normType) {
        return errorResponse("email, token, and type in (recovery|signup|email) are required", 400);
      }
      const supabase = getPublicClient();
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: normType });
      if (error) {
        // For signup confirmations, a mail-scanner / link-prefetcher can
        // silently burn the underlying GoTrue token before the user types
        // the OTP — GoTrue then returns expired/invalid even though the
        // email is now confirmed. Detect that case and surface a distinct
        // status so the client can route the user straight to sign-in.
        if (normType === "signup") {
          try {
            const admin = getAdminClient();
            // SECURITY DEFINER RPC — auth schema isn't exposed via PostgREST,
            // so we bridge through public.auth_email_confirmed. If the email
            // is already confirmed, the link was prefetched (mail scanner /
            // preview) and burned the OTP token along with it.
            const { data: confirmed } = await admin.rpc("auth_email_confirmed", {
              p_email: String(email),
            });
            if (confirmed === true) {
              return errorResponse("already_confirmed", 409);
            }
          } catch (_) { /* fall through to standard error */ }
        }
        const code = error.message.toLowerCase().includes("expired") ? "otp_expired" : "otp_invalid";
        return errorResponse(code, error.message.includes("expired") ? 401 : 400);
      }
      // Fire welcome email to the host + admin new-user notification after a
      // successful signup OTP. Best-effort only — never blocks the response.
      if (normType === "signup" && data.user?.email) {
        const userEmail = data.user.email;
        const userName: string = (data.user.user_metadata?.full_name as string | undefined) ?? "";
        (async () => {
          try {
            const tpl = hostWelcomeTemplate({ name: userName });
            await sendEmail({ to: { email: userEmail, name: userName || undefined }, ...tpl });
          } catch (e) {
            console.warn("[auth] welcome email failed:", e);
          }
          try {
            const adminEmail = Deno.env.get("ADMIN_EMAIL");
            if (adminEmail) {
              const tpl = adminHostEventTemplate({
                heading: "New host registered",
                intro: "A new host has verified their email and joined Quiz4Win.",
                rows: [
                  ["Name", userName || "(not set)"],
                  ["Email", userEmail],
                  ["User ID", data.user!.id],
                ],
              });
              await sendEmail({ to: { email: adminEmail }, ...tpl });
            }
          } catch (e) {
            console.warn("[auth] admin new-host notification failed:", e);
          }
        })();
      }

      return successResponse({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        user: data.user,
      });
    }

    // ── POST /auth/resend-confirmation ─────────────────────────────────────
    // Re-mints the signup confirmation link via the admin client and re-sends
    // the branded email through Brevo. Always returns 200 to avoid leaking
    // account existence (R-01).
    if (path === "resend-confirmation" && req.method === "POST") {
      const { email: rawEmail, flow } = await req.json();
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
      if (!email) return errorResponse("email is required", 400);
      const otpOnlyFlow = flow === "otp";
      const redirectTo = (Deno.env.get("EMAIL_CONFIRM_REDIRECT_URL") ??
        ((Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "") + "/auth/callback"));
      (async () => {
        try {
          const admin = getAdminClient();
          const { data, error } = await admin.auth.admin.generateLink({
            type: "signup", email, options: { redirectTo },
          });
          if (error || !data) {
            console.warn(`[auth] resend-confirmation: generateLink failed for ${email}: ${error?.message ?? "no data"}`);
            return;
          }
          const actionUrl = (data.properties as { action_link?: string } | null)?.action_link;
          const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
          if (data.user?.email && (otpOnlyFlow ? otp : actionUrl)) {
            const tpl = confirmEmailTemplate({
              name: data.user.user_metadata?.full_name ?? "",
              actionUrl: otpOnlyFlow ? "" : (actionUrl ?? ""),
              otp,
              otpOnly: otpOnlyFlow,
            });
            sendEmail({ to: { email: data.user.email, name: data.user.user_metadata?.full_name ?? "" }, ...tpl }).catch((err) =>
              console.warn("[auth] resend-confirmation email failed:", err),
            );
          }
        } catch (e) {
          console.warn(`[auth] resend-confirmation threw: ${(e as Error).message}`);
        }
      })();
      return successResponse({ message: "If the email exists, a confirmation has been re-sent." });
    }

    // ── POST /auth/update-password ─────────────────────────────────────────
    // Works for both flows:
    //  - In-app OTP flow: token comes from /auth/verify-otp.
    //  - Magic-link Universal Link flow: token comes from the URL hash
    //    fragment of the recovery email (#access_token=…).
    // Authorization: Bearer <access_token>
    // Body: { new_password }
    if (path === "update-password" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { new_password } = await req.json();
      if (!new_password || new_password.length < 8) {
        return errorResponse("weak_password", 400);
      }
      // Use the admin client to update the password. The anon client's
      // auth.updateUser() relies on an internal session that we never
      // establish here (we only forward the Bearer token), so it would
      // fail with "Auth session missing". The user id was already verified
      // by validateJWT via supabase.auth.getUser().
      const admin = getAdminClient();
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password: new_password,
      });
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("password")) return errorResponse("weak_password", 400);
        return errorResponse(error.message, 400);
      }
      return successResponse({ message: "Password updated" });
    }

    // ── POST /auth/change-password ─────────────────────────────────────────
    // For a signed-in user who knows their current password. Verifies the
    // current password by attempting a sign-in (no session is established —
    // we discard the returned tokens), then updates via the admin client.
    if (path === "change-password" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);

      const { current_password, new_password } = await req.json();
      if (!current_password || !new_password) {
        return errorResponse("current_password and new_password are required", 400);
      }
      if (new_password.length < 8) return errorResponse("weak_password", 400);
      if (current_password === new_password) {
        return errorResponse("new_password_same_as_current", 400);
      }
      if (!user.email) return errorResponse("account_missing_email", 400);

      const supabase = getPublicClient();
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current_password,
      });
      if (verifyErr) {
        console.warn(`[auth] change-password — current_password verify failed user=${user.id}`);
        return errorResponse("invalid_current_password", 401);
      }

      const admin = getAdminClient();
      const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
        password: new_password,
      });
      if (updErr) {
        const msg = updErr.message.toLowerCase();
        if (msg.includes("password")) return errorResponse("weak_password", 400);
        console.error(`[auth] change-password — updateUserById failed user=${user.id}: ${updErr.message}`);
        return errorResponse(updErr.message, 400);
      }
      return successResponse({ message: "Password updated" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[auth] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
