# CodexSpeed methodology

CodexSpeed measures response timing and visible-output throughput for locally
installed Codex models under one controlled, versioned prompt. The public site
is display-only: all model turns happen on the publisher's Mac, and only a
strictly allow-listed artifact is signed and uploaded.

## Controlled run

- Every trial starts a new Codex App Server thread in a dedicated empty,
  read-only workspace and isolated temporary `CODEX_HOME`.
- The run uses ChatGPT authentication and the default service tier. It disables
  project instructions, MCP, plugins, skills, hooks, web lookup, shell commands,
  file mutation, and interactive approval.
- The exact public prompt is [`prompt-v1.md`](prompt-v1.md). The artifact records
  its identifier and SHA-256, never the response or reasoning text.
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

Every invocation requires `--max-turns`. The runner prints and validates the
complete plan before it can start a turn. The MVP does not retry automatically.
A failed turn remains visible in its immutable run; another attempt requires a
new explicit invocation and artifact.

## Publication and source identity

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

## Cost safety

The production footprint is static assets, one Cloudflare Worker, and D1. It is
designed for Cloudflare Free allowances: static asset requests bypass Worker
execution, API traffic is small, and platform limits fail closed. CodexSpeed
does not upgrade plans or enable paid overages.

Benchmark turns use the publisher's existing Codex/ChatGPT allowance. The
runner's plan preview, explicit maximum-turn guard, subset and series filters,
and smoke mode bound that local consumption. CodexSpeed cannot inspect or
change billing settings or enable paid top-ups.

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
