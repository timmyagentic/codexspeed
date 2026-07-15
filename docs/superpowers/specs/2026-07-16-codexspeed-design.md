# CodexSpeed MVP Design

Date: 2026-07-16  
Status: Approved for implementation  
Repository: `timmyagentic/codexspeed`  
Production hostname: `codexspeed.timmyagentic.com`

## 1. Product definition

CodexSpeed is an independent, reproducible benchmark for comparing current
Codex models across their supported reasoning efforts. It measures response
timing and visible output throughput under one controlled prompt and presents
the results as a public dashboard.

The website is display-only. The benchmark itself runs on the publisher's Mac
through the installed Codex CLI App Server and the publisher's existing ChatGPT
authentication. A local command signs and uploads a complete, sanitized run.
The production service never starts a Codex turn, stores an OpenAI credential,
or exposes a public benchmark execution endpoint.

### 1.1 MVP outcome

A visitor can:

1. see the newest benchmark matrix for all measured model/effort pairs;
2. switch between speed and latency metrics;
3. compare any two measured cells;
4. inspect every trial, invalid sample, environment field, and calculation;
5. read the exact methodology and reproduce the benchmark locally;
6. browse earlier immutable runs.

The publisher can:

1. discover the current model catalog from Codex App Server;
2. run a bounded, randomized benchmark suite locally;
3. validate and sanitize the result before it leaves the machine;
4. upload it through an authenticated, idempotent CLI command;
5. verify that the same immutable run is now the site's latest publication.

### 1.2 Non-goals

The MVP does not include public accounts, community submissions, a browser
upload form, a “run now” button, quality scoring, a composite leaderboard,
OpenAI API-key benchmarks, an admin panel, alerts, or automated schedules.

## 2. Product principles

- **Transparent over absolute.** The site shows exact prompt, raw durations,
  sample counts, invalid results, formulas, software versions, and limitations.
- **Comparable over comprehensive.** One controlled task and strict execution
  rules are more useful than a collection of unrelated prompts in the MVP.
- **No surprise spending.** Every benchmark has an explicit maximum number of
  turns. The hosting design stays inside Cloudflare Free limits and fails closed
  if a platform limit is reached.
- **Immutable evidence.** A published run never changes. Publishing a new run
  advances one atomic latest pointer.
- **Independent identity.** “Runner Verified” means the payload came from the
  configured publisher key. It never implies verification or endorsement by
  OpenAI.

## 3. Reference implementations

The implementation follows ideas from these open-source projects without
copying their product surface:

- `openai/codex` (Apache-2.0): App Server protocol and event stream are the
  authoritative integration point.
- `minghinmatthewlam/openbench` (MIT): catalog matrix, doctor command, and
  machine-readable run artifacts.
- `ai-dynamo/aiperf` (Apache-2.0): monotonic timing, warm-up separation,
  explicit failure accounting, and distribution summaries.
- `fahd09/watchtower` (MIT): event-stream observation ideas. CodexSpeed does not
  proxy OAuth traffic and does not reuse its throughput formula.
- `cipher982/llm-benchmarks`: visible/reasoning token separation and failure
  taxonomy.

## 4. System architecture

The repository is a TypeScript workspace with three deployable concerns:

```text
Codex App Server (local stdio JSON-RPC)
        │
        ▼
packages/runner ── validates/sanitizes ── HMAC HTTPS upload
                                              │
                                              ▼
                                Cloudflare Worker + D1
                                              │
                                  immutable public run JSON
                                              │
                                              ▼
                                  static dashboard assets
```

Suggested layout:

```text
apps/web/                 Vite React static UI and Worker API
packages/contracts/      versioned schemas and public types
packages/metrics/        deterministic validation and calculations
packages/runner/         App Server client, suite runner, publisher CLI
tests/e2e/                local and production browser/API journeys
docs/methodology/         public methodology sources
```

The web build produces static HTML, CSS, and JavaScript with client-side
routing. Cloudflare Static Assets uses `single-page-application` fallback so a
future `/runs/:run_id` deep link returns the application shell even though that
run did not exist at build time. Static requests do not invoke Worker code;
`assets.run_worker_first` routes only `/api/*` to the Worker. D1 is the only
production datastore.

## 5. Local benchmark protocol

### 5.1 Catalog discovery

At the beginning of each run, the runner starts `codex app-server`, performs the
JSON-RPC initialization handshake, and calls `model/list`. It projects the
visible catalog into a fixed allow-list containing only model identifiers,
display names, visibility, default effort, and supported reasoning efforts. It
never retains or uploads the raw response object, so new App Server fields cannot
silently enter the public payload.

The comparable matrix contains every non-hidden model/effort combination except
`ultra`. Ultra is excluded because its documented subagent behavior is not a
single-agent reasoning-effort comparison. Unsupported combinations are never
invented or silently substituted.

### 5.2 Controlled environment

Each trial uses:

- a dedicated empty workspace;
- read-only sandboxing;
- no MCP server, plugin, web lookup, shell command, or file mutation;
- the default Codex service tier;
- one new thread and one user turn;
- one versioned, public synthetic prompt;
- sequential execution, so trials do not compete locally;
- monotonic clocks for durations and UTC wall clocks for audit metadata.

The runner creates a private temporary `CODEX_HOME` containing only a temporary
copy of the existing authentication material and no `config.toml`, AGENTS file,
plugin, skill, hook, history, or MCP configuration. It also uses a separate
temporary workspace whose parent chain contains no project instructions. Both
directories are removed after the run. This preserves the existing ChatGPT
login while preventing the publisher's normal Codex configuration from changing
the benchmark. The runner applies explicit read-only, no-search, default-tier,
and non-interactive settings. Any tool-like event still invalidates the sample.

The prompt combines moderate reasoning with a deterministic structured response
of at least 400 visible tokens. A validator checks section headings, response
shape, and the minimum visible-token threshold. The benchmark measures speed,
not answer quality.

### 5.3 Scheduling and warm-up

The default full suite performs one unmeasured warm-up per model at its default
effort, followed by three measured rounds. Within each round, model/effort cells
are randomly interleaved with a recorded seed. Trials run sequentially.

The CLI requires an explicit `--max-turns` guard and refuses a plan larger than
that value. A dry-run prints the exact matrix and turn count. A smoke mode can
run one or a few selected cells for integration testing without claiming full
matrix coverage.

Retries are never silent. A retry receives a new sample and attempt identifier;
the original failure remains in the run and contributes to reliability counts.

### 5.4 App Server events

For each measured turn, the runner records:

- `t0`: immediately before sending `turn/start`;
- `tv`: receipt of the first non-empty `item/agentMessage/delta`;
- `tl`: receipt of the last visible agent-message delta;
- `te`: receipt of `turn/completed`;
- output and reasoning-output token totals from
  `thread/tokenUsage/updated`;
- turn status, model reroute events, message count, and any tool-like item.

Every trial uses a new thread, so thread-cumulative usage belongs only to that
trial. The recorder retains the newest usage snapshot observed before
`turn/completed`; if none exists it waits up to one second for a final
`thread/tokenUsage/updated` notification. A missing final snapshot produces the
stable `missing_token_usage` invalid reason instead of a zero-token result.

No prompt, reasoning text, local path, account identifier, access token, or App
Server transcript is uploaded. The fixed public prompt is referenced by suite
version and stored in the repository.

### 5.5 Validity rules

A measured sample is valid only when all conditions hold:

- the turn completes successfully;
- exactly one final agent message exists;
- no command, file, MCP, web, or other tool event occurs;
- the requested model is not rerouted;
- `t0 <= tv <= tl <= te`;
- output token counts are finite non-negative integers;
- visible tokens are positive and meet the suite threshold;
- the output passes the suite's structural validator.

Invalid, failed, and rerouted samples remain publicly visible with a stable
reason code but are excluded from speed aggregation.

## 6. Metrics

Let:

- `O` be reported output tokens;
- `R` be reported reasoning-output tokens;
- `V = O - R` be estimated visible output tokens;
- all durations be derived from the monotonic timestamps above.

The MVP reports:

```text
first_visible_text_ms = tv - t0
visible_stream_tps_est = (V - 1) / ((tl - tv) / 1000)
visible_e2e_tps = V / ((te - t0) / 1000)
generated_e2e_tps = O / ((te - t0) / 1000)
total_latency_ms = te - t0
```

`visible_stream_tps_est` is explicitly labeled as an estimate because App
Server sends text chunks rather than one event per token. When `V < 2` or the
visible stream duration is zero, that metric is unavailable rather than
infinite.

The server recomputes every derived metric from raw durations and token counts.
It never trusts a client-provided aggregate. Each model/effort cell shows p50,
minimum, maximum, and valid sample count. p95/p99 are omitted until at least 20
valid samples exist. There is no composite score.

## 7. Versioned upload contract

### 7.1 Payload

`POST /api/v1/runs` accepts one complete JSON run. The request is limited to 1
MiB and 200 samples. Unknown properties are rejected. The schema includes:

- schema, suite, protocol, runner, and Codex CLI versions;
- UUIDv7 run ID, UTC start/end timestamps, run mode, seed, and status;
- sanitized environment fields (OS family/version, architecture, broad region,
  auth channel, service tier); 
- catalog snapshot and selected matrix;
- fixed prompt identifier and hash;
- per-sample requested model/effort, phase/round/attempt, raw durations, token
  counts, status, stable error/reason codes, and validator result.

The upload must not contain free-form exception text or arbitrary environment
maps. Schema-level prohibited-name and secret-pattern checks provide a second
line of defense against accidental credential publication.

### 7.2 Authentication

The publisher uses an HMAC-SHA256 key stored only in a local secret source and a
Cloudflare Worker Secret. Requests include:

```text
X-Benchmark-Key-Id
X-Benchmark-Timestamp
X-Content-SHA256
X-Benchmark-Signature
Idempotency-Key
```

The exact UTF-8 canonical message is seven lines with no trailing newline:

```text
codexspeed-hmac-v1
POST
/api/v1/runs
2026-07-16T08:00:00.000Z
publisher-v1
01900000-0000-7000-8000-000000000001
<lowercase hexadecimal SHA-256 of the exact request bytes>
```

The timestamp is UTC RFC 3339 with exactly three fractional-second digits, the
canonical path is exactly `/api/v1/runs` with no query, the key ID is signed,
and the signature is unpadded base64url HMAC-SHA256. The publisher emits
deterministic compact JSON and signs/sends the same bytes; repeat publication
uses the existing artifact bytes without reserialization. The Worker streams at
most 1 MiB plus one sentinel byte and aborts an oversized body even when
`Content-Length` is absent or false. It verifies the byte hash and HMAC with Web
Crypto before JSON parsing, requires the idempotency key to equal the parsed run
ID, and accepts timestamps within five minutes.

### 7.3 Idempotency and atomic publication

Publishing the same run ID with the same exact request-byte hash returns the
existing successful result. Semantically equivalent JSON with different bytes
is intentionally a conflict. Reusing a run ID with different bytes returns 409.
The Worker first checks for an existing ID, then uses one D1 batch to insert the
immutable run and upsert the singleton latest pointer. If a concurrent insert
wins, the failed request rereads that ID and returns idempotent success or 409 by
hash. The existing-run path never updates the pointer, so repeating an older run
cannot make it latest.

### 7.4 Error shape

API errors use `application/problem+json` with a stable `type`, human-readable
`title`, HTTP `status`, and request identifier. Expected statuses are 400, 401,
409, 413, 415, 422, 429, and 503. Authentication failures do not reveal whether
the key ID, timestamp, hash, or signature was wrong.

## 8. D1 model

The MVP deliberately stores a complete sanitized public run document rather
than normalizing every sample:

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  runner_version TEXT NOT NULL,
  codex_cli_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  status TEXT NOT NULL,
  public_payload_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX runs_published_at_idx ON runs(published_at DESC, run_id DESC);

CREATE TABLE site_state (
  key TEXT PRIMARY KEY CHECK (key = 'latest'),
  latest_run_id TEXT NOT NULL REFERENCES runs(run_id),
  generation INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

The 1 MiB application limit is below D1's row-size ceiling. This shape keeps a
run immutable, minimizes reads, and lets the public API return a precomputed
server summary without reconstructing it from many rows.

## 9. Public API and cache behavior

- `GET /api/v1/latest` returns the latest full public run and summary.
- `GET /api/v1/runs?cursor=&limit=20` returns newest-first run metadata.
- `GET /api/v1/runs/:run_id` returns one immutable full public run and summary.
- `GET /api/v1/health` reports only service/database reachability and schema
  compatibility; it exposes no secret or account data.

Immutable run responses use a long public cache lifetime and ETags derived from
the payload hash. Latest responses use ETags but disable browser and edge
caching so a successful upload is immediately observable without an explicit
cache purge. List responses use a short public cache. Upload and error responses
are `no-store`.

## 10. Dashboard experience

### 10.1 Homepage

The homepage leads with the latest publication timestamp, run mode, coverage,
validity rate, and a “Runner Verified” explanation. Its main matrix has models
as rows and reasoning efforts as columns. Visitors select one of:

- visible stream TPS (estimated);
- first visible text latency;
- total latency;
- visible end-to-end TPS.

Every measured cell displays median, sample count, and state. Color encodes the
selected metric within that run; text and icons carry the status so meaning
does not depend on color. Unsupported, excluded, unmeasured, invalid-only, and
measured states are distinct.

A compact compare drawer lets a visitor select two cells and see their medians,
ranges, sample counts, and relative difference. The comparison never declares
an absolute winner across different dates or suite versions.

### 10.2 Run detail

The run page shows the matrix, every sample, invalid/error/reroute reasons,
catalog snapshot, prompt and protocol identifiers, environment, versions,
calculation definitions, and a link to the exact runner source revision.

### 10.3 History and methodology

History lists immutable runs with mode, suite version, coverage, validity, and
publication time. Methodology contains the full fixed prompt, formulas, validity
rules, measurement limitations, source links, and the reason Ultra and optional
Fast service tiers are excluded from the default comparison.

### 10.4 Visual direction and accessibility

The interface uses a precise editorial/data-instrument aesthetic: warm neutral
canvas, near-black typography, electric lime/amber data accents, tabular
numerals, crisp rules, and restrained motion. It avoids generic AI gradients,
glass cards, OpenAI brand marks, and unsupported “official” language.

The UI is keyboard navigable, honors reduced motion, meets WCAG AA contrast,
uses semantic tables at desktop widths, and provides a readable stacked form on
small screens. Every interactive control has an accessible name and visible
focus state.

## 11. Security and privacy

- The website never stores Codex or ChatGPT credentials.
- Only a Worker Secret can authenticate upload requests.
- CORS is disabled for write routes; the publisher is a non-browser CLI.
- All request sizes and collection lengths are bounded before expensive work.
- HMAC verification precedes JSON parsing and D1 writes.
- Schema validation rejects unknown and non-finite values.
- Published fields are allow-listed and recursively checked for secret-shaped
  keys and values.
- Security headers include a strict CSP, HSTS, nosniff, referrer policy, and a
  restrictive permissions policy.
- Logs contain request IDs and stable error codes, never bodies or signatures.
- Rate limiting can be enabled at the Cloudflare perimeter; application-level
  rejection protects the low-volume write endpoint as a fallback.

## 12. Cost envelope

The intended production footprint is one Worker, one small D1 database, and
static assets. Normal static page views do not consume Worker invocations.
Public API traffic and rare uploads are far below the Workers Free allowance;
D1 reads/writes and storage are far below its Free allowances. On the Free plan,
exhausted D1 limits fail rather than automatically producing usage overages.

Running the benchmark itself consumes the publisher's Codex/ChatGPT allowance.
The CLI therefore previews the turn count, requires `--max-turns`, supports a
minimal smoke suite, and never enables paid top-ups. CodexSpeed cannot determine
or change the publisher's account billing settings.

## 13. Verification strategy

### 13.1 Unit and property tests

- Schema accepts a canonical valid payload and rejects unknown fields,
  non-finite numbers, invalid timestamps, impossible timing order, bad token
  invariants, oversized collections, and sensitive-field patterns.
- Metrics cover normal cases, unavailable stream rate, invalid samples,
  p50/min/max, rounding, and deterministic summaries.
- HMAC vectors cover canonicalization, constant-time validation behavior,
  stale/future timestamps, wrong body hash, and idempotency mismatch.
- Scheduling covers discovery filters, Ultra exclusion, seeded interleaving,
  warm-ups, selection filters, and max-turn refusal.
- Event reduction covers visible deltas, usage updates, reroutes, failures,
  tool-event invalidation, and out-of-order protocol errors.

### 13.2 Worker integration tests

Tests run the Worker with a temporary D1 database and verify upload success,
invalid authentication, validation failures, duplicate idempotency, conflict,
atomic latest updates, list pagination, immutable lookup, empty state, ETags,
content types, cache headers, and security headers.

### 13.3 Runner integration tests

A deterministic fake App Server exercises the JSON-RPC lifecycle and streaming
reducer. A publisher test sends the exact serialized bytes to a local Worker,
then verifies the stored payload and server-recomputed summary. A live doctor
test checks the installed Codex version, login status, App Server handshake, and
catalog without starting a paid benchmark turn.

### 13.4 Browser end-to-end tests

Playwright seeds a representative run through the signed upload API and checks:

1. empty-state rendering;
2. latest matrix and metric switching;
3. two-cell comparison;
4. invalid sample visibility;
5. history and run-detail navigation;
6. methodology content;
7. keyboard interaction and mobile layout;
8. direct deep-link reload and accessible landmark/table semantics.

### 13.5 Production end-to-end test

After deployment and DNS/TLS activation, the final verification:

1. runs service health and security-header checks;
2. runs a bounded real Codex smoke benchmark locally;
3. publishes the signed run to the production endpoint;
4. repeats publication to prove idempotency;
5. attempts a tampered upload and proves rejection;
6. fetches the run and latest endpoints and compares raw fields and recomputed
   metrics with the local artifact;
7. opens the production site in a browser and verifies that the new run, matrix,
   sample details, and methodology are visible;
8. runs desktop/mobile screenshots and accessibility smoke checks;
9. records exact test commands and deployed revision for handoff.

## 14. Release boundary

The MVP is complete only when the repository is pushed, CI-equivalent local
gates pass, the Worker/D1/static site is deployed, the custom hostname serves a
valid certificate, and a genuine locally generated smoke run has traveled
through the signed upload endpoint into the public dashboard with its stored and
displayed values verified end to end.
