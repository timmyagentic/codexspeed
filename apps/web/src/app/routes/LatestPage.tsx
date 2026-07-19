import type { LatestRunResponse } from "@codexspeed/contracts";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, fetchLatest } from "../api.js";
import { type MetricKey } from "../format.js";
import { MetricMatrix } from "../../components/MetricMatrix.js";
import { MetricSelector } from "../../components/MetricSelector.js";
import { PublicationFacts } from "../../components/PublicationFacts.js";
import { LocalRunnerCta } from "../../components/LocalRunnerCta.js";

type LatestState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; value: LatestRunResponse };

export function LatestPage() {
  const [state, setState] = useState<LatestState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<MetricKey>("visibleStreamTpsEstimate");

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchLatest(controller.signal).then(
      (value) => setState({ status: "ready", value }),
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: "empty" });
        } else if (!(
          error instanceof DOMException && error.name === "AbortError"
        )) {
          setState({ status: "error" });
        }
      },
    );
    return () => controller.abort();
  }, [attempt]);

  if (state.status === "error") {
    return (
      <>
        <LocalRunnerCta />
        <div className="route-state">
          <div role="alert">
            <h1>Latest benchmark is unavailable.</h1>
            <p>The published data could not be loaded.</p>
          </div>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            aria-label="Retry latest benchmark"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  if (state.status === "empty") {
    return (
      <>
        <LocalRunnerCta />
        <div className="route-state">
          <h1>No benchmark has been published yet.</h1>
          <p>
            The verified runner will publish the first immutable result here.
          </p>
        </div>
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        <LocalRunnerCta />
        <div className="route-state compact" role="status">
          Loading latest benchmark…
        </div>
      </>
    );
  }

  const value = state.value;
  return (
    <section
      className="evidence-ledger"
      aria-label="CodexSpeed evidence ledger"
    >
      <div className="latest-intro">
        <section className="opening" aria-labelledby="latest-ledger-title">
          <div className="opening-copy">
            <h1 id="latest-ledger-title">
              Codex model speed,
              <br />
              measured locally.
            </h1>
            <p>
              Independent, reproducible benchmark results uploaded by a verified
              local runner.
            </p>
          </div>
          <aside
            className="verified-copy"
            aria-labelledby="runner-verified-heading"
          >
            <div className="verified-heading">
              <ShieldCheck aria-hidden="true" size={34} strokeWidth={2.1} />
              <h2 id="runner-verified-heading">Runner Verified</h2>
            </div>
            <p>
              Signed by the configured local publisher key. The artifact schema
              and summary are checked on receipt.
            </p>
            <a href="/methodology">Learn more in Methodology →</a>
          </aside>
        </section>
        <PublicationFacts value={value} />
      </div>
      <LocalRunnerCta />
      <MetricSelector value={metric} onChange={setMetric} />
      <section
        id="benchmark-matrix-panel"
        className="benchmark-section"
        role="tabpanel"
        aria-labelledby={`metric-tab-${metric}`}
      >
        <h2 id="latest-benchmark-heading">Latest benchmark</h2>
        <MetricMatrix run={value.run} summary={value.summary} metric={metric} />
      </section>
    </section>
  );
}
