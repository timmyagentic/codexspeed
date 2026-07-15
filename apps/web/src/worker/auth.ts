import type { UploadAuthEnv } from "./env.js";
import { ProblemError } from "./problem.js";

const UPLOAD_PATH = "/api/v1/runs";
const AUTH_VERSION = "codexspeed-hmac-v1";
const MAX_BODY_BYTES = 1_048_576;
const SENTINEL_BODY_BYTES = MAX_BODY_BYTES + 1;
const CLOCK_WINDOW_MS = 300_000;

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type VerifiedUpload = {
  bytes: Uint8Array;
  bodySha256: string;
  document: unknown;
  idempotencyKey: string;
};

function authenticationFailed(): ProblemError {
  return new ProblemError(401, "authentication_failed", "Authentication failed");
}

function unsupportedMediaType(): ProblemError {
  return new ProblemError(415, "unsupported_media_type", "Unsupported media type");
}

function payloadTooLarge(): ProblemError {
  return new ProblemError(413, "payload_too_large", "Payload too large");
}

function invalidBody(): ProblemError {
  return new ProblemError(400, "invalid_body", "Invalid request body");
}

function invalidJson(): ProblemError {
  return new ProblemError(400, "invalid_json", "Invalid JSON");
}

function mediaType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let oversized = false;

  try {
    while (totalBytes < SENTINEL_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.byteLength === 0) {
        continue;
      }

      const remainingBytes = SENTINEL_BODY_BYTES - totalBytes;
      const accepted = value.slice(0, remainingBytes);
      chunks.push(accepted);
      totalBytes += accepted.byteLength;

      if (totalBytes === SENTINEL_BODY_BYTES) {
        oversized = true;
        try {
          await reader.cancel();
        } catch {
          // The size result is already known; transport cancellation is best-effort.
        }
        break;
      }
    }
  } catch {
    throw invalidBody();
  } finally {
    reader.releaseLock();
  }

  if (oversized) {
    throw payloadTooLarge();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeBase64Url(value: Uint8Array): string {
  const binary = String.fromCharCode(...value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    value.includes("=") ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return null;
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function hasCanonicalTimestamp(timestamp: string, now: Date): boolean {
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return false;
  }

  const timestampMs = Date.parse(timestamp);
  const nowMs = now.getTime();
  return (
    Number.isFinite(timestampMs) &&
    Number.isFinite(nowMs) &&
    new Date(timestampMs).toISOString() === timestamp &&
    Math.abs(nowMs - timestampMs) <= CLOCK_WINDOW_MS
  );
}

async function verifySignature(
  signature: string,
  canonical: Uint8Array,
  encodedSecret: string,
): Promise<boolean> {
  const signatureBytes = decodeBase64Url(signature);
  const secretBytes = decodeBase64Url(encodedSecret);
  if (signatureBytes?.byteLength !== 32 || secretBytes === null) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("HMAC", key, signatureBytes, canonical);
  } catch {
    return false;
  }
}

function parseDocument(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    const document: unknown = JSON.parse(text);
    return document;
  } catch {
    throw invalidJson();
  }
}

export async function verifyUploadRequest(
  request: Request,
  env: UploadAuthEnv,
  now: Date,
): Promise<VerifiedUpload> {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null || mediaType(contentType) !== "application/json") {
    throw unsupportedMediaType();
  }

  const url = new URL(request.url);
  const keyId = request.headers.get("X-Benchmark-Key-Id");
  const timestamp = request.headers.get("X-Benchmark-Timestamp");
  const bodySha256 = request.headers.get("X-Content-SHA256");
  const signature = request.headers.get("X-Benchmark-Signature");
  const idempotencyKey = request.headers.get("Idempotency-Key");

  if (
    request.method !== "POST" ||
    url.pathname !== UPLOAD_PATH ||
    url.href.includes("?") ||
    keyId === null ||
    timestamp === null ||
    bodySha256 === null ||
    signature === null ||
    idempotencyKey === null ||
    idempotencyKey.length === 0 ||
    keyId !== env.PUBLISHER_KEY_ID ||
    !hasCanonicalTimestamp(timestamp, now) ||
    !SHA256_PATTERN.test(bodySha256)
  ) {
    throw authenticationFailed();
  }

  const bytes = await readBoundedBody(request);
  const computedBodySha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (computedBodySha256 !== bodySha256) {
    throw authenticationFailed();
  }

  const canonical = new TextEncoder().encode(
    [
      AUTH_VERSION,
      request.method,
      url.pathname,
      timestamp,
      keyId,
      idempotencyKey,
      bodySha256,
    ].join("\n"),
  );
  if (!(await verifySignature(signature, canonical, env.PUBLISHER_HMAC_SECRET))) {
    throw authenticationFailed();
  }

  const document = parseDocument(bytes);

  return {
    bytes,
    bodySha256,
    document,
    idempotencyKey,
  };
}
