/**
 * S3-compatible object storage helpers for Edge Functions.
 *
 * Backend: DigitalOcean Spaces (S3-compatible, region "fra1").
 * All uploaded files in Quiz4Win (KYC documents, avatars, etc.) live here.
 *
 * Two visibility tiers:
 *   - "private"     — readable only via short-lived presigned URLs (KYC, support attachments)
 *   - "public-read" — directly accessible via public URL (avatars, host pictures)
 *
 * Rule compliance:
 *   - R-01: credentials read from env only
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_BUCKET = Deno.env.get("S3_BUCKET") ?? "";
const S3_REGION = Deno.env.get("S3_REGION") ?? "us-east-1";
const S3_ACCESS_KEY = Deno.env.get("S3_ACCESS_KEY") ?? "";
const S3_SECRET = Deno.env.get("S3_SECRET") ?? "";
const S3_ENDPOINT = Deno.env.get("S3_ENDPOINT") ?? "";

if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET || !S3_ENDPOINT) {
  console.warn("[s3] missing one or more S3_* env vars; uploads will fail");
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET },
    forcePathStyle: false,
  });
  return client;
}

export type Visibility = "private" | "public-read";

export interface UploadResult {
  /** Object key (relative path inside the bucket). Persist this in the DB. */
  key: string;
  /** Direct URL — only meaningful when visibility === "public-read". */
  publicUrl: string | null;
}

/**
 * Upload a file/buffer to S3.
 *
 * @param key         Object key (no leading slash); e.g. `kyc/<uid>/id_front.jpg`
 * @param body        ArrayBuffer | Uint8Array | Blob
 * @param contentType MIME type (e.g. "image/jpeg")
 * @param visibility  "private" (default) or "public-read"
 */
export async function uploadObject(
  key: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType: string,
  visibility: Visibility = "private",
): Promise<UploadResult> {
  const Body =
    body instanceof Blob
      ? new Uint8Array(await body.arrayBuffer())
      : body instanceof Uint8Array
        ? body
        : new Uint8Array(body);

  const acl: ObjectCannedACL | undefined = visibility === "public-read" ? "public-read" : undefined;

  console.log(
    `[s3] PUT start — bucket=${S3_BUCKET} key=${key} size=${Body.byteLength}B ` +
    `contentType=${contentType} visibility=${visibility} endpoint=${S3_ENDPOINT}`,
  );

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body,
        ContentType: contentType,
        ACL: acl,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as Record<string, unknown>)?.Code ?? (err as Record<string, unknown>)?.code ?? "unknown";
    console.error(`[s3] PUT FAILED — key=${key} errorCode=${code} message=${msg}`);
    throw err; // re-throw so the caller's step log catches it
  }

  console.log(`[s3] PUT OK — key=${key}`);

  return {
    key,
    publicUrl: visibility === "public-read" ? buildPublicUrl(key) : null,
  };
}

/** Generate a presigned GET URL valid for `expiresSec` seconds (default 10 minutes). */
export async function presignGet(key: string, expiresSec = 600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn: expiresSec });
}

/** Delete an object. Used on account-deletion and cleanup paths. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Build the canonical virtual-hosted public URL for an object key.
 *
 * Example for DO Spaces:
 *   endpoint = https://fra1.digitaloceanspaces.com
 *   bucket   = wingobingo
 *   key      = avatars/uid/avatar.png
 *   → https://wingobingo.fra1.digitaloceanspaces.com/avatars/uid/avatar.png
 */
export function buildPublicUrl(key: string): string {
  const ep = new URL(S3_ENDPOINT);
  return `${ep.protocol}//${S3_BUCKET}.${ep.host}/${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
