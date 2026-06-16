#!/usr/bin/env python3
"""
Quiz4Win Host Platform smoke test against the production API.

Usage:
    python3 scripts/host-platform-smoke-test.py

The shared test account (AGENTS.md §8) signs in and exercises every read-side
host endpoint plus the unauth-guarded admin-side endpoint. No mutations are
performed and no secrets are ever printed.

Exit codes:
    0   all checks reached an expected outcome (200 / 404 not_a_host / 401 forbidden)
    1   .env credentials missing or sign-in failed
    2   one or more endpoints returned an unexpected status
"""
from __future__ import annotations
import json, re, sys, urllib.request, urllib.error
from typing import Optional, Tuple, Union

ENV_FILE = ".env"
API_BASE = "https://api.quiz4win.com"

# ── Load .env ────────────────────────────────────────────────────────────────
env = {}
with open(ENV_FILE) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"): continue
        m = re.match(r'^([A-Z0-9_]+)=(.+)$', line)
        if m: env[m.group(1)] = m.group(2)

email    = env.get("TEST_USER_EMAIL", "")
password = env.get("TEST_USER_PASSWORD", "")
anon_key = env.get("SUPABASE_ANON_KEY", "")

if not email or not password:
    print("ERROR: TEST_USER_EMAIL or TEST_USER_PASSWORD not set in .env")
    sys.exit(1)

# ── Helpers ──────────────────────────────────────────────────────────────────

def req(method, path, *, token=None, body=None):
    # type: (str, str, Optional[str], Optional[dict]) -> Tuple[int, Union[dict, str]]
    headers = {"Content-Type": "application/json"}
    if anon_key: headers["apikey"] = anon_key
    if token:    headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{API_BASE}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:    return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {"raw": e.reason}

# ── 1. Sign in ───────────────────────────────────────────────────────────────
print(f"=== Quiz4Win host-platform smoke test ===")
print(f"Target  : {API_BASE}")
print(f"Email   : {email}")
print()

status, body = req("POST", "/auth/signin", body={"email": email, "password": password})
if status != 200 or not body.get("access_token"):
    print(f"❌ sign-in failed (HTTP {status})")
    sys.exit(1)
token = body["access_token"]
user_id = (body.get("user") or {}).get("id", "?")
print(f"✅ signed in — user_id={user_id[:8]}…")

# ── 2. Probe host endpoints ──────────────────────────────────────────────────
# /host/me — for a non-host account this MUST be 404 not_a_host.
# For a host account it MUST be 200 with host body.
ok = []
def check(name, status, allow, note=""):
    badge = "✅" if status in allow else "❌"
    print(f"  {badge} {name:<46} HTTP {status:<3} {note}")
    ok.append(status in allow)

print("\n— GET /host/* —")
s, b = req("GET", "/host/me", token=token)
check("/host/me", s, [200, 404], f"({b.get('error', '')})" if s != 200 else f"(host={b.get('host', {}).get('id', '')[:8]}…)")

# Available games — endpoint requires a host row; expected 404 not_a_host for the test user.
s, b = req("GET", "/host/games/available", token=token)
check("/host/games/available", s, [200, 404], f"({len(b.get('games', []))} games)" if s == 200 else "")
s, b = req("GET", "/host/games/upcoming", token=token)
check("/host/games/upcoming", s, [200, 404])
s, b = req("GET", "/host/games/history", token=token)
check("/host/games/history", s, [200, 404])
s, b = req("GET", "/host/games/requests", token=token)
check("/host/games/requests", s, [200, 404])
s, b = req("GET", "/host/invitations", token=token)
check("/host/invitations", s, [200, 404])
s, b = req("GET", "/host/earnings", token=token)
check("/host/earnings", s, [200, 404])
s, b = req("GET", "/host/payment-methods", token=token)
check("/host/payment-methods", s, [200, 404])

# Unknown sub-path: should be 404 not_found.
s, _ = req("GET", "/host/whatever-bogus", token=token)
check("/host/whatever-bogus", s, [404])

# ── 3. Admin endpoint must be 401 / 403 for a non-admin token ─────────────────
print("\n— GET /admin/hosts (negative test) —")
s, b = req("GET", "/admin/hosts", token=token)
check("/admin/hosts (without admin role)", s, [401, 403])

# ── 4. Schedule-conflict guard — POST without being a host returns 404 ───────
print("\n— Negative writes —")
s, b = req("POST", "/host/games/00000000-0000-0000-0000-000000000000/request", token=token, body={})
check("/host/games/:id/request (non-host)", s, [403, 404])

print("\n— summary —")
print(f"  {sum(ok)}/{len(ok)} endpoints in expected range")
sys.exit(0 if all(ok) else 2)
