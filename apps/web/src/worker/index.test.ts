import { createRunFixture, type RunUpload } from "@codexspeed/contracts";
import { summarizeRun } from "@codexspeed/metrics";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertRunAndAdvanceLatest } from "./repository.js";

const API_ORIGIN = "https://codexspeed.example";
const RUNS_PATH = "/api/v1/runs";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const LIST_CACHE = "public, max-age=30, s-maxage=30";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type SignedBodyOptions = {
  body: string;
  idempotencyKey: string;
  origin?: string;
};

type ProblemDocument = {
  requestId: string;
  status: number;
  title: string;
  type: string;
};

function runWithId(suffix: number): RunUpload {
  const digits = suffix.toString().padStart(12, "0");
  return {
    ...createRunFixture(),
    runId: `01900000-0000-7000-8000-${digits}`,
    seed: suffix,
  };
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

async function payloadSha256(body: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
}

async function signedBodyRequest(options: SignedBodyOptions): Promise<Request> {
  const timestamp = new Date().toISOString();
  const bodyHash = await payloadSha256(options.body);
  const canonical = [
    "codexspeed-hmac-v1",
    "POST",
    RUNS_PATH,
    timestamp,
    env.PUBLISHER_KEY_ID,
    options.idempotencyKey,
    bodyHash,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64Url(env.PUBLISHER_HMAC_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": options.idempotencyKey,
    "X-Benchmark-Key-Id": env.PUBLISHER_KEY_ID,
    "X-Benchmark-Signature": signature,
    "X-Benchmark-Timestamp": timestamp,
    "X-Content-SHA256": bodyHash,
  });
  if (options.origin !== undefined) {
    headers.set("Origin", options.origin);
  }

  return new Request(`${API_ORIGIN}${RUNS_PATH}`, {
    body: options.body,
    headers,
    method: "POST",
  });
}

async function signedRunRequest(run: RunUpload, body = JSON.stringify(run)): Promise<Request> {
  return signedBodyRequest({ body, idempotencyKey: run.runId });
}

async function upload(run: RunUpload, body = JSON.stringify(run)): Promise<Response> {
  return SELF.fetch(await signedRunRequest(run, body));
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  expect(response.headers.get("Strict-Transport-Security")).toBe(
    "max-age=63072000; includeSubDomains; preload",
  );
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Permissions-Policy")).toBe(
    "camera=(), geolocation=(), microphone=()",
  );
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}

function expectJson(response: Response): void {
  expect(response.headers.get("Content-Type")).toBe("application/json");
}

async function expectProblem(response: Response, status: number): Promise<ProblemDocument> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expectSecurityHeaders(response);
  const document: unknown = await response.json();
  expect(document).toMatchObject({ status });
  expect(document).toHaveProperty("requestId");
  const problem = document as ProblemDocument;
  expect(problem.requestId).toMatch(UUID_PATTERN);
  expect(problem.type).toMatch(/^\/problems\/[a-z0-9_]+$/u);
  expect(problem.title.length).toBeGreaterThan(0);
  return problem;
}

function repositoryResultDocument(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "body" in value) {
    const body = Reflect.get(value, "body");
    if (typeof body === "string") {
      const document: unknown = JSON.parse(body);
      return document;
    }
  }
  return value;
}

beforeEach(async () => {
  await env.DB.prepare("DROP TRIGGER IF EXISTS reject_latest").run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM site_state"),
    env.DB.prepare("DELETE FROM runs"),
  ]);
});

describe("public run API", () => {
  it("reports schema reachability and returns safe empty-state responses", async () => {
    const health = await SELF.fetch(`${API_ORIGIN}/api/v1/health`);
    expect(health.status).toBe(200);
    expectJson(health);
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    expectSecurityHeaders(health);
    await expect(health.json()).resolves.toEqual({ schemaVersion: 1, status: "ok" });

    const latest = await SELF.fetch(`${API_ORIGIN}/api/v1/latest`);
    await expectProblem(latest, 404);

    const list = await SELF.fetch(`${API_ORIGIN}${RUNS_PATH}`);
    expect(list.status).toBe(200);
    expectJson(list);
    expect(list.headers.get("Cache-Control")).toBe(LIST_CACHE);
    expectSecurityHeaders(list);
    await expect(list.json()).resolves.toEqual({ data: [], nextCursor: null });
  });

  it("does not report a partially compatible database schema as healthy", async () => {
    await env.DB.batch([
      env.DB.prepare("ALTER TABLE site_state RENAME TO site_state_compatible"),
      env.DB.prepare("ALTER TABLE runs RENAME TO runs_compatible"),
      env.DB.prepare("CREATE TABLE runs (schema_version INTEGER)"),
      env.DB.prepare("CREATE TABLE site_state (generation INTEGER)"),
    ]);

    try {
      const response = await SELF.fetch(`${API_ORIGIN}/api/v1/health`);
      const document = await expectProblem(response, 503);
      expect(document.type).toBe("/problems/service_unavailable");
    } finally {
      await env.DB.batch([
        env.DB.prepare("DROP TABLE site_state"),
        env.DB.prepare("DROP TABLE runs"),
        env.DB.prepare("ALTER TABLE runs_compatible RENAME TO runs"),
        env.DB.prepare("ALTER TABLE site_state_compatible RENAME TO site_state"),
      ]);
    }
  });

  it("creates a sanitized run and serves the immutable public representation", async () => {
    const uploadedRun = { ...runWithId(1), suiteVersion: " 1.0.0 " };
    const run = { ...uploadedRun, suiteVersion: "1.0.0" };
    const body = JSON.stringify(uploadedRun);
    const expectedHash = await payloadSha256(body);

    const created = await upload(uploadedRun, body);
    expect(created.status).toBe(201);
    expectJson(created);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    expectSecurityHeaders(created);
    const createdDocument = await created.json();
    expect(createdDocument).toEqual({
      publication: {
        payloadSha256: expectedHash,
        publishedAt: expect.stringMatching(PUBLISHED_AT_PATTERN),
      },
      run,
      summary: summarizeRun(run),
    });

    const stored = await env.DB.prepare(
      `SELECT public_payload_json AS publicPayloadJson, summary_json AS summaryJson
       FROM runs
       WHERE run_id = ?`,
    )
      .bind(run.runId)
      .first<{ publicPayloadJson: string; summaryJson: string }>();
    expect(stored).toEqual({
      publicPayloadJson: JSON.stringify(run),
      summaryJson: JSON.stringify(summarizeRun(run)),
    });

    const found = await SELF.fetch(`${API_ORIGIN}${RUNS_PATH}/${run.runId}`);
    expect(found.status).toBe(200);
    expectJson(found);
    expect(found.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE);
    expect(found.headers.get("ETag")).toBe(`"${expectedHash}"`);
    expectSecurityHeaders(found);
    await expect(found.json()).resolves.toEqual(createdDocument);

    const notModified = await SELF.fetch(`${API_ORIGIN}${RUNS_PATH}/${run.runId}`, {
      headers: { "If-None-Match": `"${expectedHash}"` },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE);
    expect(notModified.headers.get("ETag")).toBe(`"${expectedHash}"`);
    expect(notModified.headers.get("Content-Type")).toBeNull();
    expectSecurityHeaders(notModified);
    await expect(notModified.text()).resolves.toBe("");
  });

  it("is idempotent only for the byte-identical body", async () => {
    const run = runWithId(2);
    const body = JSON.stringify(run);
    const first = await upload(run, body);
    expect(first.status).toBe(201);
    const firstDocument = await first.json();

    const duplicate = await upload(run, body);
    expect(duplicate.status).toBe(200);
    expect(duplicate.headers.get("Cache-Control")).toBe("no-store");
    await expect(duplicate.json()).resolves.toEqual(firstDocument);

    const state = await env.DB.prepare(
      "SELECT latest_run_id AS latestRunId, generation FROM site_state WHERE key = 'latest'",
    ).first<{ generation: number; latestRunId: string }>();
    expect(state).toEqual({ generation: 1, latestRunId: run.runId });

    const whitespaceChanged = `{\n  ${body.slice(1)}`;
    const conflict = await upload(run, whitespaceChanged);
    const conflictProblem = await expectProblem(conflict, 409);
    expect(conflictProblem.type).toBe("/problems/run_conflict");
  });

  it("returns the stored successful result when derived metrics code changes later", async () => {
    const run = runWithId(5);
    const body = JSON.stringify(run);
    const created = await upload(run, body);
    expect(created.status).toBe(201);
    const storedDocument: unknown = await created.json();
    const originalSummary = summarizeRun(run);
    const divergentSummary = {
      ...originalSummary,
      reliability: { ...originalSummary.reliability, validSamples: 0 },
    };

    const duplicate = await insertRunAndAdvanceLatest(env.DB, {
      payloadSha256: await payloadSha256(body),
      publishedAt: "2030-01-01T00:00:00.000Z",
      run,
      summary: divergentSummary,
    });

    expect(duplicate.created).toBe(false);
    expect(repositoryResultDocument(duplicate.value)).toEqual(storedDocument);
  });

  it("collapses concurrent byte-identical uploads to one immutable publication", async () => {
    const run = runWithId(3);
    const body = JSON.stringify(run);
    const requests = await Promise.all([signedRunRequest(run, body), signedRunRequest(run, body)]);
    const responses = await Promise.all(requests.map((request) => SELF.fetch(request)));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM runs").first<number>("count");
    expect(count).toBe(1);
    const state = await env.DB.prepare(
      "SELECT latest_run_id AS latestRunId, generation FROM site_state WHERE key = 'latest'",
    ).first<{ generation: number; latestRunId: string }>();
    expect(state).toEqual({ generation: 1, latestRunId: run.runId });
  });

  it("resolves concurrent different bytes for one run ID as one create and one conflict", async () => {
    const firstRun = runWithId(4);
    const secondRun = { ...firstRun, seed: firstRun.seed + 1 };
    const requests = await Promise.all([signedRunRequest(firstRun), signedRunRequest(secondRun)]);
    const responses = await Promise.all(requests.map((request) => SELF.fetch(request)));

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM runs").first<number>("count");
    expect(count).toBe(1);
    const generation = await env.DB.prepare(
      "SELECT generation FROM site_state WHERE key = 'latest'",
    ).first<number>("generation");
    expect(generation).toBe(1);
  });

  it("never lets an old duplicate move the latest pointer", async () => {
    const oldRun = runWithId(10);
    const newRun = runWithId(20);
    const oldBody = JSON.stringify(oldRun);

    expect((await upload(oldRun, oldBody)).status).toBe(201);
    expect((await upload(newRun)).status).toBe(201);
    expect((await upload(oldRun, oldBody)).status).toBe(200);

    const latest = await SELF.fetch(`${API_ORIGIN}/api/v1/latest`);
    expect(latest.status).toBe(200);
    expectJson(latest);
    expect(latest.headers.get("Cache-Control")).toBe("no-store");
    expectSecurityHeaders(latest);
    const document = await latest.json();
    expect(document).toMatchObject({ generation: 2, run: { runId: newRun.runId } });
    const etag = latest.headers.get("ETag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);

    const notModified = await SELF.fetch(`${API_ORIGIN}/api/v1/latest`, {
      headers: { "If-None-Match": etag! },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("Cache-Control")).toBe("no-store");
    expect(notModified.headers.get("ETag")).toBe(etag);
    expect(notModified.headers.get("Content-Type")).toBeNull();
    expectSecurityHeaders(notModified);
  });

  it("paginates newest-first with a validated opaque keyset cursor", async () => {
    const runs = [runWithId(101), runWithId(102), runWithId(103)];
    for (const run of runs) {
      expect((await upload(run)).status).toBe(201);
    }

    const first = await SELF.fetch(`${API_ORIGIN}${RUNS_PATH}?limit=2`);
    expect(first.status).toBe(200);
    expectJson(first);
    expect(first.headers.get("Cache-Control")).toBe(LIST_CACHE);
    expectSecurityHeaders(first);
    const firstPage = await first.json<{
      data: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expect(firstPage.data.map((item) => item["runId"])).toEqual([
      runs[2]!.runId,
      runs[1]!.runId,
    ]);
    expect(firstPage.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(firstPage.data[0]).toMatchObject({
      mode: "smoke",
      publication: {
        payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        publishedAt: expect.stringMatching(PUBLISHED_AT_PATTERN),
      },
      runId: runs[2]!.runId,
      status: "completed",
      summary: {
        coverage: summarizeRun(runs[2]!).coverage,
        reliability: summarizeRun(runs[2]!).reliability,
      },
    });
    expect(firstPage.data[0]).not.toHaveProperty("samples");

    const second = await SELF.fetch(
      `${API_ORIGIN}${RUNS_PATH}?limit=2&cursor=${firstPage.nextCursor!}`,
    );
    expect(second.status).toBe(200);
    const secondPage = await second.json<{
      data: Array<{ runId: string }>;
      nextCursor: string | null;
    }>();
    expect(secondPage.data.map((item) => item.runId)).toEqual([runs[0]!.runId]);
    expect(secondPage.nextCursor).toBeNull();

    for (const query of ["cursor=not%2Bbase64url", "cursor=", "limit=0", "limit=51", "limit=1.5"]) {
      const invalid = await SELF.fetch(`${API_ORIGIN}${RUNS_PATH}?${query}`);
      await expectProblem(invalid, 400);
    }
  });

  it("keeps malformed JSON at 400 and rejects every authenticated schema failure at 422", async () => {
    const run = runWithId(30);
    const malformed = await SELF.fetch(
      await signedBodyRequest({ body: `{"runId":"${run.runId}"`, idempotencyKey: run.runId }),
    );
    const malformedProblem = await expectProblem(malformed, 400);
    expect(malformedProblem.type).toBe("/problems/invalid_json");

    for (const document of [{ runId: run.runId }, {}, { runId: 1 }, []]) {
      const invalid = await SELF.fetch(
        await signedBodyRequest({ body: JSON.stringify(document), idempotencyKey: run.runId }),
      );
      const invalidProblem = await expectProblem(invalid, 422);
      expect(invalidProblem.type).toBe("/problems/invalid_run");
    }

    const mismatch = await SELF.fetch(
      await signedBodyRequest({
        body: JSON.stringify(run),
        idempotencyKey: runWithId(31).runId,
      }),
    );
    const mismatchProblem = await expectProblem(mismatch, 400);
    expect(mismatchProblem.type).toBe("/problems/idempotency_mismatch");
  });

  it("rejects browser-origin writes without exposing write CORS", async () => {
    const run = runWithId(40);
    const request = await signedBodyRequest({
      body: JSON.stringify(run),
      idempotencyKey: run.runId,
      origin: "https://attacker.example",
    });
    const response = await SELF.fetch(request);
    const document = await expectProblem(response, 403);
    expect(document.type).toBe("/problems/browser_write_forbidden");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM runs").first<number>("count");
    expect(count).toBe(0);
  });

  it("rolls back the run insert when advancing latest fails and logs only safe context", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER reject_latest BEFORE INSERT ON site_state BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    ).run();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = runWithId(50);

    try {
      const response = await upload(run);
      const document = await expectProblem(response, 503);
      expect(document.type).toBe("/problems/service_unavailable");

      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM runs").first<number>("count");
      expect(count).toBe(0);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const entry: unknown = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
      expect(entry).toEqual({
        errorClass: "Error",
        errorCode: "service_unavailable",
        event: "worker_request_failed",
        requestId: document.requestId,
      });
      expect(JSON.stringify(entry)).not.toContain(run.runId);
      expect(JSON.stringify(entry)).not.toContain(env.PUBLISHER_HMAC_SECRET);
    } finally {
      errorLog.mockRestore();
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_latest").run();
    }
  });
});
