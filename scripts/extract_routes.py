"""
Extract HTTP routes from customer-facing Supabase edge functions.

We look at each file in supabase/functions/<name>/index.ts (skipping admin-* and _*)
and try to detect patterns like:
  if (path === "foo" && req.method === "POST")
  if (path.startsWith("foo/") && req.method === "GET")
  if (/^foo\/[^/]+\/bar$/.test(path) && req.method === "POST")
"""
import os, re, json

CUSTOMER_MODULES = [
    "auth", "config", "games", "kyc", "leaderboard", "legal",
    "notifications", "profile", "referrals", "security", "settings",
    "support", "topup", "vouchers", "wallet", "withdrawals",
]

BASE = "supabase/functions"

# Regex patterns to detect routes
PATTERNS = [
    # path === "x" && req.method === "POST"
    re.compile(r'path\s*===\s*"([^"]*)"\s*&&\s*req\.method\s*===\s*"(GET|POST|PATCH|PUT|DELETE)"'),
    # req.method === "POST" && path === "x"
    re.compile(r'req\.method\s*===\s*"(GET|POST|PATCH|PUT|DELETE)"\s*&&\s*path\s*===\s*"([^"]*)"'),
    # path.startsWith("x/") && req.method === "GET"
    re.compile(r'path\.startsWith\("([^"]*)"\)\s*&&\s*req\.method\s*===\s*"(GET|POST|PATCH|PUT|DELETE)"'),
    # /^pattern$/.test(path) && req.method === "GET"
    re.compile(r'/\^([^/]+)\$/\.test\(\s*path\s*\)\s*&&\s*req\.method\s*===\s*"(GET|POST|PATCH|PUT|DELETE)"'),
]


def normalize(prefix, raw, kind):
    """kind: 'eq', 'starts', 'regex'"""
    if kind == "regex":
        # e.g. games\/[^/]+\/join
        s = raw.replace("\\/", "/").replace("[^/]+", ":id")
        return f"/{prefix}/{s}" if s else f"/{prefix}"
    return f"/{prefix}/{raw}" if raw else f"/{prefix}"


def extract(module):
    path = os.path.join(BASE, module, "index.ts")
    if not os.path.exists(path):
        return []
    src = open(path).read()
    found = []  # (method, path)

    # eq form #1
    for m in PATTERNS[0].finditer(src):
        found.append((m.group(2), normalize(module, m.group(1), "eq")))
    # eq form #2 (swapped)
    for m in PATTERNS[1].finditer(src):
        found.append((m.group(1), normalize(module, m.group(2), "eq")))
    # startsWith
    for m in PATTERNS[2].finditer(src):
        raw = m.group(1).rstrip("/")
        # mark prefix routes with /:rest
        p = normalize(module, raw, "starts") + "/..."
        found.append((m.group(2), p))
    # regex
    for m in PATTERNS[3].finditer(src):
        found.append((m.group(2), normalize(module, m.group(1), "regex")))

    # dedupe
    out, seen = [], set()
    for method, p in found:
        key = (method, p)
        if key in seen: continue
        seen.add(key)
        out.append({"method": method, "path": p})
    return out


def main():
    all_routes = {}
    for mod in CUSTOMER_MODULES:
        all_routes[mod] = extract(mod)

    total = sum(len(v) for v in all_routes.values())
    print(f"Total customer-facing routes detected: {total}\n")
    for mod, routes in all_routes.items():
        print(f"== /{mod} ({len(routes)}) ==")
        for r in routes:
            print(f"  {r['method']:6s} {r['path']}")
        print()

    # also save JSON for downstream tooling
    with open("scripts/_routes.json", "w") as f:
        json.dump(all_routes, f, indent=2)


if __name__ == "__main__":
    main()
