import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRunFixture,
  type PublicRunResponse,
  type RunUpload,
} from "@codexspeed/contracts";
import { runCli } from "./cli.js";
import {
  createSignedRequest,
  DEFAULT_PUBLISH_ENDPOINT,
  MAX_ARTIFACT_BYTES,
  PublisherError,
  publishArtifact,
} from "./publisher.js";

const KEY_ID = "publisher-v1";
const SECRET_BYTES = Buffer.alloc(32, 0x2a);
const HMAC_SECRET = SECRET_BYTES.toString("base64url");
const NOW = new Date("2026-07-16T08:00:00.000Z");
const execFileAsync = promisify(execFile);

type CapturedRequest = {
  body: Buffer;
  headers: IncomingMessage["headers"];
  method: string | undefined;
  url: string | undefined;
};

type TestServer = {
  close(): Promise<void>;
  endpoint: string;
};

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function artifactBytes(run: RunUpload = createRunFixture()): Buffer {
  return Buffer.from(`${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function responseFor(run: RunUpload, payloadSha256: string): PublicRunResponse {
  return {
    run,
    summary: {
      runId: run.runId,
      coverage: {
        selectedCells: 1,
        measuredCells: 1,
        unmeasuredCells: 0,
        expectedMeasuredSamples: 1,
        recordedMeasuredSamples: 2,
      },
      reliability: {
        measuredSamples: 2,
        validSamples: 1,
        invalidSamples: 1,
      },
      cells: [
        {
          model: "gpt-5.3-codex",
          effort: "medium",
          coverage: { expectedMeasuredSamples: 1, recordedMeasuredSamples: 2 },
          reliability: { measuredSamples: 2, validSamples: 1, invalidSamples: 1 },
          metrics: {
            firstVisibleTextMs: { p50: 1_000, min: 1_000, max: 1_000, n: 1 },
            visibleStreamTpsEstimate: { p50: 49.9, min: 49.9, max: 49.9, n: 1 },
            visibleE2eTps: { p50: 40, min: 40, max: 40, n: 1 },
            generatedE2eTps: { p50: 48, min: 48, max: 48, n: 1 },
            totalLatencyMs: { p50: 12_500, min: 12_500, max: 12_500, n: 1 },
          },
        },
      ],
    },
    publication: {
      payloadSha256,
      publishedAt: "2026-07-16T08:00:01.000Z",
    },
  };
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
): Promise<TestServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/v1/runs`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function capturedOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("exact-byte signed publication", () => {
  it("uses the same artifact bytes for validation, SHA-256, HMAC, and the HTTP body", async () => {
    const bytes = artifactBytes();
    const run = createRunFixture();
    let captured: CapturedRequest | undefined;
    const server = await startServer(async (request, response) => {
      const body = await requestBody(request);
      captured = { body, headers: request.headers, method: request.method, url: request.url };
      const payloadSha256 = createHash("sha256").update(body).digest("hex");
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(responseFor(run, payloadSha256)));
    });

    const result = await publishArtifact(bytes, {
      endpoint: server.endpoint,
      allowHttpLocalhost: true,
      keyId: KEY_ID,
      hmacSecret: HMAC_SECRET,
      now: () => NOW,
    });

    expect(result).toMatchObject({ httpStatus: 201, outcome: "created", runId: run.runId });
    expect(captured).toBeDefined();
    expect(captured!.body.equals(bytes)).toBe(true);
    expect(captured!.method).toBe("POST");
    expect(captured!.url).toBe("/api/v1/runs");
    expect(captured!.headers["content-type"]).toBe("application/json");
    expect(captured!.headers["idempotency-key"]).toBe(run.runId);
    expect(captured!.headers["x-benchmark-key-id"]).toBe(KEY_ID);
    expect(captured!.headers["x-benchmark-timestamp"]).toBe(NOW.toISOString());

    const bodyHash = createHash("sha256").update(bytes).digest("hex");
    expect(captured!.headers["x-content-sha256"]).toBe(bodyHash);
    const canonical = [
      "codexspeed-hmac-v1",
      "POST",
      "/api/v1/runs",
      NOW.toISOString(),
      KEY_ID,
      run.runId,
      bodyHash,
    ].join("\n");
    const expected = createHmac("sha256", SECRET_BYTES).update(canonical, "utf8").digest();
    const signature = captured!.headers["x-benchmark-signature"];
    expect(typeof signature).toBe("string");
    const actual = Buffer.from(signature as string, "base64url");
    expect(actual.byteLength).toBe(expected.byteLength);
    expect(timingSafeEqual(actual, expected)).toBe(true);
    expect(result.payloadSha256).toBe(bodyHash);
  });

  it("creates a canonical signed request with the production endpoint by default", async () => {
    const signed = await createSignedRequest(artifactBytes(), {
      keyId: KEY_ID,
      hmacSecret: HMAC_SECRET,
      now: () => NOW,
    });

    expect(signed.request.url).toBe(DEFAULT_PUBLISH_ENDPOINT);
    expect(signed.request.headers.get("X-Benchmark-Timestamp")).toBe(NOW.toISOString());
    expect(Buffer.from(await signed.request.arrayBuffer()).equals(artifactBytes())).toBe(true);
  });

  it.each([
    [undefined, HMAC_SECRET, "publisher key ID is missing"],
    [KEY_ID, undefined, "publisher HMAC secret is missing"],
    [KEY_ID, "not+base64url", "publisher HMAC secret is invalid"],
    [KEY_ID, Buffer.alloc(16).toString("base64url"), "publisher HMAC secret is invalid"],
  ] as const)("rejects missing or malformed publisher credentials", async (keyId, secret, message) => {
    await expect(
      createSignedRequest(artifactBytes(), { keyId, hmacSecret: secret, now: () => NOW }),
    ).rejects.toThrow(message);
  });

  it.each([
    [
      "http://codexspeed.timmyagentic.com/api/v1/runs",
      true,
      "publish endpoint must use HTTPS or explicitly allowed loopback HTTP",
    ],
    [
      "http://127.0.0.1:8787/api/v1/runs",
      false,
      "publish endpoint must use HTTPS or explicitly allowed loopback HTTP",
    ],
    [
      "https://codexspeed.timmyagentic.com/api/v1/runs?debug=1",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://codexspeed.timmyagentic.com/api/v1/runs#fragment",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://name:password@codexspeed.timmyagentic.com/api/v1/runs",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://@codexspeed.timmyagentic.com/api/v1/runs",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://codexspeed.timmyagentic.com/api/v1/runs?",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://codexspeed.timmyagentic.com/api/v1/runs#",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "https://codexspeed.timmyagentic.com/api/v1/latest",
      false,
      "publish endpoint must be exactly /api/v1/runs without query, fragment, or user info",
    ],
    [
      "ftp://127.0.0.1/api/v1/runs",
      true,
      "publish endpoint must use HTTPS or explicitly allowed loopback HTTP",
    ],
  ] as const)("rejects unsafe endpoint %s", async (endpoint, allowHttpLocalhost, message) => {
    await expect(
      createSignedRequest(artifactBytes(), {
        endpoint,
        allowHttpLocalhost,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
        now: () => NOW,
      }),
    ).rejects.toThrow(message);
  });

  it("rejects malformed and oversized artifact bytes before sending", async () => {
    await expect(
      createSignedRequest(Buffer.from("not JSON"), {
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toThrow("benchmark artifact is invalid");
    await expect(
      createSignedRequest(Buffer.alloc(1_048_577, 0x20), {
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toThrow("benchmark artifact exceeds 1 MiB");
  });
});

describe("publication response verification", () => {
  it("does not follow redirects away from the validated upload endpoint", async () => {
    let redirectedRequests = 0;
    const destination = await startServer(async (request, response) => {
      redirectedRequests += 1;
      const body = await requestBody(request);
      const hash = createHash("sha256").update(body).digest("hex");
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(responseFor(createRunFixture(), hash)));
    });
    const redirector = await startServer(async (request, response) => {
      await requestBody(request);
      response.writeHead(307, { Location: destination.endpoint });
      response.end();
    });

    await expect(
      publishArtifact(artifactBytes(), {
        endpoint: redirector.endpoint,
        allowHttpLocalhost: true,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toThrow("publication request failed");
    expect(redirectedRequests).toBe(0);
  });

  it.each([
    [401, "authentication failed"],
    [409, "run ID conflicts with an existing artifact"],
    [413, "benchmark artifact is too large"],
    [422, "benchmark artifact was rejected"],
  ] as const)("maps HTTP %i to a stable safe error", async (status, message) => {
    const server = await startServer(async (request, response) => {
      await requestBody(request);
      response.writeHead(status, { "Content-Type": "application/problem+json" });
      response.end(JSON.stringify({ title: "server secret detail must not escape" }));
    });

    await expect(
      publishArtifact(artifactBytes(), {
        endpoint: server.endpoint,
        allowHttpLocalhost: true,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toThrow(message);
  });

  it("aborts a publication that exceeds its timeout", async () => {
    const server = await startServer(async (request) => {
      await requestBody(request);
    });

    await expect(
      publishArtifact(artifactBytes(), {
        endpoint: server.endpoint,
        allowHttpLocalhost: true,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("publication timed out");
  });

  it(
    "keeps the timeout active after headers while the response body is stalled",
    async () => {
      const server = await startServer(async (request, response) => {
        await requestBody(request);
        response.writeHead(201, { "Content-Type": "application/json" });
        response.flushHeaders();
      });

      await expect(
        publishArtifact(artifactBytes(), {
          endpoint: server.endpoint,
          allowHttpLocalhost: true,
          keyId: KEY_ID,
          hmacSecret: HMAC_SECRET,
          timeoutMs: 30,
        }),
      ).rejects.toThrow("publication timed out");
    },
    500,
  );

  it("rejects an oversized success response without buffering it all", async () => {
    const server = await startServer(async (request, response) => {
      await requestBody(request);
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(Buffer.alloc(2_097_153, 0x20));
    });

    await expect(
      publishArtifact(artifactBytes(), {
        endpoint: server.endpoint,
        allowHttpLocalhost: true,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toThrow("publication response exceeds 2 MiB");
  });

  it.each(["run", "summary", "hash", "schema"] as const)("rejects a mismatched %s response", async (kind) => {
    const sourceRun = createRunFixture();
    const responseRun = structuredClone(sourceRun);
    if (kind === "run") responseRun.runId = "01900000-0000-7000-8000-000000000099";
    const server = await startServer(async (request, response) => {
      const body = await requestBody(request);
      const bodyHash = createHash("sha256").update(body).digest("hex");
      const document: unknown = responseFor(
        responseRun,
        kind === "hash" ? "f".repeat(64) : bodyHash,
      );
      if (kind === "summary") {
        (document as PublicRunResponse).summary.runId =
          "01900000-0000-7000-8000-000000000099";
      }
      if (kind === "schema") Object.assign(document as object, { unexpected: true });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(document));
    });

    await expect(
      publishArtifact(artifactBytes(sourceRun), {
        endpoint: server.endpoint,
        allowHttpLocalhost: true,
        keyId: KEY_ID,
        hmacSecret: HMAC_SECRET,
      }),
    ).rejects.toBeInstanceOf(PublisherError);
  });
});

describe("codexspeed publish CLI", () => {
  it("publishes an existing artifact through a real server without reserializing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "run.json");
    const bytes = artifactBytes();
    await writeFile(file, bytes, { mode: 0o600 });
    let capturedBody: Buffer | undefined;
    const server = await startServer(async (request, response) => {
      capturedBody = await requestBody(request);
      const hash = createHash("sha256").update(capturedBody).digest("hex");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(responseFor(createRunFixture(), hash)));
    });
    const output = capturedOutput();

    const exitCode = await runCli(
      ["publish", file, "--endpoint", server.endpoint, "--allow-http-localhost"],
      {
        io: output.io,
        publishEnvironment: {
          CODEXSPEED_KEY_ID: KEY_ID,
          CODEXSPEED_HMAC_SECRET: HMAC_SECRET,
        },
        publishNow: () => NOW,
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout).toEqual([
      `Published run ${createRunFixture().runId} (already published)`,
      `Payload SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
    ]);
    expect(capturedBody!.equals(await readFile(file))).toBe(true);
  });

  it("reads credentials only from the environment and never prints secret data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "run.json");
    await writeFile(file, artifactBytes(), { mode: 0o600 });
    const output = capturedOutput();

    const exitCode = await runCli(["publish", file], {
      io: output.io,
      publishEnvironment: {},
    });

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["Error: publisher key ID is missing"]);
    expect(output.stderr.join(" ")).not.toContain(HMAC_SECRET);
    expect(
      await runCli(["publish", file, "--key-id", KEY_ID], { io: output.io }),
    ).toBe(2);
  });

  it("treats a publish flag as a missing endpoint value", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "run.json");
    await writeFile(file, artifactBytes(), { mode: 0o600 });
    const output = capturedOutput();

    const exitCode = await runCli(
      ["publish", file, "--endpoint", "--allow-http-localhost"],
      { io: output.io },
    );

    expect(exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["Error: --endpoint needs one value"]);
  });

  it("never echoes an accidental secret passed as a publish argument", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "run.json");
    await writeFile(file, artifactBytes(), { mode: 0o600 });
    const output = capturedOutput();

    const exitCode = await runCli(["publish", file, HMAC_SECRET], { io: output.io });

    expect(exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["Error: unknown publish option"]);
    expect(output.stderr.join(" ")).not.toContain(HMAC_SECRET);
  });

  it("rejects an oversized artifact locally without sending a request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "oversized.json");
    await writeFile(file, Buffer.alloc(MAX_ARTIFACT_BYTES + 1, 0x20), { mode: 0o600 });
    let requests = 0;
    const server = await startServer(async (request, response) => {
      requests += 1;
      await requestBody(request);
      response.writeHead(500);
      response.end();
    });
    const output = capturedOutput();

    const exitCode = await runCli(
      ["publish", file, "--endpoint", server.endpoint, "--allow-http-localhost"],
      {
        io: output.io,
        publishEnvironment: {
          CODEXSPEED_KEY_ID: KEY_ID,
          CODEXSPEED_HMAC_SECRET: HMAC_SECRET,
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["Error: benchmark artifact exceeds 1 MiB"]);
    expect(requests).toBe(0);
  });

  if (process.platform !== "win32") {
    it(
      "rejects a FIFO artifact without waiting for a writer",
      async () => {
        const directory = await mkdtemp(join(tmpdir(), "codexspeed-publisher-test-"));
        temporaryDirectories.push(directory);
        const file = join(directory, "run.fifo");
        await execFileAsync("mkfifo", [file]);
        const output = capturedOutput();

        const exitCode = await runCli(["publish", file], { io: output.io });

        expect(exitCode).toBe(1);
        expect(output.stdout).toEqual([]);
        expect(output.stderr).toEqual(["Error: benchmark artifact must be a regular file"]);
      },
      500,
    );
  }
});
