#!/usr/bin/env python3
"""
Smoke-test: POST /auth/signin with TEST_USER_EMAIL + TEST_USER_PASSWORD from .env
Prints status, response shape, and whether a JWT was returned — never prints secrets.
"""
import json, re, urllib.request, urllib.error

ENV_FILE = ".env"
API_BASE = "https://api.quiz4win.com"

# ── Load .env (key-value only, skip comments) ────────────────────────────────
env = {}
with open(ENV_FILE) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^([A-Z0-9_]+)=(.+)$', line)
        if m:
            env[m.group(1)] = m.group(2)

email    = env.get("TEST_USER_EMAIL", "")
password = env.get("TEST_USER_PASSWORD", "")
anon_key = env.get("SUPABASE_ANON_KEY", "")

if not email or not password:
    print("ERROR: TEST_USER_EMAIL or TEST_USER_PASSWORD not set in .env")
    raise SystemExit(1)

print(f"Target  : {API_BASE}/auth/signin")
print(f"Email   : {email}")
print(f"Password: {'*' * len(password)} (len={len(password)})")
print()

# ── POST /auth/signin ─────────────────────────────────────────────────────────
payload = json.dumps({"email": email, "password": password}).encode()
req = urllib.request.Request(
    f"{API_BASE}/auth/signin",
    data=payload,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "apikey": anon_key,
    },
)

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        status = resp.status
        body   = json.loads(resp.read())
except urllib.error.HTTPError as e:
    status = e.code
    try:
        body = json.loads(e.read())
    except Exception:
        body = {"raw": e.reason}

# ── Report (no secrets in output) ────────────────────────────────────────────
print(f"HTTP status : {status}")

if status == 200:
    access  = body.get("access_token", "")
    refresh = body.get("refresh_token", "")
    user    = body.get("user", {})
    print(f"access_token  : {'PRESENT' if access  else 'ABSENT'} (len={len(access)})")
    print(f"refresh_token : {'PRESENT' if refresh else 'ABSENT'} (len={len(refresh)})")
    print(f"user.id       : {user.get('id', 'N/A')}")
    print(f"user.email    : {user.get('email', 'N/A')}")
    print()
    print("RESULT: ✅  LOGIN OK — credentials are valid and API is reachable")
else:
    print(f"error body  : {json.dumps(body)}")
    print()
    print(f"RESULT: ❌  LOGIN FAILED (status={status})")
