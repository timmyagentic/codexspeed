import type { LatestRunResponse } from "@codexspeed/contracts";

import { formatPercent, formatRunScope, formatUtc } from "../app/format.js";

export function PublicationFacts({ value }: { value: LatestRunResponse }) {
  const { run, summary } = value;
  const completeCells = summary.cells.filter(
    (cell) =>
      cell.reliability.validSamples >= cell.coverage.expectedMeasuredSamples,
  ).length;
  const excludedSamples = summary.reliability.invalidSamples;
  return (
    <dl className="publication-facts" aria-label="Latest publication evidence">
      <div>
        <dt>Latest run</dt>
        <dd>{formatUtc(value.publication.publishedAt)}</dd>
      </div>
      <div>
        <dt>Mode</dt>
        <dd>{formatRunScope(run.mode, run.selection.series)}</dd>
      </div>
      <div className="fact-signal fact-coverage">
        <dt>Coverage</dt>
        <dd>
          <strong>
            {summary.coverage.measuredCells} / {summary.coverage.selectedCells}
            {" cells measured"}
          </strong>
          <small>
            {completeCells} / {summary.coverage.selectedCells} cells meet sample
            count
          </small>
        </dd>
      </div>
      <div className="fact-signal fact-validity">
        <dt>Validity</dt>
        <dd>
          <strong>
            {formatPercent(
              summary.reliability.validSamples,
              summary.reliability.measuredSamples,
            )}{" "}
            valid
          </strong>
          <small>
            {excludedSamples} measured sample
            {excludedSamples === 1 ? "" : "s"} excluded
          </small>
        </dd>
      </div>
    </dl>
  );
}
