import type { RunUpload } from "@codexspeed/contracts";
import { summarizeRun, type RunSummary } from "@codexspeed/metrics";
import { useState } from "react";

import { type MetricKey } from "../app/format.js";
import {
  LocalArtifactError,
  parseLocalArtifact,
} from "../app/local-artifact.js";
import { MetricMatrix } from "./MetricMatrix.js";
import { MetricSelector } from "./MetricSelector.js";
import { ReliabilityBand } from "./ReliabilityBand.js";

type LocalResultState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; run: RunUpload; summary: RunSummary };

export function LocalArtifactViewer() {
  const [state, setState] = useState<LocalResultState>({ status: "empty" });
  const [metric, setMetric] = useState<MetricKey>("visibleStreamTpsEstimate");

  async function open(file: File | undefined) {
    if (file === undefined) return;
    setState({ status: "loading" });
    try {
      const run = await parseLocalArtifact(file);
      setState({ status: "ready", run, summary: summarizeRun(run) });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof LocalArtifactError
            ? error.message
            : "Result file could not be opened.",
      });
    }
  }

  return (
    <section
      className="local-result-section"
      aria-labelledby="open-result-heading"
    >
      <div className="local-result-heading">
        <div>
          <p className="eyebrow">Browser-local viewer</p>
          <h2 id="open-result-heading">Open a local result</h2>
          <p>
            The browser reads the selected JSON on this device. It is never sent
            to the CodexSpeed API.
          </p>
        </div>
        <label className="file-button">
          Open result JSON
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Open a CodexSpeed result"
            onChange={(event) => void open(event.currentTarget.files?.[0])}
          />
        </label>
      </div>

      {state.status === "loading" ? (
        <p role="status">Opening the local result…</p>
      ) : null}
      {state.status === "error" ? <p role="alert">{state.message}</p> : null}
      {state.status === "ready" ? (
        <div className="local-result-viewer">
          <h2>Result on this device</h2>
          <p className="local-result-meta">
            Runner v{state.run.runnerVersion} · Codex CLI v
            {state.run.codexCliVersion} · {state.run.environment.osFamily} /{" "}
            {state.run.environment.architecture}
          </p>
          <MetricSelector value={metric} onChange={setMetric} />
          <section
            id="benchmark-matrix-panel"
            className="benchmark-section"
            role="tabpanel"
            aria-labelledby={`metric-tab-${metric}`}
          >
            <MetricMatrix
              run={state.run}
              summary={state.summary}
              metric={metric}
            />
          </section>
          <ReliabilityBand summary={state.summary} />
        </div>
      ) : null}
    </section>
  );
}
