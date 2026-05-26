#!/usr/bin/env python3
"""Quiz4Win — full Games API exerciser.

Reads TEST_USER_EMAIL / TEST_USER_PASSWORD from .env, signs in, then walks
every customer /games/* route and every admin asset-upload field
(icon, thumbnail_url, host_avatar_url). Prints PASS / FAIL per call with
short body previews. Exit code is the number of FAILED calls.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("Q4W_API_BASE", "https://api.quiz4win.com")
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


ENV = load_env(ENV_PATH)
EMAIL = ENV.get("TEST_USER_EMAIL") or os.environ.get("TEST_USER_EMAIL")
PASSWORD = ENV.get("TEST_USER_PASSWORD") or os.environ.get("TEST_USER_PASSWORD")
if not EMAIL or not PASSWORD:
    print("Missing TEST_USER_EMAIL / TEST_USER_PASSWORD in .env", file=sys.stderr)
    sys.exit(2)

# Smallest valid PNG: 1x1 red pixel, 67 bytes.
PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

failures = 0
results: list[tuple[str, int, str, str]] = []  # (label, code, ok, preview)


def http(
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | bytes | None = None,
    content_type: str = "application/json",
    expect: set[int] | None = None,
) -> tuple[int, str]:
    url = f"{BASE}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data: bytes | None
    if isinstance(body, (bytes, bytearray)):
        data = bytes(body)
        headers["Content-Type"] = content_type
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    else:
        data = None

    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            code, txt = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, txt = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        code, txt = 0, f"EXC {type(e).__name__}: {e}"
    elapsed_ms = int((time.time() - started) * 1000)
    preview = txt.replace("\n", " ")[:220]
    accept = expect or {200, 201}
    ok = "PASS" if code in accept else "FAIL"
    global failures
    if ok == "FAIL":
        failures += 1
    results.append((f"{method} {path}", code, ok, preview))
    print(f"  [{ok}] {code:3d} {elapsed_ms:5d}ms  {method:6s} {path:50s} {preview}")
    return code, txt


def signin() -> str:
    print(f"\n=== Sign in as {EMAIL} ===")
    code, txt = http("POST", "/auth/signin", body={"email": EMAIL, "password": PASSWORD})
    if code != 200:
        print("Sign-in failed — aborting.", file=sys.stderr)
        sys.exit(1)
    payload = json.loads(txt)
    return (payload.get("data") or payload)["access_token"]


def multipart(fields: dict[str, str], file_field: str, filename: str, file_bytes: bytes, mime: str) -> tuple[bytes, str]:
    boundary = "----q4w" + base64.b16encode(os.urandom(8)).decode()
    buf = io.BytesIO()
    for k, v in fields.items():
        buf.write(f"--{boundary}\r\n".encode())
        buf.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        buf.write(v.encode() + b"\r\n")
    buf.write(f"--{boundary}\r\n".encode())
    buf.write(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode()
    )
    buf.write(f"Content-Type: {mime}\r\n\r\n".encode())
    buf.write(file_bytes)
    buf.write(f"\r\n--{boundary}--\r\n".encode())
    return buf.getvalue(), f"multipart/form-data; boundary={boundary}"


def pick_game_id(token: str) -> str | None:
    code, txt = http("GET", "/games?limit=1&status=upcoming|open|live", token=token)
    if code != 200:
        return None
    games = (json.loads(txt).get("data") or {}).get("games") or []
    return games[0]["id"] if games else None


def create_admin_game(token: str) -> str | None:
    """Fallback: spin up a throwaway upcoming game so the upload tests have a target."""
    payload = {
        "title": f"API-Test {int(time.time())}",
        "mode": "timed",
        "entry_fee": 0,
        "prize_pool": 0,
        "start_time": "2099-01-01T00:00:00Z",
        "questions_count": 5,
        "time_per_question": 15,
        "allowed_wrong_answers": 1,
    }
    code, txt = http("POST", "/admin/games", token=token, body=payload, expect={200, 201})
    if code not in (200, 201):
        return None
    g = (json.loads(txt).get("data") or {}).get("game") or {}
    return g.get("id")


def run_customer_games(token: str) -> str | None:
    print("\n=== Customer /games endpoints ===")
    http("GET", "/games", token=token)
    http("GET", "/games?status=open", token=token)
    http("GET", "/games?status=upcoming|open|live", token=token)
    http("GET", "/games?featured=true", token=token)
    http("GET", "/games?mode=timed&limit=5", token=token)
    http("GET", "/games?page=1&limit=3", token=token)

    gid = pick_game_id(token)
    if not gid:
        print("  (no game available to exercise per-game routes)")
        return None

    print(f"\n--- Per-game routes (game_id={gid}) ---")
    http("GET",    f"/games/{gid}", token=token)
    http("GET",    f"/games/{gid}/participants", token=token)
    http("GET",    f"/games/{gid}/leaderboard", token=token)
    # These are expected to 4xx until the user has actually played:
    http("GET",    f"/games/{gid}/result",   token=token, expect={200, 404})
    http("GET",    f"/games/{gid}/question", token=token, expect={200, 403, 404})
    # Join / leave (depends on balance + status — accept the common 4xx codes):
    http("POST",   f"/games/{gid}/join", token=token, body={}, expect={201, 400, 403, 409})
    http("DELETE", f"/games/{gid}/join", token=token, expect={200, 400, 404})
    # Submit-answer requires a question_id; just verify the validator:
    http("POST",   f"/games/{gid}/answer", token=token, body={}, expect={400})
    # Claim-prize is gated on having won — accept the documented codes:
    http("POST",   f"/games/{gid}/claim-prize", token=token, body={}, expect={200, 400, 404, 409})
    return gid


def run_admin_uploads(token: str, gid: str | None) -> None:
    print("\n=== Admin /admin/games/:id/asset uploads ===")
    target = gid
    if not target:
        target = create_admin_game(token)
    if not target:
        print("  (no game id to upload against — skipping)")
        return

    for field in ("icon", "thumbnail_url", "host_avatar_url"):
        body, ct = multipart({"field": field}, "file", f"{field}.png", PNG_1x1, "image/png")
        http(
            "POST",
            f"/admin/games/{target}/asset",
            token=token,
            body=body,
            content_type=ct,
            expect={200},
        )


def main() -> int:
    print(f"Quiz4Win games API test — base={BASE}")
    token = signin()
    gid = run_customer_games(token)
    run_admin_uploads(token, gid)

    print("\n=== Summary ===")
    total = len(results)
    passed = total - failures
    print(f"  {passed}/{total} passed, {failures} failed")
    if failures:
        print("\nFailures:")
        for label, code, ok, preview in results:
            if ok == "FAIL":
                print(f"  {code:3d}  {label}\n        {preview}")
    return failures


if __name__ == "__main__":
    sys.exit(main())
