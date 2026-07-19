import type { PublicRun, PublicRunSummary } from "@codexspeed/contracts";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  METRICS,
  formatEffort,
  formatMetric,
  formatMetricNumber,
  metricHeat,
  relativeDifference,
  type MetricKey,
} from "../app/format.js";

type CatalogEffort =
  PublicRun["catalog"]["models"][number]["supportedEfforts"][number];
type SummaryCell = PublicRunSummary["cells"][number];
type CellState =
  | "measured"
  | "unavailable"
  | "unmeasured"
  | "unsupported"
  | "excluded"
  | "invalid-only";

type MatrixCell = {
  key: string;
  modelId: string;
  modelName: string;
  effort: CatalogEffort;
  state: CellState;
  summary: SummaryCell | null;
  value: number | null;
};

type MetricMatrixProps = {
  run: PublicRun;
  summary: PublicRunSummary;
  metric: MetricKey;
};

const EFFORT_ORDER: CatalogEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const STATE_LABELS: Record<CellState, string> = {
  measured: "Measured",
  unavailable: "Unavailable",
  unmeasured: "Unmeasured",
  unsupported: "Unsupported",
  excluded: "Excluded",
  "invalid-only": "Invalid only",
};

function keyFor(model: string, effort: string): string {
  return `${model}\u0000${effort}`;
}

function useMobileMatrix(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

function buildCells(
  run: PublicRun,
  summary: PublicRunSummary,
  metric: MetricKey,
) {
  const models = run.catalog.models.filter((model) => !model.hidden);
  const effortsInRun = new Set<CatalogEffort>();
  for (const model of models) {
    for (const effort of model.supportedEfforts) {
      effortsInRun.add(effort);
    }
  }
  const efforts = EFFORT_ORDER.filter((effort) => effortsInRun.has(effort));
  const summaryByCell = new Map(
    summary.cells.map(
      (cell) => [keyFor(cell.model, cell.effort), cell] as const,
    ),
  );
  const rows = models.map((model) => {
    const supported = new Set(model.supportedEfforts);
    return {
      modelId: model.id,
      modelName: model.displayName,
      cells: efforts.map((effort): MatrixCell => {
        const summaryCell = summaryByCell.get(keyFor(model.id, effort)) ?? null;
        const distribution = summaryCell?.metrics[metric] ?? null;
        let state: CellState;
        if (!supported.has(effort)) {
          state = "unsupported";
        } else if (effort === "ultra") {
          state = "excluded";
        } else if (
          summaryCell === null ||
          summaryCell.reliability.measuredSamples === 0
        ) {
          state = "unmeasured";
        } else if (summaryCell.reliability.validSamples === 0) {
          state = "invalid-only";
        } else if (distribution === null) {
          state = "unavailable";
        } else {
          state = "measured";
        }
        return {
          key: keyFor(model.id, effort),
          modelId: model.id,
          modelName: model.displayName,
          effort,
          state,
          summary: summaryCell,
          value: distribution?.p50 ?? null,
        };
      }),
    };
  });
  return { efforts, rows };
}

function MatrixCellButton({
  cell,
  heat,
  mark,
  metric,
  onToggle,
  stateOnly,
}: {
  cell: MatrixCell;
  heat: number;
  mark: "A" | "B" | null;
  metric: MetricKey;
  onToggle: (cell: MatrixCell) => void;
  stateOnly?: boolean;
}) {
  const label = cell.value === null ? null : formatMetric(metric, cell.value);
  if (cell.state !== "measured" || label === null) {
    return (
      <div
        className={`matrix-cell state-${cell.state}`}
        data-state={cell.state}
      >
        {stateOnly === true ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="visually-hidden">{STATE_LABELS[cell.state]}</span>
          </>
        ) : (
          <span className="state-label">{STATE_LABELS[cell.state]}</span>
        )}
        {cell.summary !== null &&
        cell.summary.reliability.measuredSamples > 0 ? (
          <small>n={cell.summary.reliability.measuredSamples}</small>
        ) : null}
      </div>
    );
  }

  const style = {
    backgroundColor:
      mark === "B"
        ? "rgba(255, 195, 66, 0.68)"
        : `rgba(199, 243, 63, ${0.2 + heat * 0.55})`,
  } satisfies CSSProperties;
  return (
    <button
      className="matrix-cell measured-cell"
      type="button"
      aria-label={`${cell.modelName}, ${formatEffort(cell.effort)}, ${METRICS[metric].label}: ${label}, Measured`}
      aria-pressed={mark !== null}
      data-state="measured"
      style={style}
      onClick={() => onToggle(cell)}
    >
      {mark === null ? null : (
        <span
          className={`selection-mark mark-${mark.toLowerCase()}`}
          aria-hidden="true"
        >
          {mark}
        </span>
      )}
      <strong>{label}</strong>
      <small>n={cell.summary?.metrics[metric]?.n ?? 0}</small>
      <span className="visually-hidden">Measured</span>
    </button>
  );
}

function CompareRail({
  selected,
  metric,
  onClear,
}: {
  selected: MatrixCell[];
  metric: MetricKey;
  onClear: () => void;
}) {
  const first = selected[0];
  const second = selected[1];
  let difference: number | null = null;
  if (
    first?.value !== null &&
    first?.value !== undefined &&
    second?.value !== null &&
    second?.value !== undefined
  ) {
    difference = relativeDifference(metric, first.value, second.value);
  }

  return (
    <aside className="compare-rail" aria-labelledby="compare-heading">
      <div className="compare-heading-row">
        <div>
          <h3 id="compare-heading">Compare</h3>
          <p>
            {selected.length === 0
              ? "Select up to two measured cells"
              : `${selected.length} cell${selected.length === 1 ? "" : "s"} selected`}
          </p>
        </div>
        {selected.length > 0 ? (
          <button type="button" className="text-button" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      {selected.map((cell, index) => {
        const distribution = cell.summary?.metrics[metric] ?? null;
        return (
          <section className="comparison" key={cell.key}>
            <h4>
              <span className={`comparison-letter letter-${index}`}>
                {index === 0 ? "A" : "B"}
              </span>
              {cell.modelName} · {formatEffort(cell.effort)}
            </h4>
            <dl>
              <div>
                <dt>{METRICS[metric].label}</dt>
                <dd>
                  {cell.value === null ? "—" : formatMetric(metric, cell.value)}
                </dd>
              </div>
              <div>
                <dt>Range</dt>
                <dd>
                  {distribution === null
                    ? "—"
                    : `${formatMetricNumber(metric, distribution.min)}–${formatMetricNumber(metric, distribution.max)} ${METRICS[metric].unit}`}
                </dd>
              </div>
              <div>
                <dt>Samples</dt>
                <dd>{distribution?.n ?? 0}</dd>
              </div>
            </dl>
          </section>
        );
      })}
      {selected.length === 0 ? (
        <div className="compare-empty">Choose a measured cell to begin.</div>
      ) : null}
      {difference === null ? null : (
        <div className="relative-difference">
          <span>Relative difference (A vs B)</span>
          <strong>
            {difference >= 0 ? "+" : ""}
            {difference.toFixed(1)}%
          </strong>
        </div>
      )}
      <p className="compare-note">
        Comparisons use p50.{" "}
        {METRICS[metric].higherIsBetter ? "Higher" : "Lower"} is better.
      </p>
    </aside>
  );
}

export function MetricMatrix({ run, summary, metric }: MetricMatrixProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const mobile = useMobileMatrix();
  const matrix = useMemo(
    () => buildCells(run, summary, metric),
    [metric, run, summary],
  );
  const measured = useMemo(
    () =>
      matrix.rows
        .flatMap((row) => row.cells)
        .filter((cell) => cell.state === "measured" && cell.value !== null),
    [matrix],
  );
  const selectableKeys = useMemo(
    () => new Set(measured.map((cell) => cell.key)),
    [measured],
  );
  const values = measured.flatMap((cell) =>
    cell.value === null ? [] : [cell.value],
  );
  const minimum = values.length === 0 ? 0 : Math.min(...values);
  const maximum = values.length === 0 ? 0 : Math.max(...values);
  const cellsByKey = new Map(
    matrix.rows.flatMap((row) => row.cells).map((cell) => [cell.key, cell]),
  );
  const selected = selectedKeys.flatMap((key) => {
    const cell = cellsByKey.get(key);
    return cell === undefined || !selectableKeys.has(key) ? [] : [cell];
  });

  useEffect(() => {
    setSelectedKeys((current) => {
      const next = current.filter((key) => selectableKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [selectableKeys]);

  function toggle(cell: MatrixCell) {
    setSelectedKeys((current) => {
      const active = current.filter((key) => selectableKeys.has(key));
      if (active.includes(cell.key)) {
        return active.filter((key) => key !== cell.key);
      }
      return active.length < 2 ? [...active, cell.key] : [active[1]!, cell.key];
    });
  }

  function markFor(cell: MatrixCell): "A" | "B" | null {
    const index = selected.findIndex(
      (selectedCell) => selectedCell.key === cell.key,
    );
    return index === 0 ? "A" : index === 1 ? "B" : null;
  }

  function cellElement(cell: MatrixCell, stateOnly = false) {
    return (
      <MatrixCellButton
        key={cell.key}
        cell={cell}
        heat={
          cell.value === null
            ? 0
            : metricHeat(metric, cell.value, minimum, maximum)
        }
        mark={markFor(cell)}
        metric={metric}
        onToggle={toggle}
        stateOnly={stateOnly}
      />
    );
  }

  if (matrix.rows.length === 0 || matrix.efforts.length === 0) {
    return <p className="matrix-empty">No comparable cells in this run.</p>;
  }

  return (
    <div className="benchmark-layout">
      <div className="matrix-region">
        {mobile ? (
          <div
            className="mobile-matrix"
            role="region"
            aria-label={`${METRICS[metric].label} benchmark matrix`}
          >
            {matrix.rows.map((row) => (
              <section className="mobile-model" key={row.modelId}>
                <h3>{row.modelName}</h3>
                <div
                  className="mobile-row mobile-row-header"
                  aria-hidden="true"
                >
                  <span>Effort</span>
                  <span>Metric</span>
                  <span>State</span>
                </div>
                {row.cells.map((cell) => (
                  <div className="mobile-row" key={cell.key}>
                    <strong>{formatEffort(cell.effort)}</strong>
                    {cellElement(cell, true)}
                    <span className={`mobile-state state-text-${cell.state}`}>
                      {STATE_LABELS[cell.state]}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <table className="metric-matrix">
            <caption className="visually-hidden">
              {METRICS[metric].label} by model and reasoning effort
            </caption>
            <thead>
              <tr>
                <th scope="col">Model \ Effort</th>
                {matrix.efforts.map((effort) => (
                  <th scope="col" key={effort}>
                    {formatEffort(effort)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.modelId}>
                  <th scope="row">{row.modelName}</th>
                  {row.cells.map((cell) => (
                    <td key={cell.key}>{cellElement(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <CompareRail
        selected={selected}
        metric={metric}
        onClear={() => setSelectedKeys([])}
      />
    </div>
  );
}
