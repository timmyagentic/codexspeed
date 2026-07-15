import { createHash, createHmac } from "node:crypto";
import {
  PublicRunResponseSchema,
  RunUploadSchema,
  type PublicRunResponse,
  type RunUpload,
} from "@codexspeed/contracts";

const AUTH_VERSION = "codexspeed-hmac-v1";
const UPLOAD_PATH = "/api/v1/runs";
export const MAX_ARTIFACT_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2_097_152;
const DEFAULT_TIMEOUT_MS = 15_000;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export const DEFAULT_PUBLISH_ENDPOINT =
  "https://codexspeed.timmyagentic.com/api/v1/runs";

export class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherError";
  }
}

export type SignedRequestOptions = {
  endpoint?: string;
  allowHttpLocalhost?: boolean;
  keyId?: string | undefined;
  hmacSecret?: string | undefined;
  now?: () => Date;
  signal?: AbortSignal;
};

export type SignedArtifactRequest = {
  request: Request;
  run: RunUpload;
  bodySha256: string;
};

export type PublishArtifactOptions = SignedRequestOptions & {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export type PublishArtifactResult = {
  httpStatus: 200 | 201;
  outcome: "created" | "already_published";
  runId: string;
  payloadSha256: string;
  response: PublicRunResponse;
};

function decodeArtifact(bytes: Uint8Array): RunUpload {
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new PublisherError("benchmark artifact exceeds 1 MiB");
  }

  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    const document: unknown = JSON.parse(text);
    return RunUploadSchema.parse(document);
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    throw new PublisherError("benchmark artifact is invalid");
  }
}

function publisherKeyId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new PublisherError("publisher key ID is missing");
  }
  if (!KEY_ID_PATTERN.test(value)) {
    throw new PublisherError("publisher key ID is invalid");
  }
  return value;
}

function publisherSecret(value: string | undefined): Buffer {
  if (value === undefined || value.length === 0) {
    throw new PublisherError("publisher HMAC secret is missing");
  }
  if (
    value.includes("=") ||
    value.length % 4 === 1 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new PublisherError("publisher HMAC secret is invalid");
  }

  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new PublisherError("publisher HMAC secret is invalid");
  }
  return bytes;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function publishUrl(endpoint: string, allowHttpLocalhost: boolean): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PublisherError("publish endpoint is invalid");
  }

  if (
    url.pathname !== UPLOAD_PATH ||
    endpoint.includes("?") ||
    endpoint.includes("#") ||
    endpoint.includes("@") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new PublisherError(
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    );
  }

  const secure = url.protocol === "https:";
  const explicitlyAllowedLoopback =
    url.protocol === "http:" && allowHttpLocalhost && isLoopback(url.hostname);
  if (!secure && !explicitlyAllowedLoopback) {
    throw new PublisherError(
      "publish endpoint must use HTTPS or explicitly allowed loopback HTTP",
    );
  }
  return url;
}

function canonicalTimestamp(now: () => Date): string {
  const date = now();
  if (!Number.isFinite(date.getTime())) {
    throw new PublisherError("publisher clock is invalid");
  }
  return date.toISOString();
}

export async function createSignedRequest(
  body: Uint8Array,
  options: SignedRequestOptions,
): Promise<SignedArtifactRequest> {
  const run = decodeArtifact(body);
  const endpoint = publishUrl(
    options.endpoint ?? DEFAULT_PUBLISH_ENDPOINT,
    options.allowHttpLocalhost ?? false,
  );
  const keyId = publisherKeyId(options.keyId);
  const secret = publisherSecret(options.hmacSecret);
  const timestamp = canonicalTimestamp(options.now ?? (() => new Date()));
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const canonical = [
    AUTH_VERSION,
    "POST",
    UPLOAD_PATH,
    timestamp,
    keyId,
    run.runId,
    bodySha256,
  ].join("\n");
  const signature = createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("base64url");
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": run.runId,
    "X-Benchmark-Key-Id": keyId,
    "X-Benchmark-Signature": signature,
    "X-Benchmark-Timestamp": timestamp,
    "X-Content-SHA256": bodySha256,
  });
  const requestBody = new Uint8Array(body.byteLength);
  requestBody.set(body);

  return {
    request: new Request(endpoint, {
      body: requestBody.buffer,
      headers,
      method: "POST",
      redirect: "error",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    run,
    bodySha256,
  };
}

function statusError(status: number): PublisherError {
  switch (status) {
    case 401:
      return new PublisherError("publication authentication failed");
    case 409:
      return new PublisherError("run ID conflicts with an existing artifact");
    case 413:
      return new PublisherError("benchmark artifact is too large");
    case 422:
      return new PublisherError("benchmark artifact was rejected");
    case 429:
      return new PublisherError("publication rate limit was reached");
    case 503:
      return new PublisherError("publication service is unavailable");
    default:
      return new PublisherError(`publication failed with HTTP ${status}`);
  }
}

function parseResponse(text: string): PublicRunResponse {
  try {
    const document: unknown = JSON.parse(text);
    return PublicRunResponseSchema.parse(document);
  } catch {
    throw new PublisherError("publication response is invalid");
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PublisherError("publication response exceeds 2 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new PublisherError("publication response is invalid");
  }
}

export async function publishArtifact(
  body: Uint8Array,
  options: PublishArtifactOptions,
): Promise<PublishArtifactResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 300_000
  ) {
    throw new PublisherError("publication timeout is invalid");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signed = await createSignedRequest(body, {
      ...options,
      signal: controller.signal,
    });
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(signed.request);
    } catch {
      throw new PublisherError("publication request failed");
    }

    if (response.status !== 200 && response.status !== 201) {
      await response.body?.cancel().catch(() => undefined);
      throw statusError(response.status);
    }

    let text: string;
    try {
      text = await readBoundedResponse(response);
    } catch (error) {
      if (error instanceof PublisherError) throw error;
      throw new PublisherError("publication response is invalid");
    }
    const document = parseResponse(text);
    if (document.run.runId !== signed.run.runId) {
      throw new PublisherError(
        "publication response run ID does not match the artifact",
      );
    }
    if (document.summary.runId !== signed.run.runId) {
      throw new PublisherError(
        "publication response summary does not match the artifact",
      );
    }
    if (document.publication.payloadSha256 !== signed.bodySha256) {
      throw new PublisherError(
        "publication response hash does not match the artifact",
      );
    }

    return {
      httpStatus: response.status,
      outcome: response.status === 201 ? "created" : "already_published",
      runId: signed.run.runId,
      payloadSha256: signed.bodySha256,
      response: document,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublisherError("publication timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
