/**
 * Firebase Cloud Messaging v1 sender — template-generator (Deno).
 *
 * Mirrors admin/src/lib/fcm.ts but uses Deno APIs (Deno.readTextFileSync,
 * Web Crypto) instead of Node `fs`. The service-account JSON is mounted
 * read-only at /app/configs/<filename> (same volume the admin container
 * uses) so the same credentials power both services without duplication.
 *
 * R-01: the private key is never logged. Only delivery counts surface.
 */

const SERVICE_ACCOUNT_PATH = Deno.env.get("FCM_SERVICE_ACCOUNT_PATH")
  ?? "/app/configs/quiz4win-68443-firebase-adminsdk-fbsvc-24d33392b8.json";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let _sa: ServiceAccount | null = null;

function loadServiceAccount(): ServiceAccount {
  if (_sa) return _sa;
  try {
    const raw = Deno.readTextFileSync(SERVICE_ACCOUNT_PATH);
    _sa = JSON.parse(raw) as ServiceAccount;
    return _sa;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fcm_not_configured: cannot read ${SERVICE_ACCOUNT_PATH} (${msg})`);
  }
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

interface CachedToken { token: string; expiresAt: number }
let cached: CachedToken | null = null;

function b64urlBytes(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlString(s: string): string { return b64urlBytes(new TextEncoder().encode(s)); }

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlString(JSON.stringify({
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, key,
    new TextEncoder().encode(input),
  );
  const jwt = `${input}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fcm_auth_failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

export interface FcmNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmSendResult {
  delivered: number;
  failed: number;
  invalidTokens: string[];
}

async function sendOne(accessToken: string, projectId: string, deviceToken: string, n: FcmNotification): Promise<{ ok: boolean; remove: boolean }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: n.title, body: n.body },
        data: n.data ?? {},
        android: { priority: "HIGH", notification: { sound: "default" } },
        apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
      },
    }),
  });
  if (res.ok) return { ok: true, remove: false };
  let bodyText = "";
  try { bodyText = await res.text(); } catch { /* ignore */ }
  const lower = bodyText.toLowerCase();
  const remove = res.status === 404
    || lower.includes("unregistered")
    || lower.includes("not_found")
    || lower.includes("invalid_argument");
  console.warn(`[fcm] send failed status=${res.status} remove=${remove}`);
  return { ok: false, remove };
}

export async function sendFcmToTokens(deviceTokens: string[], notification: FcmNotification): Promise<FcmSendResult> {
  if (deviceTokens.length === 0) return { delivered: 0, failed: 0, invalidTokens: [] };
  const projectId = loadServiceAccount().project_id;
  const accessToken = await getAccessToken();
  const CONCURRENCY = 20;
  let delivered = 0, failed = 0;
  const invalidTokens: string[] = [];
  for (let i = 0; i < deviceTokens.length; i += CONCURRENCY) {
    const chunk = deviceTokens.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((t) => sendOne(accessToken, projectId, t, notification)));
    results.forEach((r, idx) => {
      if (r.ok) delivered++;
      else { failed++; if (r.remove) invalidTokens.push(chunk[idx]); }
    });
  }
  return { delivered, failed, invalidTokens };
}

export function isFcmConfigured(): boolean {
  try { loadServiceAccount(); return true; } catch { return false; }
}
