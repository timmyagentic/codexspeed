# CodexSpeed

CodexSpeed is an independent benchmark and public dashboard for comparing the
visible output speed of Codex models at different reasoning efforts.

The benchmark runs locally through the installed Codex App Server. A signed
publisher uploads sanitized benchmark results to a display-only Cloudflare
site. The public website never runs Codex and never receives Codex credentials.

The project is independent and is not affiliated with, sponsored by, or
endorsed by OpenAI. “Codex” is used only to identify the product being measured.

## Status

The reproducible local runner, signed publication API, display dashboard, and
genuine production smoke publication are live. Read the public
[`methodology`](docs/methodology/README.md) and the approved
[`design`](docs/superpowers/specs/2026-07-16-codexspeed-design.md).

## Local runner

CodexSpeed requires Node.js 22, pnpm 10 through Corepack, the installed Codex
CLI, and an existing ChatGPT login. Install and build the workspace first:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @codexspeed/runner build
```

`doctor` checks the CLI, login, App Server protocol, model catalog, and isolated
instruction state without starting a model turn. `plan` also starts no model
turn and prints the exact bounded schedule:

```sh
corepack pnpm --filter @codexspeed/runner codexspeed -- doctor
corepack pnpm --filter @codexspeed/runner codexspeed -- plan --seed 7 --max-turns 200
```

Every real run requires `--max-turns` and an output file. A one-cell smoke run
looks like this (replace the model and effort with a pair printed by `plan`):

```sh
corepack pnpm --filter @codexspeed/runner codexspeed -- run \
  --model MODEL_ID \
  --effort medium \
  --rounds 1 \
  --no-warmup \
  --seed 7 \
  --max-turns 1 \
  --out /tmp/codexspeed-run.json
```

A series run measures every visible comparable effort in one bounded model
family. It always uses one warm-up per selected model and three measured rounds;
it cannot be combined with model/effort filters, `--no-warmup`, or a different
round count. Plan first, then run with the same arguments:

```sh
corepack pnpm --filter @codexspeed/runner codexspeed -- plan \
  --series gpt-5.6 \
  --seed 13 \
  --max-turns 48

corepack pnpm --filter @codexspeed/runner codexspeed -- run \
  --series gpt-5.6 \
  --seed 13 \
  --max-turns 48 \
  --out /tmp/codexspeed-gpt-5.6.json
```

The exact-or-hyphen-prefix boundary selects `gpt-5.6` and `gpt-5.6-*`, but not
`gpt-5.60-*`. Hidden models and Ultra are excluded. If the live catalog changes,
the no-turn plan shows the new exact cell and turn count before execution.

The artifact is compact schema-validated JSON with owner-only permissions. It
contains benchmark evidence, not prompt/response text, credentials, local
paths, App Server transcripts, or arbitrary environment data.

## Signed publication

The publisher key ID and unpadded base64url 32-byte HMAC secret are accepted
only through environment variables. The secret must match the Cloudflare
Worker secret; do not put it in command arguments or commit it to the repo.

```sh
export CODEXSPEED_KEY_ID=publisher-v1
read -r -s CODEXSPEED_HMAC_SECRET
export CODEXSPEED_HMAC_SECRET

corepack pnpm --filter @codexspeed/runner codexspeed -- publish \
  /tmp/codexspeed-run.json
```

Publication defaults to
`https://codexspeed.timmyagentic.com/api/v1/runs`. The runner validates the
artifact, signs the SHA-256 of its exact existing bytes, sends those same bytes,
and verifies the returned run ID and payload hash. Repeating a byte-identical
artifact is safe and reports `already published`; reusing a run ID with different
bytes returns a conflict.

Production artifacts must come from a verified immutable GitHub release tag
`v<runnerVersion>`. The run detail page links that exact tag and never treats a
mutable branch as reproducible source evidence. The methodology documents
scheduling, formulas, validity, limitations, cost safeguards, and reference
project licenses.

For local integration tests only, plain HTTP must be both loopback-only and
explicitly enabled. Query strings, fragments, user info, and any path other than
`/api/v1/runs` are rejected:

```sh
corepack pnpm --filter @codexspeed/runner codexspeed -- publish \
  /tmp/codexspeed-run.json \
  --endpoint http://127.0.0.1:8787/api/v1/runs \
  --allow-http-localhost
```

## License

Apache-2.0. See [`LICENSE`](LICENSE). Bundled web dependencies and their MIT
license notices are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
