import type { LatestRunResponse } from "@codexspeed/contracts";

import { formatPercent, formatRunScope, formatUtc } from "../app/format.js";

export function PublicationFacts({ value }: { value: LatestRunResponse }) {
  const { run, summary } = value;
  return (
    <dl className="publication-facts" aria-label="Latest run facts">
      <div><dt>Latest run</dt><dd>{formatUtc(value.publication.publishedAt)}</dd></div>
      <div><dt>Mode</dt><dd>{formatRunScope(run.mode, run.selection.series)}</dd></div>
      <div><dt>Coverage</dt><dd>{summary.coverage.measuredCells} / {summary.coverage.selectedCells} cells measured</dd></div>
      <div><dt>Validity</dt><dd>{formatPercent(summary.reliability.validSamples, summary.reliability.measuredSamples)} valid</dd></div>
    </dl>
  );
}
