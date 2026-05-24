#!/usr/bin/env python3
"""Quiz4Win customer API smoke test.
Reads JWT from /tmp/q4w_token. Prints status + short response preview for each route.
"""
import json, sys, urllib.request, urllib.error

BASE = "https://api.quiz4win.com"
try:
    with open("/tmp/q4w_token") as f:
        TOK = f.read().strip()
except FileNotFoundError:
    print("Missing /tmp/q4w_token — sign in first.", file=sys.stderr)
    sys.exit(1)

HDRS = {"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"}

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=HDRS)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            code, txt = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, txt = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        code, txt = 0, f"EXC {e}"
    preview = txt.replace("\n", " ")[:240]
    print(f"{code:3d}  {method:6s} {path:38s} {preview}")

TESTS = [
    ("GET", "/profile"),
    ("GET", "/wallet/balance"),
    ("GET", "/wallet/transactions"),
    ("GET", "/settings"),
    ("GET", "/notifications"),
    ("GET", "/config/app"),
    ("GET", "/legal/tos"),
    ("GET", "/legal/privacy"),
    ("GET", "/leaderboard/global"),
    ("GET", "/support/articles"),
    ("GET", "/support/tickets"),
    ("GET", "/referrals/my-code"),
    ("GET", "/referrals/stats"),
    ("GET", "/kyc/status"),
    ("GET", "/topup/crypto/address"),
    ("GET", "/withdrawals"),
    ("GET", "/games"),
    ("GET", "/vouchers/my-redemptions"),
]

if __name__ == "__main__":
    for m, p in TESTS:
        call(m, p)
