# CodexSpeed MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, deploy, and verify a display-only Codex performance dashboard whose locally generated benchmark runs are uploaded through a signed machine endpoint.

**Architecture:** A pnpm TypeScript workspace shares strict run contracts and deterministic metric code between a Node.js Codex App Server runner and a Cloudflare Worker. The Worker authenticates immutable uploads, recomputes summaries, stores run JSON in D1, and serves a Vite React dashboard through Workers Static Assets.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript 5, Zod, Vitest, Codex App Server JSON-RPC, Hono, Cloudflare Workers Static Assets, D1, Vite 7, React 19, React Router, Playwright.

## Global Constraints

- The website is display-only and must never start a Codex turn or receive a Codex/OpenAI credential.
- The runner uses the installed `codex app-server` and existing ChatGPT authentication, not an API key.
- Published uploads are at most 1 MiB and 200 samples; unknown fields and non-finite numbers are rejected.
- `ultra` is excluded from the comparable matrix; Fast service tiers are not used by the default suite.
- Every benchmark invocation requires `--max-turns`; smoke mode remains bounded to explicitly selected cells.
- Server code recomputes validity, metrics, and aggregates from raw sample fields.
- “Runner Verified” describes publisher authentication only; no page may say or imply “OpenAI Verified.”
- The UI uses no OpenAI logo and includes the independent-project disclaimer.
- Production target is `https://codexspeed.timmyagentic.com` on Cloudflare Workers Free plus D1 Free.
- All unit, Worker integration, runner integration, browser E2E, and production upload/display checks must pass before handoff.

---

## File map

```text
package.json                         root scripts and pinned package manager
pnpm-workspace.yaml                  workspace membership
tsconfig.base.json                   strict shared TypeScript options
AGENTS.md                            repository-specific contributor rules
.github/workflows/ci.yml             repeatable pull-request gate

packages/contracts/src/run.ts        strict uploaded run schema and types
packages/contracts/src/public.ts     public response schemas and types
packages/contracts/src/fixture.ts    canonical deterministic test run
packages/contracts/src/index.ts      package exports

packages/metrics/src/sample.ts       sample validity and derived metrics
packages/metrics/src/summary.ts      deterministic per-cell/run aggregation
packages/metrics/src/index.ts        package exports

packages/runner/src/app-server.ts    stdio JSON-RPC process and request router
packages/runner/src/catalog.ts       model discovery and comparable selection
packages/runner/src/recorder.ts      App Server event-to-sample state reducer
packages/runner/src/scheduler.ts     seeded warm-up and measured trial order
packages/runner/src/publisher.ts     exact-body HMAC upload client
packages/runner/src/prompt.ts        versioned public prompt and validator
packages/runner/src/commands/*.ts    doctor, run, plan, and publish commands
packages/runner/src/cli.ts           `codexspeed` command entrypoint

apps/web/src/worker/auth.ts          upload request hash/HMAC verification
apps/web/src/worker/repository.ts    D1 immutable run and latest-pointer access
apps/web/src/worker/problem.ts       RFC 9457-style problem responses
apps/web/src/worker/index.ts         Hono API routes and response headers
apps/web/migrations/0001_initial.sql D1 schema
apps/web/wrangler.jsonc              Worker, assets, D1, and custom-domain config
apps/web/src/app/*                   React shell, routing, and data loading
apps/web/src/components/*            matrix, compare, samples, and metadata UI
apps/web/src/styles.css              visual system and responsive behavior

tests/e2e/*.spec.ts                  browser and signed-upload journeys
docs/methodology/*                   prompt, formulas, limitations, references
scripts/production-e2e.mjs           deployed health/upload/tamper/read verifier
```

### Task 1: Bootstrap the strict workspace and versioned run contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `LICENSE`
- Create: `AGENTS.md`
- Create: `.github/workflows/ci.yml`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/run.ts`
- Create: `packages/contracts/src/public.ts`
- Create: `packages/contracts/src/fixture.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/run.test.ts`

**Interfaces:**
- Produces: `RunUploadSchema`, `RunUpload`, `PublicRunSchema`, `PublicRun`, `createRunFixture()`.
- Consumes: no earlier task.

- [ ] **Step 1: Write a failing strict-schema test**

```ts
import { describe, expect, it } from "vitest";
import { createRunFixture, RunUploadSchema } from "./index.js";

describe("RunUploadSchema", () => {
  it("accepts the canonical fixture and rejects unknown data", () => {
    expect(RunUploadSchema.parse(createRunFixture()).schemaVersion).toBe(1);
    expect(() => RunUploadSchema.parse({ ...createRunFixture(), accessToken: "secret" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing package fails**

Run: `corepack pnpm install && corepack pnpm --filter @codexspeed/contracts test`
Expected: FAIL because `./index.js` and `RunUploadSchema` do not exist.

- [ ] **Step 3: Implement exact schema boundaries**

Define strict Zod objects for `environment`, `catalog`, `selection`, and samples.
Use these stable sample fields:

```ts
type RunSample = {
  sampleId: string;
  model: string;
  effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  phase: "warmup" | "measured";
  round: number;
  attempt: number;
  status: "completed" | "failed";
  firstVisibleTextMs: number | null;
  lastVisibleTextMs: number | null;
  totalLatencyMs: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  agentMessageCount: number;
  toolEventCount: number;
  reroutedTo: string | null;
  validatorPassed: boolean;
  validatorReason: "ok" | "too_short" | "bad_structure" | "missing_output";
  errorCode: "turn_failed" | "protocol_error" | "timeout" | "missing_token_usage" | null;
};
```

Refine the schema so `startedAt <= endedAt`, relative timings are ordered,
`reasoningOutputTokens <= outputTokens`, sample/model references exist in the
catalog, arrays are bounded, and all objects are strict. Export a deterministic
fixture with one valid measured sample and one invalid measured sample.

- [ ] **Step 4: Add rejection cases and make the package green**

Add table tests for invalid UUID, date order, timing order, token counts,
unknown model, more than 200 samples, and strings matching `sk-`, `Bearer `,
JWT, private-key, or credential-assignment patterns. Run:

`corepack pnpm --filter @codexspeed/contracts test && corepack pnpm --filter @codexspeed/contracts typecheck`

Expected: all contract tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .npmrc LICENSE AGENTS.md .github packages/contracts
git commit -m "feat: define benchmark run contract"
```

### Task 2: Compute sample validity and deterministic summaries

**Files:**
- Create: `packages/metrics/package.json`
- Create: `packages/metrics/tsconfig.json`
- Create: `packages/metrics/src/sample.ts`
- Create: `packages/metrics/src/summary.ts`
- Create: `packages/metrics/src/index.ts`
- Test: `packages/metrics/src/sample.test.ts`
- Test: `packages/metrics/src/summary.test.ts`

**Interfaces:**
- Consumes: `RunUpload`, `RunSample` from `@codexspeed/contracts`.
- Produces: `evaluateSample(sample, minVisibleTokens)`, `summarizeRun(run)`, `SampleEvaluation`, `RunSummary`.

- [ ] **Step 1: Write failing formula and validity tests**

```ts
const result = evaluateSample(createRunFixture().samples[0], 400);
expect(result).toMatchObject({
  valid: true,
  visibleTokens: 500,
  metrics: {
    firstVisibleTextMs: 1000,
    visibleStreamTpsEstimate: 49.9,
    visibleE2eTps: 40,
    generatedE2eTps: 48,
    totalLatencyMs: 12500,
  },
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `corepack pnpm --filter @codexspeed/metrics test`
Expected: FAIL because `evaluateSample` and `summarizeRun` are missing.

- [ ] **Step 3: Implement formulas and stable invalid-reason precedence**

Use this precedence: failed turn, reroute, tool event, message count, missing
visible timestamps, token invariant, minimum visible tokens, validator. Round
stored metric values to six decimal places; do not round before aggregation.
Return `visibleStreamTpsEstimate: null` when visible tokens are below two or the
visible stream duration is zero.

- [ ] **Step 4: Implement p50/min/max/n aggregation**

Group valid measured samples by the exact `${model}\u0000${effort}` tuple.
Median is the middle value for odd `n` and the arithmetic mean of the two middle
values for even `n`. Include reliability counts for every measured sample and
coverage counts from `selection`. Never aggregate warm-ups.

- [ ] **Step 5: Run tests and commit**

```bash
corepack pnpm --filter @codexspeed/metrics test
corepack pnpm --filter @codexspeed/metrics typecheck
git add packages/metrics
git commit -m "feat: calculate benchmark metrics"
```

### Task 3: Authenticate uploads and expose deterministic problem responses

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/wrangler.jsonc`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/worker/env.ts`
- Create: `apps/web/src/worker/auth.ts`
- Create: `apps/web/src/worker/problem.ts`
- Test: `apps/web/src/worker/auth.test.ts`

**Interfaces:**
- Consumes: exact request bytes, `PUBLISHER_KEY_ID`, `PUBLISHER_HMAC_SECRET`.
- Produces: `verifyUploadRequest(request, env, now): Promise<VerifiedUpload>` and `problem(status, code, title, requestId)`.

- [ ] **Step 1: Write fixed HMAC vectors**

The canonical message is exactly seven UTF-8 lines with no trailing newline:

```text
codexspeed-hmac-v1\nPOST\n/api/v1/runs\n2026-07-16T08:00:00.000Z\npublisher-v1\n01900000-0000-7000-8000-000000000001\n<lowercase-body-sha256>
```

Tests cover success, stale and future timestamps, missing headers, wrong key,
wrong body hash, wrong signature, body over 1 MiB, content type other than
`application/json`, and idempotency key mismatch.

- [ ] **Step 2: Verify the authentication tests fail**

Run: `corepack pnpm --filter @codexspeed/web test:worker -- auth.test.ts`
Expected: FAIL because the Worker authentication module does not exist.

- [ ] **Step 3: Implement verification before parsing**

Stream at most 1,048,577 bytes and abort when the sentinel byte exists. Calculate
SHA-256 with Web Crypto, compare the declared digest, import the base64url secret
as an HMAC-SHA256 key, and call `crypto.subtle.verify` over the version, method,
path, timestamp, signed key ID, idempotency key, and hash. Enforce a 300,000 ms
absolute clock window. Return the verified bytes and idempotency key; never log
the bytes or authentication headers.

- [ ] **Step 4: Implement problem JSON and pass tests**

Every failure response has `Content-Type: application/problem+json`,
`Cache-Control: no-store`, a stable `/problems/<code>` type, and the request ID.
Authentication variants all return the same 401 code and title.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/wrangler.jsonc apps/web/vitest.config.ts apps/web/src/worker
git commit -m "feat: authenticate benchmark uploads"
```

### Task 4: Store immutable runs in D1 and implement the public API

**Files:**
- Create: `apps/web/migrations/0001_initial.sql`
- Create: `apps/web/src/worker/repository.ts`
- Create: `apps/web/src/worker/security.ts`
- Create: `apps/web/src/worker/index.ts`
- Create: `apps/web/test/apply-migrations.ts`
- Test: `apps/web/src/worker/index.test.ts`

**Interfaces:**
- Consumes: `verifyUploadRequest`, `RunUploadSchema`, `summarizeRun`, D1 binding `DB`.
- Produces: Worker `fetch`, `insertRunAndAdvanceLatest`, `getLatest`, `getRun`, `listRuns`.

- [ ] **Step 1: Write Worker integration tests against isolated D1**

Use `cloudflare:test` `env`, `SELF`, and `applyD1Migrations`. Assert empty latest
404, signed create 201, byte-identical duplicate 200, different body with the
same run ID 409, newest latest, duplicate old run not repointed, list pagination,
run lookup, malformed schema 422, ETags/304, and cache/security headers.

- [ ] **Step 2: Verify the tests fail against the missing Worker**

Run: `corepack pnpm --filter @codexspeed/web test:worker`
Expected: FAIL because the migration and Worker export do not exist.

- [ ] **Step 3: Implement the D1 migration and repository**

Create `runs` and `site_state` exactly as the design specifies. For new runs,
use one `DB.batch()` containing the insert and latest-pointer upsert. On a unique
constraint race, re-read by ID: matching hash is idempotent success; differing
hash is conflict. Existing identical requests return before any pointer update.

- [ ] **Step 4: Implement API routes**

Implement:

```text
GET  /api/v1/health
GET  /api/v1/latest
GET  /api/v1/runs?cursor=<base64url>&limit=1..50
GET  /api/v1/runs/:runId
POST /api/v1/runs
```

Parse only after HMAC verification, validate with `RunUploadSchema`, recompute
`RunSummary`, and store both serialized documents. Use a long immutable cache
for run IDs, no-store plus ETag revalidation for latest, 30 seconds for list,
and no-store for writes/errors. Add CSP,
HSTS, nosniff, referrer policy, permissions policy, frame denial, and an explicit
write-route CORS rejection.

- [ ] **Step 5: Run Worker tests and commit**

```bash
corepack pnpm --filter @codexspeed/web test:worker
corepack pnpm --filter @codexspeed/web typecheck:worker
git add apps/web
git commit -m "feat: publish immutable runs through D1"
```

### Task 5: Integrate the Codex App Server and reduce streamed events

**Files:**
- Create: `packages/runner/package.json`
- Create: `packages/runner/tsconfig.json`
- Create: `packages/runner/src/app-server.ts`
- Create: `packages/runner/src/catalog.ts`
- Create: `packages/runner/src/recorder.ts`
- Create: `packages/runner/src/prompt.ts`
- Create: `packages/runner/test/fake-app-server.mjs`
- Test: `packages/runner/src/app-server.test.ts`
- Test: `packages/runner/src/recorder.test.ts`

**Interfaces:**
- Consumes: installed `codex app-server`; monotonic `now()` dependency.
- Produces: `AppServerClient`, `discoverCatalog(client)`, `recordTrial(client, request, clock)`, `BENCHMARK_PROMPT`, `validateOutput(text)`.

- [ ] **Step 1: Write fake-server lifecycle and event-reducer tests**

The fake process must answer `initialize`, `initialized`, `model/list`,
`thread/start`, and `turn/start`; then emit two agent-message deltas, a token
usage update, and `turn/completed`. Additional scenarios emit reroute, command
item, turn failure, malformed JSON, and process exit.

- [ ] **Step 2: Verify tests fail**

Run: `corepack pnpm --filter @codexspeed/runner test -- app-server.test.ts recorder.test.ts`
Expected: FAIL because the client and reducer are missing.

- [ ] **Step 3: Implement newline-delimited JSON-RPC client**

Spawn with argument arrays and `shell: false`. Correlate numeric request IDs,
route notifications to subscribed listeners, bound line size and stderr tail,
apply per-request and per-turn timeouts, reject all pending promises on exit,
and implement graceful shutdown. Never serialize the environment or stderr into
the public result.

- [ ] **Step 4: Implement discovery and recording**

Map only the allow-listed visible model fields and efforts App Server reports;
never retain the raw catalog object. Create a new thread for each trial. Record
relative monotonic timings for the first/last non-empty visible deltas and
completion. Count final agent messages and all command/file/MCP/web tool-like
items. Use the newest thread usage snapshot and wait up to one second after
completion when none has arrived; otherwise record `missing_token_usage`. Store
no response text after the structural validator returns its enum result.

- [ ] **Step 5: Pass runner integration tests and commit**

```bash
corepack pnpm --filter @codexspeed/runner test
corepack pnpm --filter @codexspeed/runner typecheck
git add packages/runner
git commit -m "feat: record Codex App Server trials"
```

### Task 6: Build the bounded seeded suite and CLI

**Files:**
- Create: `packages/runner/src/scheduler.ts`
- Create: `packages/runner/src/commands/doctor.ts`
- Create: `packages/runner/src/commands/plan.ts`
- Create: `packages/runner/src/commands/run.ts`
- Create: `packages/runner/src/cli.ts`
- Test: `packages/runner/src/scheduler.test.ts`
- Test: `packages/runner/src/cli.test.ts`
- Create: `docs/methodology/prompt-v1.md`

**Interfaces:**
- Consumes: catalog discovery, `recordTrial`, contract schemas.
- Produces: `buildSchedule(catalog, options)`, `executeSchedule`, CLI commands `doctor`, `plan`, `run`.

- [ ] **Step 1: Write scheduler tests**

Assert one default-effort warm-up per selected model, three measured rounds,
Ultra exclusion, deterministic seeded Fisher-Yates order, model/effort filters,
sequential execution, exact turn count, and refusal when planned turns exceed
`maxTurns`.

- [ ] **Step 2: Verify scheduler tests fail**

Run: `corepack pnpm --filter @codexspeed/runner test -- scheduler.test.ts cli.test.ts`
Expected: FAIL because scheduler and CLI commands are missing.

- [ ] **Step 3: Implement CLI safety and artifact writing**

Support:

```text
codexspeed doctor
codexspeed plan [--model ID] [--effort VALUE] [--rounds N] --max-turns N
codexspeed run  [--model ID] [--effort VALUE] [--rounds N] --max-turns N --out FILE
```

`doctor` checks CLI version, `codex login status`, handshake, and catalog without
starting a turn. `plan` makes no turns. `run` prints plan/remaining progress,
creates a private temporary empty workspace and temporary `CODEX_HOME`, copies
only the current authentication material with owner-only permissions, supplies
no global config/AGENTS/plugins/skills/hooks/history/MCP, runs sequentially,
validates the complete artifact with `RunUploadSchema`, writes deterministic
compact JSON, marks mode `smoke` unless the full discovered comparable matrix
has all configured rounds, and securely removes both temporary directories.

- [ ] **Step 4: Pass command tests and run the live doctor**

```bash
corepack pnpm --filter @codexspeed/runner test
corepack pnpm --filter @codexspeed/runner build
corepack pnpm codexspeed doctor
```

Expected: unit/integration tests pass; live doctor prints Codex version, ChatGPT
login, App Server protocol success, and a non-empty model catalog without a turn.

- [ ] **Step 5: Commit**

```bash
git add packages/runner docs/methodology/prompt-v1.md
git commit -m "feat: add bounded benchmark suite CLI"
```

### Task 7: Sign, publish, and verify exact run artifacts

**Files:**
- Create: `packages/runner/src/publisher.ts`
- Create: `packages/runner/src/commands/publish.ts`
- Test: `packages/runner/src/publisher.test.ts`
- Modify: `packages/runner/src/cli.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: validated JSON artifact, endpoint, key ID, base64url HMAC secret.
- Produces: `createSignedRequest(body, options)` and `codexspeed publish FILE --endpoint URL`.

- [ ] **Step 1: Write exact-byte publisher tests**

Start a local test server, capture the raw bytes and headers, independently
verify the signature, return a public response, and assert the CLI verifies that
response run ID and payload hash. Also test missing secret, non-HTTPS endpoint
unless `--allow-http-localhost`, 401, 409, 413, 422, timeout, and response mismatch.

- [ ] **Step 2: Verify tests fail**

Run: `corepack pnpm --filter @codexspeed/runner test -- publisher.test.ts`
Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement publisher without reserialization drift**

Read the artifact bytes, parse and validate once, use those same bytes for
SHA-256 and request body, generate the timestamp at send time, sign the canonical
seven-line message including the version and key ID, and set all required headers. Read secrets from
`CODEXSPEED_KEY_ID` and `CODEXSPEED_HMAC_SECRET`; never accept them as visible CLI
arguments or print them. Default endpoint is the production hostname.

- [ ] **Step 4: Pass tests, document commands, and commit**

```bash
corepack pnpm --filter @codexspeed/runner test
corepack pnpm --filter @codexspeed/runner typecheck
git add packages/runner README.md
git commit -m "feat: publish signed benchmark artifacts"
```

### Task 8: Build the responsive public dashboard

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/api.ts`
- Create: `apps/web/src/app/format.ts`
- Create: `apps/web/src/app/routes/*.tsx`
- Create: `apps/web/src/components/*.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/public/_headers`
- Test: `apps/web/src/app/format.test.ts`
- Test: `apps/web/src/components/MetricMatrix.test.tsx`

**Interfaces:**
- Consumes: public latest/list/run API response types.
- Produces: routes `/`, `/runs`, `/runs/:runId`, `/methodology` and accessible reusable components.

- [ ] **Step 1: Read and apply the frontend builder skill**

Before UI code, read `build-web-apps:frontend-app-builder` completely. Preserve
the approved editorial/data-instrument direction and independent-brand copy.

- [ ] **Step 2: Write failing format and matrix interaction tests**

Test metric value/unit formatting, lower-is-better color normalization,
unsupported/excluded/unmeasured/invalid/measured cells, keyboard selection, two
cell comparison, empty state, and a latest API error with retry.

- [ ] **Step 3: Verify UI tests fail**

Run: `corepack pnpm --filter @codexspeed/web test:ui`
Expected: FAIL because the React application and components are missing.

- [ ] **Step 4: Implement pages and design system**

Use semantic landmarks, a desktop table and mobile stacked grid with equivalent
content, tabular numerals, visible focus, reduced-motion rules, AA contrast, and
URL-addressable routes. The homepage shows publication status, metric selector,
matrix, compare panel, reliability, and method links. The detail page shows all
samples including invalid reasons. The footer contains the independent-project
disclaimer and repository link.

- [ ] **Step 5: Build, test, and commit**

```bash
corepack pnpm --filter @codexspeed/web test:ui
corepack pnpm --filter @codexspeed/web typecheck:ui
corepack pnpm --filter @codexspeed/web build
git add apps/web
git commit -m "feat: build CodexSpeed dashboard"
```

### Task 9: Add full local API/browser E2E and public methodology

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/upload.spec.ts`
- Create: `tests/e2e/dashboard.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `docs/methodology/README.md`
- Create: `docs/methodology/formulas.md`
- Create: `docs/methodology/limitations.md`
- Create: `scripts/check-sensitive-output.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: built Worker, local D1, signed publisher, browser UI.
- Produces: `pnpm check` and `pnpm test:e2e` release gates.

- [ ] **Step 1: Write browser journeys before final wiring**

The setup uploads `createRunFixture()` through the real HMAC route. Tests assert
latest matrix, all four metrics, comparison, invalid sample, history/detail,
methodology, deep reload, 375 px mobile presentation, keyboard traversal, and
no serious automated accessibility violations.

- [ ] **Step 2: Verify at least one journey fails**

Run: `corepack pnpm test:e2e`
Expected: FAIL until the dev orchestration, routing, and seed helper are wired.

- [ ] **Step 3: Wire one-command local integration and sensitive-output scan**

Start the built Worker with an isolated local D1, apply migrations, inject only
test publisher secrets, and run Playwright. Scan tracked files, built assets,
fixtures, and captured output for API keys, bearer tokens, private keys, local
user paths, and raw App Server transcripts. Make `pnpm check` run format check,
lint, typecheck, unit/integration tests, build, sensitive scan, and browser E2E.

- [ ] **Step 4: Complete methodology and run the whole gate**

Document exact prompt, formulas, warm-up/scheduling rules, invalidity reasons,
estimated-stream limitation, Ultra exclusion, smoke/full distinction, runner
verification meaning, cost safety, and reference projects/licenses.

Run: `corepack pnpm check`
Expected: every package test, Worker integration test, build, scan, and browser
journey passes from a clean checkout.

- [ ] **Step 5: Commit**

```bash
git add package.json playwright.config.ts tests docs scripts .github README.md
git commit -m "test: verify local benchmark publication flow"
```

### Task 10: Deploy Cloudflare and verify the genuine production loop

**Files:**
- Create: `scripts/production-e2e.mjs`
- Create: `docs/operations.md`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `README.md`

**Interfaces:**
- Consumes: authenticated Cloudflare account/zone, D1, Worker secret, built app, installed/logged-in Codex.
- Produces: live `codexspeed.timmyagentic.com`, immutable genuine smoke run, production verification record.

- [ ] **Step 1: Read deployment and completion skills**

Read `cloudflare:wrangler`, `cloudflare:workers-best-practices`,
`superpowers:verification-before-completion`, and the applicable browser
verification skill completely before changing production state.

- [ ] **Step 2: Provision and configure production**

Verify `wrangler whoami` and Free-plan context. Create one D1 database named
`codexspeed`, write its ID to `wrangler.jsonc`, configure
`codexspeed.timmyagentic.com` as a custom domain, generate a random 32-byte
publisher secret locally, set `PUBLISHER_KEY_ID` and `PUBLISHER_HMAC_SECRET` as
Worker secrets, apply remote migrations, build, and deploy. Do not delete or
replace unrelated DNS records, Workers, databases, or credentials.

- [ ] **Step 3: Run pre-publication production checks**

Verify DNS, TLS, `/api/v1/health`, empty/latest behavior, static asset cache,
security headers, SPA deep links, and that an unsigned/tampered upload is 401.
Run a production Playwright smoke on desktop and mobile.

- [ ] **Step 4: Generate one bounded real smoke run**

Use live catalog discovery, select one current model at its default comparable
effort, one measured round, no warm-up if the CLI's smoke flag explicitly says
so, and `--max-turns 1`. Confirm the printed plan is one turn before starting.
Store the private local artifact outside the repository; ensure it contains no
response text, local path, account data, or secret.

- [ ] **Step 5: Publish and prove the production invariants**

Publish the real artifact, publish the identical bytes again and require
idempotent success, then send one body-tampered request with the original
signature and require 401. Fetch run/latest and compare raw fields plus
independently recomputed summary to the artifact. In Playwright, assert the
published run, cell, sample, Runner Verified explanation, history, detail, and
methodology are visible at the custom hostname.

- [ ] **Step 6: Re-run all gates and commit operations evidence**

```bash
corepack pnpm check
corepack pnpm production:e2e -- --artifact /private/path/run.json
git diff --check
git status --short
git add apps/web/wrangler.jsonc scripts/production-e2e.mjs docs/operations.md README.md
git commit -m "ops: deploy and verify CodexSpeed"
```

The committed operations document records commands, deployment revision,
database name (not secret), hostname, run ID, response statuses, and test
results. It never records the publisher secret or local artifact path.

- [ ] **Step 7: Push and open the implementation pull request**

```bash
git push -u origin codex/mvp
gh pr create --base main --head codex/mvp --title "Build and deploy CodexSpeed MVP" --body-file /tmp/codexspeed-pr.md
gh pr view --json url,state,mergeStateStatus,statusCheckRollup
```

Expected: the PR is Ready, contains the design/implementation summary and exact
verification commands, and the deployed revision matches the pushed branch.
