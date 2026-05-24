import "server-only";

/**
 * S3-compatible object storage helpers for the Admin (Next.js / Node).
 *
 * Backend: DigitalOcean Spaces (S3-compatible).
 * Mirrors supabase/functions/_shared/s3.ts so KYC / avatars / attachments
 * uploaded by either side use the same bucket and key layout.
 *
 * Two visibility tiers:
 *   - "private"     — readable only via short-lived presigned URLs (KYC, support attachments)
 *   - "public-read" — directly accessible via public URL (avatars, host pictures)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_BUCKET = process.env.S3_BUCKET ?? "";
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "";
const S3_SECRET = process.env.S3_SECRET ?? "";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "";

let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET || !S3_ENDPOINT) {
    throw new Error("S3 not configured: missing one or more S3_* env vars");
  }
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
  key: string;
  publicUrl: string | null;
}

/** Upload a buffer/array/blob to S3. */
export async function uploadObject(
  key: string,
  body: ArrayBuffer | Uint8Array | Buffer,
  contentType: string,
  visibility: Visibility = "private",
): Promise<UploadResult> {
  const Body =
    body instanceof Uint8Array || Buffer.isBuffer(body)
      ? (body as Uint8Array)
      : new Uint8Array(body);

  const acl: ObjectCannedACL | undefined = visibility === "public-read" ? "public-read" : undefined;

  await getClient().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body,
      ContentType: contentType,
      ACL: acl,
    }),
  );

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

/** Delete an object. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Build the canonical virtual-hosted public URL for an object key.
 * DO Spaces example: https://wingobingo.fra1.digitaloceanspaces.com/<key>
 */
export function buildPublicUrl(key: string): string {
  const ep = new URL(S3_ENDPOINT);
  return `${ep.protocol}//${S3_BUCKET}.${ep.host}/${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
