import type { RunListMetadata } from "@codexspeed/contracts";
import { useEffect, useState } from "react";

import { fetchRuns } from "../api.js";
import { formatPercent, formatUtc } from "../format.js";

type RunListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: RunListMetadata[]; nextCursor: string | null };

export function RunsPage() {
  const [state, setState] = useState<RunListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchRuns(undefined, controller.signal).then(
      (response) => setState({ status: "ready", data: response.data, nextCursor: response.nextCursor }),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      },
    );
    return () => controller.abort();
  }, [attempt]);

  async function loadMore() {
    if (state.status !== "ready" || state.nextCursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const response = await fetchRuns(state.nextCursor);
      setState({
        status: "ready",
        data: [...state.data, ...response.data],
        nextCursor: response.nextCursor,
      });
    } catch {
      setState({ status: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="page-section" aria-labelledby="runs-heading">
      <div className="page-heading">
        <h1 id="runs-heading">Published runs</h1>
        <p>Immutable benchmark artifacts, newest first.</p>
      </div>
      {state.status === "loading" ? <p role="status">Loading published runs…</p> : null}
      {state.status === "error" ? (
        <div className="route-state compact">
          <p role="alert">Published runs are unavailable.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" && state.data.length === 0 ? <p className="empty-list">No runs have been published yet.</p> : null}
      {state.status === "ready" && state.data.length > 0 ? (
        <>
          <ol className="run-list">
            {state.data.map((run) => (
              <li key={run.runId}>
                <a href={`/runs/${run.runId}`}>
                  <span className="run-date">{formatUtc(run.publication.publishedAt)}</span>
                  <strong>{run.mode === "smoke" ? "Smoke run" : "Full run"}</strong>
                  <span>{run.summary.coverage.measuredCells} / {run.summary.coverage.selectedCells} cells</span>
                  <span>{formatPercent(run.summary.reliability.validSamples, run.summary.reliability.measuredSamples)} valid</span>
                  <span>Suite {run.suiteVersion}</span>
                </a>
              </li>
            ))}
          </ol>
          {state.nextCursor === null ? null : (
            <button className="load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : "Load older runs"}
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
