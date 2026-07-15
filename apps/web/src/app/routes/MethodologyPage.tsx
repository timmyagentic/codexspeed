import benchmarkPrompt from "../../../../../docs/methodology/prompt-v1.md?raw";

import { METRIC_FORMULAS } from "../methodology.js";

export function MethodologyPage() {
  return (
    <article className="methodology-page">
      <header className="page-heading">
        <h1>Methodology</h1>
        <p>How CodexSpeed measures locally, validates artifacts, and publishes reproducible results.</p>
      </header>
      <section><h2>What is measured</h2><p>Each selected model and supported reasoning effort receives the same versioned prompt through the locally installed Codex App Server. Warm-ups are excluded from published distributions. Measured turns are randomized by a recorded seed.</p></section>
      <section className="method-prompt"><h2>Fixed prompt</h2><div><p>The exact prompt is versioned and hashed before each run. Responses and reasoning text are never uploaded.</p><pre>{benchmarkPrompt.trimEnd()}</pre></div></section>
      <section><h2>Four public metrics</h2><dl className="method-definitions">{METRIC_FORMULAS.map((formula) => <div key={formula.metric}><dt>{formula.label}</dt><dd><code>{formula.equation}</code><span>{formula.definition} {formula.direction}.</span></dd></div>)}</dl></section>
      <section><h2>Validity rules</h2><p>A valid sample completes on the requested model, emits exactly one agent message and no tool events, includes matching token usage and visible timestamps, contains the minimum visible output, and passes the fixed structural validator. Invalid, failed, timed-out, or rerouted attempts remain visible on the run detail page but do not contribute to the p50.</p></section>
      <section><h2>Evidence and privacy</h2><p>Published artifacts include allow-listed catalog, selection, timing, token, environment, protocol, prompt-hash, and version fields. They exclude prompt text, responses, reasoning text, credentials, free-form errors, and local paths. Runner Verified means only that the payload signature matches the configured local publisher key. Schema validation and server-side summary calculation are separate receipt checks. It does not mean OpenAI verified or endorsed the runner, harness, or results.</p></section>
      <section><h2>Aggregation</h2><p>V is output tokens minus reasoning output tokens. Every displayed distribution uses valid measured samples only; warm-ups are excluded. p50 is the middle sorted value, or the mean of the two middle values for an even sample count. The range is the valid minimum through maximum.</p></section>
      <section><h2>Comparison boundaries</h2><p>Comparisons use the median within one immutable run. Ultra reasoning and optional fast service tiers are excluded from the default comparable matrix. Results are a measurement of one environment and time window, not a universal performance claim.</p></section>
      <p className="source-link"><a href="https://github.com/timmyagentic/codexspeed" rel="noreferrer" target="_blank">Read the source and reproduce the benchmark →</a></p>
    </article>
  );
}
