import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";
import {
  LatestRunResponseSchema,
  PublicRunResponseSchema,
} from "@codexspeed/contracts";
import { summarizeRun } from "@codexspeed/metrics";
import { createSignedRequest } from "@codexspeed/runner";

import { E2E_BODY, E2E_RUN } from "./fixture.js";

const KEY_ID = "e2e-publisher";
const HMAC_SECRET = Buffer.alloc(32, 73).toString("base64url");
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

test("starts with a real empty D1 and renders the empty publication state", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/v1/latest");
  expect(response.status()).toBe(404);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No benchmark has been published yet." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /retry/iu })).toHaveCount(0);
});

test("publishes an exact artifact file twice through the built runner CLI and real D1", async ({
  request,
}, testInfo) => {
  const endpoint = new URL(
    "/api/v1/runs",
    test.info().project.use.baseURL,
  ).toString();
  const artifactPath = testInfo.outputPath("representative-run.json");
  await writeFile(artifactPath, E2E_BODY, { mode: 0o600 });
  expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(artifactPath)).toEqual(Buffer.from(E2E_BODY));

  const publishArguments = [
    "pnpm",
    "--filter",
    "@codexspeed/runner",
    "codexspeed",
    "--",
    "publish",
    artifactPath,
    "--endpoint",
    endpoint,
    "--allow-http-localhost",
  ];
  const environment = { ...process.env };
  delete environment["FORCE_COLOR"];
  delete environment["NO_COLOR"];
  environment["CODEXSPEED_KEY_ID"] = KEY_ID;
  environment["CODEXSPEED_HMAC_SECRET"] = HMAC_SECRET;
  const first = await execFileAsync("corepack", publishArguments, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment,
  });
  const second = await execFileAsync("corepack", publishArguments, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment,
  });

  const payloadSha256 = createHash("sha256").update(E2E_BODY).digest("hex");
  expect(first.stderr).toBe("");
  expect(first.stdout).toContain(`Published run ${E2E_RUN.runId} (created)`);
  expect(first.stdout).toContain(`Payload SHA-256: ${payloadSha256}`);
  expect(second.stderr).toBe("");
  expect(second.stdout).toContain(
    `Published run ${E2E_RUN.runId} (already published)`,
  );
  expect(second.stdout).toContain(`Payload SHA-256: ${payloadSha256}`);

  const runResponse = await request.get(`/api/v1/runs/${E2E_RUN.runId}`);
  expect(runResponse.status()).toBe(200);
  const stored = PublicRunResponseSchema.parse(await runResponse.json());
  expect(stored.run).toEqual(E2E_RUN);
  expect(stored.publication.payloadSha256).toBe(payloadSha256);
  expect(stored.summary).toEqual(summarizeRun(E2E_RUN));

  const latestResponse = await request.get("/api/v1/latest");
  expect(latestResponse.status()).toBe(200);
  const latest = LatestRunResponseSchema.parse(await latestResponse.json());
  expect(latest).toEqual({ ...stored, generation: 1 });

  const signed = await createSignedRequest(E2E_BODY, {
    allowHttpLocalhost: true,
    endpoint,
    hmacSecret: HMAC_SECRET,
    keyId: KEY_ID,
  });
  const tamperedBody = new Uint8Array(E2E_BODY);
  tamperedBody[tamperedBody.byteLength - 1] = 0x5d;
  const tamperedResponse = await fetch(endpoint, {
    body: tamperedBody,
    headers: signed.request.headers,
    method: "POST",
  });
  expect(tamperedResponse.status).toBe(401);
  expect(tamperedResponse.headers.get("content-type")).toBe(
    "application/problem+json",
  );
  expect(await tamperedResponse.json()).toMatchObject({
    status: 401,
    title: "Authentication failed",
    type: "/problems/authentication_failed",
  });

  const runAfterTamper = await request.get(`/api/v1/runs/${E2E_RUN.runId}`);
  expect(runAfterTamper.status()).toBe(200);
  expect(PublicRunResponseSchema.parse(await runAfterTamper.json())).toEqual(
    stored,
  );
  const latestAfterTamper = await request.get("/api/v1/latest");
  expect(latestAfterTamper.status()).toBe(200);
  expect(LatestRunResponseSchema.parse(await latestAfterTamper.json())).toEqual(
    latest,
  );
});
