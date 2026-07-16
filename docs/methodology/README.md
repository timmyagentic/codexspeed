# CodexSpeed methodology

CodexSpeed measures response timing and visible-output throughput for locally
installed Codex models under one controlled, versioned prompt. Every model turn
happens on the runner's own device and network. The public site does not start
Codex turns or receive credentials.

Runner v0.2.0 has two deliberately separate result paths:

- Any visitor can run a guided local test, keep its JSON on the device, and open
  that file in the site's browser-local viewer. The viewer validates and
  summarizes the chosen bytes in the browser; choosing a file does not upload
  it or make it a public run.
- The site maintainer can use an owner-only HMAC key to sign and upload a
  strictly allow-listed artifact for the public dashboard. This is an explicit
  additional command, never an automatic consequence of a local test.

## Controlled run

- Every trial starts a new Codex App Server thread in a dedicated empty,
  read-only workspace and isolated temporary `CODEX_HOME`.
- The run uses ChatGPT authentication and the default service tier. It disables
  project instructions, MCP, plugins, skills, hooks, web lookup, shell commands,
  file mutation, and interactive approval.
- The exact public prompt is [`prompt-v1.md`](prompt-v1.md). The artifact records
  its identifier and SHA-256, never the response or reasoning text.
- The guided `measure` command selects one visible model and one supported
  reasoning effort. By default it performs one unmeasured warm-up and three
  measured rounds, for exactly four sequential real Codex turns.
- A series or full run performs one unmeasured warm-up per selected model at its
  catalog default effort. If that default is Ultra or otherwise non-comparable,
  the warm-up uses the first selected comparable effort. Three measured rounds
  follow, each using a seeded Fisher–Yates shuffle; all turns execute
  sequentially.
- A smoke run covers an explicitly selected subset for integration verification.
  It must not be represented as full-matrix evidence.
- A series run covers every visible comparable cell whose model identifier is
  either the exact requested series or begins with that series followed by a
  hyphen. It must not be represented as evidence for models outside that family.
- A full run covers every visible comparable cell in the discovered catalog.

Before `measure` starts a turn, it prints the selected cell, the warm-up and
measured counts, the exact total number of real Codex turns, and an allowance and
possible-billing warning. It requires an interactive yes or an exact
`--accept-turns N` confirmation. Advanced `plan` and `run` invocations require
an explicit `--max-turns`; `plan` starts no model turn. The runner does not retry
automatically. A failed turn remains in its result; another attempt requires a
new explicit invocation and artifact.

## Publication and source identity

Publication is a maintainer-only operation and is not required to view a local
result. A locally opened artifact is not marked “Runner Verified.”

The runner signs the SHA-256 of the artifact's exact UTF-8 bytes using the
configured publisher HMAC key. “Runner Verified” means publisher key signature
only. It does not mean OpenAI verified, audited, or endorsed the harness or data.

`runnerVersion` is canonical SemVer. A production artifact must be generated
from a verified immutable GitHub release whose `v<runnerVersion>` tag resolves
to the audited runner commit. The detail page links exactly to
`/tree/v<runnerVersion>/packages/runner`; it never substitutes mutable `main`.
Before publishing, verify the immutable release and tag-to-commit mapping with
GitHub's release verification tooling.

## Metrics and validity

See [`formulas.md`](formulas.md) for equations and aggregation, and
[`limitations.md`](limitations.md) for interpretation boundaries. Invalid,
failed, timed-out, rerouted, tool-using, structurally invalid, short, or
missing-usage samples remain visible but are excluded from distributions.

The headline `visible_stream_tps_est` estimates output cadence only between the
first and last visible text chunks. `visible_e2e_tps` measures visible tokens
over the entire turn, including time before first visible text and completion
tail. Stream TPS is therefore usually higher; the two numbers answer different
questions and must not be compared as if they used the same time interval.

## Cost safety

The production footprint is static assets, one Cloudflare Worker, and D1. It is
designed for Cloudflare Free allowances: static asset requests bypass Worker
execution, API traffic is small, and platform limits fail closed. CodexSpeed
does not upgrade plans or enable paid overages.

Benchmark turns use the existing Codex/ChatGPT allowance of whoever runs them. The
guided runner's exact-turn confirmation, and the advanced runner's plan preview,
explicit maximum-turn guard, subset and series filters, and smoke mode bound
that local consumption. CodexSpeed cannot inspect or change billing settings or
enable paid top-ups.

## Reference implementations

- [openai/codex](https://github.com/openai/codex) — Apache-2.0; App Server
  protocol and event definitions.
- [minghinmatthewlam/openbench](https://github.com/minghinmatthewlam/openbench)
  — MIT; catalog matrix, doctor, and artifact ideas.
- [ai-dynamo/aiperf](https://github.com/ai-dynamo/aiperf) — Apache-2.0;
  monotonic timing, warm-up separation, failure accounting, and distributions.
- [fahd09/watchtower](https://github.com/fahd09/watchtower) — MIT; event-stream
  observation ideas. CodexSpeed neither proxies OAuth nor reuses its throughput
  formula.
- [cipher982/llm-benchmarks](https://github.com/cipher982/llm-benchmarks) — MIT;
  visible/reasoning token separation and failure taxonomy.

CodexSpeed is independently implemented under Apache-2.0. Bundled production
dependencies and their notices are listed in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
