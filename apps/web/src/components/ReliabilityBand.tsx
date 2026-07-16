import type { PublicRunSummary } from "@codexspeed/contracts";

import { formatPercent } from "../app/format.js";

export function ReliabilityBand({ summary }: { summary: PublicRunSummary }) {
  const { coverage, reliability } = summary;
  const completeCells = summary.cells.filter(
    (cell) =>
      cell.reliability.validSamples >= cell.coverage.expectedMeasuredSamples,
  ).length;
  return (
    <section className="lower-band" aria-labelledby="reliability-heading">
      <div className="reliability-copy">
        <h2 id="reliability-heading">Reliability</h2>
        <dl className="reliability-stats">
          <div>
            <dt>
              {formatPercent(
                reliability.validSamples,
                reliability.measuredSamples,
              )}
            </dt>
            <dd>Measured samples valid</dd>
          </div>
          <div>
            <dt>
              {completeCells} / {coverage.selectedCells}
            </dt>
            <dd>Cells meet sample count</dd>
          </div>
          <div>
            <dt>{reliability.invalidSamples}</dt>
            <dd>Measured samples excluded from aggregates</dd>
          </div>
        </dl>
      </div>
      <div className="method-summary">
        <h2>Methodology</h2>
        <p>
          Test harness, prompts, environment capture, verification checks, and
          statistics.
        </p>
        <a href="/methodology">Read the methodology →</a>
      </div>
    </section>
  );
}
