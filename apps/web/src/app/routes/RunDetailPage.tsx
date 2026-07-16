import type { PublicRunResponse } from "@codexspeed/contracts";
import { useEffect, useState } from "react";

import { fetchRun } from "../api.js";
import { formatEffort, formatRunScope, formatUtc } from "../format.js";
import { METRIC_FORMULAS } from "../methodology.js";
import { describePublishedSample } from "../sample-result.js";
import { runnerSourceRevision } from "../source-revision.js";
import { MetricMatrix } from "../../components/MetricMatrix.js";
import { ReliabilityBand } from "../../components/ReliabilityBand.js";

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; value: PublicRunResponse };

export function RunDetailPage({ runId }: { runId: string }) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchRun(runId, controller.signal).then(
      (value) => setState({ status: "ready", value }),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      },
    );
    return () => controller.abort();
  }, [attempt, runId]);

  if (state.status === "loading") {
    return (
      <div className="route-state" role="status">
        Loading run…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="route-state">
        <p role="alert">This run is unavailable.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  }

  const { run, summary, publication } = state.value;
  const sourceRevision = runnerSourceRevision(run.runnerVersion);
  return (
    <article className="run-detail">
      <header className="detail-heading">
        <p>
          <a href="/runs">← All runs</a>
        </p>
        <h1>{formatRunScope(run.mode, run.selection.series)}</h1>
        <dl className="detail-identity">
          <div>
            <dt>Published</dt>
            <dd>{formatUtc(publication.publishedAt)}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd>{run.runId}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{run.status}</dd>
          </div>
          <div>
            <dt>Payload</dt>
            <dd>{publication.payloadSha256}</dd>
          </div>
        </dl>
      </header>

      <section className="detail-section" aria-labelledby="run-matrix-heading">
        <h2 id="run-matrix-heading">Benchmark matrix</h2>
        <MetricMatrix
          run={run}
          summary={summary}
          metric="visibleStreamTpsEstimate"
        />
      </section>

      <section className="detail-section" aria-labelledby="samples-heading">
        <h2 id="samples-heading">Samples</h2>
        {run.samples.length === 0 ? (
          <p>No samples recorded.</p>
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Benchmark samples"
            tabIndex={0}
          >
            <table className="sample-table">
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Model</th>
                  <th>Effort</th>
                  <th>Phase</th>
                  <th>Round</th>
                  <th>Attempt</th>
                  <th>First / last text</th>
                  <th>Total latency</th>
                  <th>Output / reasoning</th>
                  <th>Messages / tools</th>
                  <th>Validator</th>
                  <th>Error</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {run.samples.map((sample) => {
                  const result = describePublishedSample(
                    run.suiteVersion,
                    sample,
                  );
                  return (
                    <tr key={sample.sampleId}>
                      <td>{sample.sampleId}</td>
                      <td>{sample.model}</td>
                      <td>{formatEffort(sample.effort)}</td>
                      <td>{sample.phase}</td>
                      <td>{sample.round}</td>
                      <td>{sample.attempt}</td>
                      <td>
                        {sample.firstVisibleTextMs === null
                          ? "—"
                          : sample.firstVisibleTextMs.toFixed(0)}{" "}
                        /{" "}
                        {sample.lastVisibleTextMs === null
                          ? "—"
                          : sample.lastVisibleTextMs.toFixed(0)}{" "}
                        ms
                      </td>
                      <td>{sample.totalLatencyMs.toFixed(0)} ms</td>
                      <td>
                        {sample.outputTokens} / {sample.reasoningOutputTokens}
                      </td>
                      <td>
                        {sample.agentMessageCount} / {sample.toolEventCount}
                      </td>
                      <td>
                        {sample.validatorPassed
                          ? "Passed"
                          : sample.validatorReason}
                      </td>
                      <td>{sample.errorCode ?? "—"}</td>
                      <td
                        className={
                          result.valid === true
                            ? "result-valid"
                            : result.valid === false
                              ? "result-invalid"
                              : "result-unknown"
                        }
                      >
                        {result.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="detail-section" aria-labelledby="selection-heading">
        <h2 id="selection-heading">Selection evidence</h2>
        <dl className="selection-evidence">
          <div>
            <dt>Seed</dt>
            <dd>{run.seed}</dd>
          </div>
          <div>
            <dt>Warm-ups per model</dt>
            <dd>{run.selection.warmupPerModel}</dd>
          </div>
          <div>
            <dt>Measured rounds</dt>
            <dd>{run.selection.measuredRounds}</dd>
          </div>
          <div>
            <dt>Maximum turns</dt>
            <dd>{run.selection.maxTurns}</dd>
          </div>
        </dl>
        <ul className="selected-cells">
          {run.selection.cells.map((cell) => (
            <li key={`${cell.model}-${cell.effort}`}>
              <span>{cell.model}</span>
              <strong>{formatEffort(cell.effort)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-columns">
        <div className="detail-section">
          <h2>Catalog snapshot</h2>
          <ul className="catalog-list">
            {run.catalog.models.map((model) => (
              <li key={model.id}>
                <strong>{model.displayName}</strong>
                <span>{model.id}</span>
                <span>
                  {model.supportedEfforts.map(formatEffort).join(", ")}
                </span>
                <span>
                  {model.hidden
                    ? "Hidden"
                    : `Default: ${formatEffort(model.defaultEffort)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="detail-section">
          <h2>Run evidence</h2>
          <dl className="evidence-list">
            <div>
              <dt>Prompt</dt>
              <dd>
                {run.prompt.id}
                <br />
                <code>{run.prompt.sha256}</code>
              </dd>
            </div>
            <div>
              <dt>Protocol</dt>
              <dd>{run.protocolVersion}</dd>
            </div>
            <div>
              <dt>Suite</dt>
              <dd>{run.suiteVersion}</dd>
            </div>
            <div>
              <dt>Runner</dt>
              <dd>{run.runnerVersion}</dd>
            </div>
            <div>
              <dt>Codex CLI</dt>
              <dd>{run.codexCliVersion}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>
                {run.environment.osFamily} {run.environment.osVersion},{" "}
                {run.environment.architecture}, {run.environment.region}
              </dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>
                {run.environment.authChannel}, {run.environment.serviceTier}{" "}
                tier
              </dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {formatUtc(run.startedAt)} — {formatUtc(run.endedAt)}
              </dd>
            </div>
          </dl>
          {sourceRevision === null ? (
            <p className="source-unavailable">
              Exact runner source is unavailable for this legacy artifact.
            </p>
          ) : (
            <p className="source-unavailable">
              <a href={sourceRevision.url} rel="noreferrer" target="_blank">
                {sourceRevision.label} →
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="detail-section calculation-definitions">
        <h2>Calculation definitions</h2>
        <dl>
          {METRIC_FORMULAS.map((formula) => (
            <div key={formula.metric}>
              <dt>{formula.label}</dt>
              <dd>
                <code>{formula.equation}</code>
                <span>{formula.definition}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <ReliabilityBand summary={state.value.summary} />
    </article>
  );
}
