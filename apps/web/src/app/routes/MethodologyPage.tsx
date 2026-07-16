import benchmarkPrompt from "../../../../../docs/methodology/prompt-v1.md?raw";

import { METRIC_FORMULAS } from "../methodology.js";

export function MethodologyPage() {
  return (
    <article className="methodology-page">
      <header className="page-heading">
        <h1>Methodology</h1>
        <p>
          How CodexSpeed measures locally, validates artifacts, and publishes
          reproducible results.
        </p>
      </header>
      <section>
        <h2>What is measured</h2>
        <p>
          Each selected model and supported reasoning effort receives the same
          versioned prompt through the locally installed Codex App Server. A
          standard series or full run performs one unmeasured warm-up per model
          at its catalog default effort; when that default is Ultra or otherwise
          non-comparable, it uses the first selected comparable effort. Three
          measured rounds follow. Every round uses a seeded Fisher–Yates shuffle
          and runs sequentially; the artifact records the seed and exact
          selection.
        </p>
      </section>
      <section className="method-prompt">
        <h2>Fixed prompt</h2>
        <div>
          <p>
            The exact prompt is versioned and hashed before each run. Responses
            and reasoning text are never uploaded.
          </p>
          <pre tabIndex={0}>{benchmarkPrompt.trimEnd()}</pre>
        </div>
      </section>
      <section>
        <h2>Four dashboard metrics</h2>
        <div>
          <dl className="method-definitions">
            {METRIC_FORMULAS.map((formula) => (
              <div key={formula.metric}>
                <dt>{formula.label}</dt>
                <dd>
                  <code>{formula.equation}</code>
                  <span>
                    {formula.definition} {formula.direction}.
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            The immutable API summary also retains auxiliary generated E2E API
            evidence, computed from all output tokens including reasoning. It is
            not a dashboard selector.
          </p>
        </div>
      </section>
      <section>
        <h2>Validity rules</h2>
        <p>
          A valid sample completes on the requested model, emits exactly one
          agent message and no tool events, includes matching token usage and
          ordered visible timestamps, contains at least 400 estimated visible
          tokens, and passes the fixed structural validator. Failed, timed-out,
          rerouted, missing-usage, malformed, tool-using, short, or structurally
          invalid attempts remain visible but do not contribute to aggregates.
          The MVP does not retry automatically. Another attempt requires a new
          explicit invocation and artifact.
        </p>
      </section>
      <section>
        <h2>Estimated stream rate</h2>
        <p>
          Visible stream TPS is estimated because App Server reports text chunks
          rather than one event per token. The formula uses reported output
          tokens minus reasoning-output tokens and the first-to-last visible
          chunk window. It is unavailable when fewer than two visible tokens
          exist or that window is zero.
        </p>
      </section>
      <section>
        <h2>Evidence and privacy</h2>
        <p>
          Published artifacts include allow-listed catalog, selection, timing,
          token, environment, protocol, prompt-hash, and version fields. They
          exclude prompt text, responses, reasoning text, credentials, free-form
          errors, and local paths. Runner Verified means publisher key signature
          only: it says who signed the immutable bytes, not that OpenAI verified
          or endorsed the runner, harness, or results. Schema validation and
          server-side summary calculation are separate receipt checks.
        </p>
      </section>
      <section>
        <h2>Aggregation</h2>
        <p>
          V is output tokens minus reasoning output tokens. Every displayed
          distribution uses valid measured samples only; warm-ups are excluded.
          p50 is the middle sorted value, or the mean of the two middle values
          for an even sample count. The range is the valid minimum through
          maximum.
        </p>
      </section>
      <section>
        <h2>Smoke, series, full, and exclusions</h2>
        <p>
          A smoke run measures an explicitly selected bounded subset and proves
          integration only. A series run covers every comparable cell for the
          exact requested model-family identifier, with one warm-up per model
          and three measured rounds. A full run covers every discovered
          comparable model/effort cell with the same standard schedule. Ultra is
          excluded because its subagent behavior is not a single-agent effort
          comparison. Optional fast service tiers are also outside the default
          matrix.
        </p>
      </section>
      <section>
        <h2>Interpretation and limitations</h2>
        <p>
          CodexSpeed measures one synthetic task, machine, network path, account
          channel, service tier, catalog snapshot, and time window. It does not
          measure answer quality and is not a universal model ranking. Remote
          load, routing, network conditions, thermals, and account state can
          still affect a sequential run.
        </p>
      </section>
      <section>
        <h2>Source provenance</h2>
        <p>
          Each production artifact uses a canonical runner version that maps to
          an immutable GitHub release tag. Publication is allowed only from a
          verified immutable release whose <code>v&lt;runnerVersion&gt;</code>{" "}
          tag resolves to the audited runner commit. Legacy or malformed
          versions do not receive an exact-source link.
        </p>
      </section>
      <section>
        <h2>Cost and limits</h2>
        <p>
          The display site is designed for Cloudflare Free: static assets do not
          invoke the Worker, API writes are rare, and D1/Worker limits fail
          closed instead of opting into paid usage. Local model turns consume
          the publisher’s Codex/ChatGPT allowance. Every plan requires an
          explicit maximum-turn guard; CodexSpeed cannot enable top-ups or
          change billing.
        </p>
      </section>
      <section>
        <h2>Open-source references</h2>
        <p>
          <a
            href="https://github.com/openai/codex"
            rel="noreferrer"
            target="_blank"
          >
            openai/codex
          </a>{" "}
          (Apache-2.0),{" "}
          <a
            href="https://github.com/minghinmatthewlam/openbench"
            rel="noreferrer"
            target="_blank"
          >
            openbench
          </a>{" "}
          (MIT),{" "}
          <a
            href="https://github.com/ai-dynamo/aiperf"
            rel="noreferrer"
            target="_blank"
          >
            AI Performance
          </a>{" "}
          (Apache-2.0),{" "}
          <a
            href="https://github.com/fahd09/watchtower"
            rel="noreferrer"
            target="_blank"
          >
            watchtower
          </a>{" "}
          (MIT), and{" "}
          <a
            href="https://github.com/cipher982/llm-benchmarks"
            rel="noreferrer"
            target="_blank"
          >
            llm-benchmarks
          </a>{" "}
          (MIT) informed the protocol. CodexSpeed is independently implemented
          under Apache-2.0. See{" "}
          <a href="/THIRD_PARTY_NOTICES.md">Third-party notices</a> for bundled
          runtime dependencies.
        </p>
      </section>
      <p className="source-link">
        <a
          href="https://github.com/timmyagentic/codexspeed"
          rel="noreferrer"
          target="_blank"
        >
          Read the source and reproduce the benchmark →
        </a>
      </p>
    </article>
  );
}
