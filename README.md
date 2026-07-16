# CodexSpeed

CodexSpeed is an independent local benchmark and public dashboard for comparing
the visible output speed of Codex models at different reasoning efforts. Anyone
can run the benchmark on their own computer and network; no API key is needed.

The benchmark runs locally through the installed Codex App Server. The public
website never runs Codex and never receives Codex credentials. It can open a
result JSON entirely in the browser for local viewing, while the maintainer can
separately publish selected sanitized results through a signed upload path.

The project is independent and is not affiliated with, sponsored by, or
endorsed by OpenAI. “Codex” is used only to identify the product being measured.

## Status

The reproducible v0.2.0 local runner, browser-local result viewer, signed
publication API, display dashboard, and genuine production benchmark are live.
Start at [`Test locally`](https://codexspeed.timmyagentic.com/local), or read the public
[`methodology`](docs/methodology/README.md) and the approved
[`design`](docs/superpowers/specs/2026-07-16-codexspeed-design.md).

## Test this device and network

Prerequisites are an installed Codex CLI and an existing ChatGPT login. The
portable download includes its own fixed Node.js runtime.

On macOS or Linux, run:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://codexspeed.timmyagentic.com/run.sh | sh
```

On Windows, run this in PowerShell:

```powershell
irm https://codexspeed.timmyagentic.com/run.ps1 | iex
```

If Node.js 22 is already installed, the exact v0.2.0 GitHub Release package can
instead be run with:

```sh
npx --yes https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-0.2.0.tgz
```

The guided runner checks Codex and the current model catalog without starting a
model turn, then asks for one model and one reasoning effort. Its default test is
one unmeasured warm-up plus three measured rounds: four real Codex turns. Before
anything is run, it prints that exact count, warns that the turns use the current
Codex/ChatGPT allowance and may have billing impact depending on the account,
and requires explicit confirmation.

After the run, the terminal shows the p50 estimated visible-stream speed, first
visible-text latency, visible end-to-end speed, total latency, and sample
reliability. It also saves a timestamped `codexspeed-result-*.json` in the current
directory. Nothing is uploaded automatically.

Open [`codexspeed.timmyagentic.com/local`](https://codexspeed.timmyagentic.com/local)
and choose that JSON file to see the same result as a matrix. The file is parsed,
validated, and summarized by the page in the browser; choosing it does not send
its contents to CodexSpeed.

### Direct portable downloads

Download the asset for the operating system and CPU, verify it against
[`SHA256SUMS`](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/SHA256SUMS),
then extract it. Run `codexspeed/bin/codexspeed` on macOS or Linux, or
`codexspeed\bin\codexspeed.cmd` on Windows.

- [macOS Apple Silicon](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-macos-arm64.tar.gz)
- [macOS Intel](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-macos-x64.tar.gz)
- [Linux x64](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-linux-x64.tar.gz)
- [Linux ARM64](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-linux-arm64.tar.gz)
- [Windows x64](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-windows-x64.zip)
- [Windows ARM64](https://github.com/timmyagentic/codexspeed/releases/download/v0.2.0/codexspeed-v0.2.0-windows-arm64.zip)

## Advanced workspace runner

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

## Maintainer-only signed publication

Ordinary local tests do not need a publisher key and cannot publish to the
public dashboard. Opening a JSON on the local-test page is not publication. The
following authenticated path is reserved for the site maintainer.

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
