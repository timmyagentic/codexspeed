import { describe, expect, it } from "vitest";

import { verifyUploadRequest } from "./auth.js";
import type { UploadAuthEnv } from "./env.js";
import { ProblemError, problem } from "./problem.js";

const NOW = new Date("2026-07-16T08:00:00.000Z");
const PATH = "/api/v1/runs";
const KEY_ID = "publisher-v1";
const RUN_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_RUN_ID = "01900000-0000-7000-8000-000000000099";

// Public test vector key: bytes 0x00 through 0x1f, encoded as unpadded base64url.
const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const FIXED_BODY = `{"runId":"${RUN_ID}","value":"fixed-vector"}`;
const FIXED_BODY_SHA256 = "4618e96683f555a70e208a684b7dcb3bf7c88470d9228c14d7f0bd33e84e2217";
const FIXED_SIGNATURE = "gKA2_LD_5vAgxrcsnUPsu6e0-zFBBDh2hEjEV1MOTXc";

const testEnv = {
  PUBLISHER_KEY_ID: KEY_ID,
  PUBLISHER_HMAC_SECRET: TEST_SECRET,
} satisfies UploadAuthEnv;

type SignedRequestOptions = {
  body?: string;
  idempotencyKey?: string;
  keyId?: string;
  timestamp?: string;
};

function fixedRequest(overrides: Record<string, string | null> = {}): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": RUN_ID,
    "X-Benchmark-Key-Id": KEY_ID,
    "X-Benchmark-Signature": FIXED_SIGNATURE,
    "X-Benchmark-Timestamp": NOW.toISOString(),
    "X-Content-SHA256": FIXED_BODY_SHA256,
  });

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }

  return new Request(`https://codexspeed.example${PATH}`, {
    body: FIXED_BODY,
    headers,
    method: "POST",
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedRequest(options: SignedRequestOptions = {}): Promise<Request> {
  const body = options.body ?? FIXED_BODY;
  const idempotencyKey = options.idempotencyKey ?? RUN_ID;
  const keyId = options.keyId ?? KEY_ID;
  const timestamp = options.timestamp ?? NOW.toISOString();
  const bytes = new TextEncoder().encode(body);
  const bodySha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const canonical = [
    "codexspeed-hmac-v1",
    "POST",
    PATH,
    timestamp,
    keyId,
    idempotencyKey,
    bodySha256,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64Url(TEST_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );

  return new Request(`https://codexspeed.example${PATH}`, {
    body,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Benchmark-Key-Id": keyId,
      "X-Benchmark-Signature": signature,
      "X-Benchmark-Timestamp": timestamp,
      "X-Content-SHA256": bodySha256,
    },
    method: "POST",
  });
}

async function expectProblemError(
  promise: Promise<unknown>,
  expected: { status: number; code: string; title: string },
): Promise<void> {
  try {
    await promise;
    expect.fail("expected request verification to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemError);
    if (!(error instanceof ProblemError)) {
      throw error;
    }
    expect(error).toMatchObject(expected);
    expect(error.message).toBe(expected.title);
    expect(error).not.toHaveProperty("detail");
  }
}

describe("verifyUploadRequest", () => {
  it("accepts the fixed seven-line HMAC vector and returns the exact bytes", async () => {
    const verified = await verifyUploadRequest(fixedRequest(), testEnv, NOW);

    expect(verified).toEqual({
      bodySha256: FIXED_BODY_SHA256,
      bytes: new TextEncoder().encode(FIXED_BODY),
      document: JSON.parse(FIXED_BODY),
      idempotencyKey: RUN_ID,
    });
  });

  it("rejects stale and future timestamps through the same authentication problem", async () => {
    const stale = await signedRequest({ timestamp: "2026-07-16T07:54:59.999Z" });
    const future = await signedRequest({ timestamp: "2026-07-16T08:05:00.001Z" });

    for (const request of [stale, future]) {
      await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
        code: "authentication_failed",
        status: 401,
        title: "Authentication failed",
      });
    }
  });

  it("accepts timestamps exactly at both five-minute boundaries", async () => {
    const pastBoundary = await signedRequest({ timestamp: "2026-07-16T07:55:00.000Z" });
    const futureBoundary = await signedRequest({ timestamp: "2026-07-16T08:05:00.000Z" });

    await expect(verifyUploadRequest(pastBoundary, testEnv, NOW)).resolves.toMatchObject({
      idempotencyKey: RUN_ID,
    });
    await expect(verifyUploadRequest(futureBoundary, testEnv, NOW)).resolves.toMatchObject({
      idempotencyKey: RUN_ID,
    });
  });

  it("rejects signed timestamps that are not canonical millisecond UTC", async () => {
    const timestamps = ["2026-07-16T08:00:00Z", "2026-07-16T08:00:00.000+00:00"];

    for (const timestamp of timestamps) {
      const request = await signedRequest({ timestamp });
      await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
        code: "authentication_failed",
        status: 401,
        title: "Authentication failed",
      });
    }
  });

  for (const header of [
    "Idempotency-Key",
    "X-Benchmark-Key-Id",
    "X-Benchmark-Signature",
    "X-Benchmark-Timestamp",
    "X-Content-SHA256",
  ]) {
    it(`does not reveal the missing ${header} header`, async () => {
      await expectProblemError(verifyUploadRequest(fixedRequest({ [header]: null }), testEnv, NOW), {
        code: "authentication_failed",
        status: 401,
        title: "Authentication failed",
      });
    });
  }

  it("does not distinguish wrong key, body hash, or signature failures", async () => {
    const requests = [
      fixedRequest({ "X-Benchmark-Key-Id": "publisher-v2" }),
      fixedRequest({ "X-Content-SHA256": "0".repeat(64) }),
      fixedRequest({
        "X-Benchmark-Signature": `${FIXED_SIGNATURE.slice(0, -1)}${FIXED_SIGNATURE.endsWith("A") ? "B" : "A"}`,
      }),
    ];

    for (const request of requests) {
      await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
        code: "authentication_failed",
        status: 401,
        title: "Authentication failed",
      });
    }
  });

  it("rejects any query delimiter instead of signing a normalized request target", async () => {
    for (const suffix of ["?preview=true", "?"]) {
      const source = fixedRequest();
      const request = new Request(`${source.url}${suffix}`, {
        body: FIXED_BODY,
        headers: source.headers,
        method: "POST",
      });

      await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
        code: "authentication_failed",
        status: 401,
        title: "Authentication failed",
      });
    }
  });

  it("stops at the 1,048,577th streamed byte", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_576));
        controller.enqueue(Uint8Array.of(0x7b));
      },
    });
    const request = new Request(`https://codexspeed.example${PATH}`, {
      body,
      headers: fixedRequest().headers,
      method: "POST",
    });

    await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
      code: "payload_too_large",
      status: 413,
      title: "Payload too large",
    });
    expect(cancelled).toBe(true);
  });

  it("rejects a content type other than application/json before authentication", async () => {
    await expectProblemError(
      verifyUploadRequest(fixedRequest({ "Content-Type": "text/plain" }), testEnv, NOW),
      {
        code: "unsupported_media_type",
        status: 415,
        title: "Unsupported media type",
      },
    );
  });

  it("returns authenticated JSON for schema and idempotency validation by the route", async () => {
    const request = await signedRequest({
      body: `{"runId":"${OTHER_RUN_ID}"}`,
      idempotencyKey: RUN_ID,
    });

    await expect(verifyUploadRequest(request, testEnv, NOW)).resolves.toMatchObject({
      document: { runId: OTHER_RUN_ID },
      idempotencyKey: RUN_ID,
    });
  });

  it("rejects authenticated malformed JSON without treating it as an auth failure", async () => {
    const request = await signedRequest({ body: `{"runId":` });

    await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
      code: "invalid_json",
      status: 400,
      title: "Invalid JSON",
    });
  });

  it("verifies the HMAC before attempting to parse malformed JSON", async () => {
    const request = await signedRequest({ body: `{"runId":` });
    request.headers.set("X-Benchmark-Signature", "A".repeat(43));

    await expectProblemError(verifyUploadRequest(request, testEnv, NOW), {
      code: "authentication_failed",
      status: 401,
      title: "Authentication failed",
    });
  });

  it("does not interpret authenticated schema-invalid JSON", async () => {
    for (const body of [`{"value":1}`, `{"runId":1}`, `[]`]) {
      const request = await signedRequest({ body });
      await expect(verifyUploadRequest(request, testEnv, NOW)).resolves.toMatchObject({
        document: JSON.parse(body),
        idempotencyKey: RUN_ID,
      });
    }
  });
});

describe("problem", () => {
  it("creates a no-store application/problem+json response with the request ID", async () => {
    const response = problem(
      401,
      "authentication_failed",
      "Authentication failed",
      "request-123",
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      requestId: "request-123",
      status: 401,
      title: "Authentication failed",
      type: "/problems/authentication_failed",
    });
  });
});
