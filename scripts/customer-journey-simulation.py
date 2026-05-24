#!/usr/bin/env python3
"""Quiz4Win end-to-end customer journey simulation.

Acts as a real customer would: signs in, fetches/updates profile, uploads an
avatar, browses games, checks wallet/notifications/settings, submits a support
ticket, attempts top-up/withdrawal flows, etc.

Outputs two artefacts:
  1. Console log with per-step status.
  2. customer-journey-results.csv — one row per tested API for direct paste
     into the "Quiz4win - APIs" Google Sheet "Customer Simulation Test Result"
     column. Columns: Endpoint, Method, Tested, Scenario, Request, Response,
     Error, Fix, Final.
"""
from __future__ import annotations
import csv, io, json, os, sys, time, urllib.request, urllib.error

BASE  = os.environ.get("Q4W_BASE", "https://api.quiz4win.com")
EMAIL = os.environ.get("Q4W_EMAIL", "majid.sadeghi.alavijeh@gmail.com")
PWD   = os.environ.get("Q4W_PWD", "P@ssw0rd")
CSV_OUT = "customer-journey-results.csv"

results: list[dict] = []

def record(endpoint, method, scenario, req_status, resp_status, err="", fix="", final=""):
    results.append({
        "Endpoint": endpoint, "Method": method, "Tested": "Yes",
        "Scenario": scenario, "Request": req_status, "Response": resp_status,
        "Error": err, "Fix": fix, "Final": final or ("PASS" if 200 <= resp_status < 300 else "FAIL"),
    })

def call(method, path, body=None, token=None, raw=False, content_type="application/json"):
    url = f"{BASE}{path}"
    headers = {}
    if token: headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        if raw:
            data = body
            headers["Content-Type"] = content_type
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, f"EXC {e}"

def jline(s, n=160):
    return s.replace("\n", " ")[:n]

def step(title): print(f"\n=== {title} ===")

# ------------------------------------------------------------------ AUTH
step("1. Sign in")
code, body = call("POST", "/auth/signin", {"email": EMAIL, "password": PWD})
print(f"  POST /auth/signin -> {code}  {jline(body)}")
record("/auth/signin", "POST", "Login with valid credentials", "sent", code,
       err="" if code == 200 else jline(body, 200))
if code != 200:
    print("FATAL: cannot sign in; aborting customer journey."); sys.exit(1)
tok = json.loads(body)["access_token"]

# ------------------------------------------------------------------ PROFILE
step("2. Profile")
for ep in ("/profile",):
    c, b = call("GET", ep, token=tok)
    print(f"  GET {ep} -> {c}  {jline(b)}")
    record(ep, "GET", "Fetch own profile after login", "sent", c, err="" if c==200 else jline(b,200))

c, b = call("PATCH", "/profile", {"name": "Majid Sadeghi", "language": "en", "nationality": "IR"}, token=tok)
print(f"  PATCH /profile -> {c}  {jline(b)}")
record("/profile", "PATCH", "Update display name + language + nationality", "sent", c,
       err="" if c==200 else jline(b,200))

# Avatar upload (multipart). Build a tiny PNG in-memory.
PNG = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C63"
    "6000010000000500010D0A2DB40000000049454E44AE426082"
)
boundary = "----q4wjourney"
mp = (f"--{boundary}\r\n"
      f"Content-Disposition: form-data; name=\"avatar\"; filename=\"a.png\"\r\n"
      f"Content-Type: image/png\r\n\r\n").encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
c, b = call("POST", "/profile/avatar", body=mp, token=tok, raw=True,
            content_type=f"multipart/form-data; boundary={boundary}")
print(f"  POST /profile/avatar -> {c}  {jline(b)}")
record("/profile/avatar", "POST", "Upload 1x1 PNG avatar", "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ SETTINGS
step("3. Settings")
c, b = call("GET", "/settings", token=tok); print(f"  GET /settings -> {c}  {jline(b)}")
record("/settings", "GET", "Fetch settings", "sent", c, err="" if c==200 else jline(b,200))
c, b = call("PATCH", "/settings", {"theme": "dark", "sound_enabled": True, "haptics_enabled": False}, token=tok)
print(f"  PATCH /settings -> {c}  {jline(b)}")
record("/settings", "PATCH", "Update theme/sound/haptics", "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ WALLET
step("4. Wallet")
for m, p, sc in [("GET", "/wallet/balance", "Read balance"),
                 ("GET", "/wallet/transactions", "List transactions")]:
    c, b = call(m, p, token=tok); print(f"  {m} {p} -> {c}  {jline(b)}")
    record(p, m, sc, "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ GAMES
step("5. Games")
c, b = call("GET", "/games?limit=10", token=tok); print(f"  GET /games -> {c}  {jline(b)}")
record("/games", "GET", "Browse upcoming games", "sent", c, err="" if c==200 else jline(b,200))
games = json.loads(b).get("games", []) if c == 200 else []
if games:
    gid = games[0]["id"]
    c, b = call("GET", f"/games/{gid}", token=tok); print(f"  GET /games/{gid} -> {c}  {jline(b)}")
    record(f"/games/:id", "GET", "Game details", "sent", c, err="" if c==200 else jline(b,200))
    c, b = call("POST", f"/games/{gid}/join", token=tok); print(f"  POST /games/{gid}/join -> {c}  {jline(b)}")
    record("/games/:id/join", "POST", "Attempt to join first game", "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ LEADERBOARD
step("6. Leaderboard")
c, b = call("GET", "/leaderboard/global", token=tok); print(f"  GET /leaderboard/global -> {c}  {jline(b)}")
record("/leaderboard/global", "GET", "Global leaderboard", "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ NOTIFICATIONS
step("7. Notifications")
c, b = call("GET", "/notifications", token=tok); print(f"  GET /notifications -> {c}  {jline(b)}")
record("/notifications", "GET", "Inbox", "sent", c, err="" if c==200 else jline(b,200))
c, b = call("POST", "/notifications/push-token",
            {"token":"jrny_dev_tok","platform":"ios","device_id":"jrny-device-1"}, token=tok)
print(f"  POST /notifications/push-token -> {c}  {jline(b)}")
record("/notifications/push-token","POST","Register dummy push token","sent",c,err="" if c<300 else jline(b,200))

# ------------------------------------------------------------------ KYC
step("8. KYC")
c, b = call("GET", "/kyc/status", token=tok); print(f"  GET /kyc/status -> {c}  {jline(b)}")
record("/kyc/status", "GET", "Check KYC verification status", "sent", c, err="" if c==200 else jline(b,200))

# KYC submit is a single multipart request bundling id_front + selfie + document_type.
def kyc_part(name, value, filename=None, ctype=None):
    head = f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\""
    if filename: head += f"; filename=\"{filename}\""
    head += "\r\n"
    if ctype: head += f"Content-Type: {ctype}\r\n"
    head += "\r\n"
    if isinstance(value, bytes):
        return head.encode() + value + b"\r\n"
    return head.encode() + str(value).encode() + b"\r\n"

mp2 = (kyc_part("document_type", "passport")
       + kyc_part("id_front", PNG, "idfront.png", "image/png")
       + kyc_part("selfie", PNG, "selfie.png", "image/png")
       + f"--{boundary}--\r\n".encode())
c, b = call("POST", "/kyc/submit", body=mp2, token=tok, raw=True,
            content_type=f"multipart/form-data; boundary={boundary}")
print(f"  POST /kyc/submit -> {c}  {jline(b)}")
record("/kyc/submit", "POST", "Submit KYC with id_front + selfie + document_type (multipart)",
       "sent", c, err="" if c<300 else jline(b,200))

# ------------------------------------------------------------------ TOP-UP
step("9. Top-up")
c, b = call("GET", "/topup/crypto/address?currency=USDT&network=trc20", token=tok)
print(f"  GET /topup/crypto/address -> {c}  {jline(b)}")
record("/topup/crypto/address", "GET", "Request crypto deposit address", "sent", c,
       err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ WITHDRAWALS
step("10. Withdrawals")
c, b = call("GET", "/withdrawals", token=tok); print(f"  GET /withdrawals -> {c}  {jline(b)}")
record("/withdrawals", "GET", "List withdrawal requests", "sent", c, err="" if c==200 else jline(b,200))

# Try to create a withdrawal — expect KYC/limits error since balance=$0.
c, b = call("POST", "/withdrawals/request", {
    "amount_cents": 1000, "method": "crypto",
    "account_details": {"network": "trc20", "address": "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
}, token=tok)
print(f"  POST /withdrawals/request -> {c}  {jline(b)}")
record("/withdrawals/request", "POST", "Request withdrawal (expect fail - no balance/KYC)",
       "sent", c, err="" if c<300 else jline(b,200),
       final="EXPECTED-FAIL" if 400 <= c < 500 else ("PASS" if c<300 else "FAIL"))

# ------------------------------------------------------------------ REFERRALS
step("11. Referrals")
c, b = call("GET", "/referrals/my-code", token=tok); print(f"  GET /referrals/my-code -> {c}  {jline(b)}")
record("/referrals/my-code", "GET", "Fetch or auto-create own referral code",
       "sent", c, err="" if c==200 else jline(b,200))
c, b = call("GET", "/referrals/stats", token=tok); print(f"  GET /referrals/stats -> {c}  {jline(b)}")
record("/referrals/stats", "GET", "Referral stats", "sent", c, err="" if c==200 else jline(b,200))
c, b = call("POST", "/referrals/validate", {"code": "NOPE-DOES-NOT-EXIST"}, token=tok)
print(f"  POST /referrals/validate -> {c}  {jline(b)}")
record("/referrals/validate", "POST", "Validate non-existent code (expect valid=false)",
       "sent", c, err="" if c<300 else jline(b,200))

# ------------------------------------------------------------------ VOUCHERS
step("12. Vouchers")
c, b = call("GET", "/vouchers/my-redemptions", token=tok); print(f"  GET /vouchers/my-redemptions -> {c}  {jline(b)}")
record("/vouchers/my-redemptions", "GET", "List own voucher redemptions", "sent", c,
       err="" if c==200 else jline(b,200))
c, b = call("POST", "/vouchers/validate", {"code": "NOPE-VOUCHER"}, token=tok)
print(f"  POST /vouchers/validate -> {c}  {jline(b)}")
record("/vouchers/validate", "POST", "Validate non-existent voucher (expect valid=false)",
       "sent", c, err="" if c<300 else jline(b,200))

# ------------------------------------------------------------------ SUPPORT
step("13. Support")
c, b = call("GET", "/support/articles", token=tok); print(f"  GET /support/articles -> {c}  {jline(b)}")
record("/support/articles", "GET", "Help articles", "sent", c, err="" if c==200 else jline(b,200))
c, b = call("GET", "/support/tickets", token=tok); print(f"  GET /support/tickets -> {c}  {jline(b)}")
record("/support/tickets", "GET", "List own tickets", "sent", c, err="" if c==200 else jline(b,200))
c, b = call("POST", "/support/tickets",
            {"subject":"Smoke test","category":"other","message":"Hello from journey script."}, token=tok)
print(f"  POST /support/tickets -> {c}  {jline(b)}")
record("/support/tickets", "POST", "Open a new ticket", "sent", c, err="" if c<300 else jline(b,200))

# ------------------------------------------------------------------ LEGAL / CONFIG
step("14. Legal & app config")
for ep, sc in [("/config/app","App config"), ("/legal/tos","ToS"), ("/legal/privacy","Privacy")]:
    c, b = call("GET", ep, token=tok); print(f"  GET {ep} -> {c}  {jline(b)}")
    record(ep, "GET", sc, "sent", c, err="" if c==200 else jline(b,200))

# ------------------------------------------------------------------ DUMP CSV
with open(CSV_OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["Endpoint","Method","Tested","Scenario",
                                       "Request","Response","Error","Fix","Final"])
    w.writeheader()
    w.writerows(results)

passed = sum(1 for r in results if r["Final"] == "PASS")
expfail = sum(1 for r in results if r["Final"] == "EXPECTED-FAIL")
failed  = sum(1 for r in results if r["Final"] == "FAIL")
print(f"\n=== SUMMARY ===\n  PASS:           {passed}\n  EXPECTED-FAIL:  {expfail}\n  FAIL:           {failed}")
print(f"\nCSV written to: {CSV_OUT}")


