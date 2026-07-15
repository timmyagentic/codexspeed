import { createRunFixture, type LatestRunResponse, type PublicRunSummary } from "@codexspeed/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MetricMatrix } from "./MetricMatrix.js";

function distribution(p50: number) {
  return { p50, min: p50 - 2, max: p50 + 2, n: 3 };
}

function responseFixture(): LatestRunResponse {
  const run = createRunFixture();
  run.catalog.models = [
    {
      id: "model-a",
      displayName: "Model A",
      hidden: false,
      defaultEffort: "low",
      supportedEfforts: ["low", "medium", "high", "ultra"],
    },
    {
      id: "model-b",
      displayName: "Model B",
      hidden: false,
      defaultEffort: "low",
      supportedEfforts: ["low"],
    },
    {
      id: "model-c",
      displayName: "Model C",
      hidden: false,
      defaultEffort: "low",
      supportedEfforts: ["low"],
    },
    {
      id: "model-d",
      displayName: "Model D",
      hidden: false,
      defaultEffort: "low",
      supportedEfforts: ["low"],
    },
  ];
  run.selection.cells = [
    { model: "model-a", effort: "low" },
    { model: "model-a", effort: "medium" },
    { model: "model-b", effort: "low" },
    { model: "model-c", effort: "low" },
    { model: "model-d", effort: "low" },
  ];
  run.samples = [];

  const measuredMetrics = {
    firstVisibleTextMs: distribution(400),
    visibleStreamTpsEstimate: distribution(80),
    visibleE2eTps: distribution(60),
    generatedE2eTps: distribution(70),
    totalLatencyMs: distribution(5_000),
  };
  const emptyMetrics = {
    firstVisibleTextMs: null,
    visibleStreamTpsEstimate: null,
    visibleE2eTps: null,
    generatedE2eTps: null,
    totalLatencyMs: null,
  };
  const cells: PublicRunSummary["cells"] = [
    {
      model: "model-a",
      effort: "low",
      coverage: { expectedMeasuredSamples: 3, recordedMeasuredSamples: 3 },
      reliability: { measuredSamples: 3, validSamples: 3, invalidSamples: 0 },
      metrics: measuredMetrics,
    },
    {
      model: "model-a",
      effort: "medium",
      coverage: { expectedMeasuredSamples: 3, recordedMeasuredSamples: 2 },
      reliability: { measuredSamples: 2, validSamples: 0, invalidSamples: 2 },
      metrics: emptyMetrics,
    },
    {
      model: "model-b",
      effort: "low",
      coverage: { expectedMeasuredSamples: 3, recordedMeasuredSamples: 3 },
      reliability: { measuredSamples: 3, validSamples: 3, invalidSamples: 0 },
      metrics: {
        ...measuredMetrics,
        visibleStreamTpsEstimate: distribution(40),
      },
    },
    {
      model: "model-c",
      effort: "low",
      coverage: { expectedMeasuredSamples: 3, recordedMeasuredSamples: 3 },
      reliability: { measuredSamples: 3, validSamples: 3, invalidSamples: 0 },
      metrics: {
        ...measuredMetrics,
        visibleStreamTpsEstimate: distribution(60),
      },
    },
    {
      model: "model-d",
      effort: "low",
      coverage: { expectedMeasuredSamples: 3, recordedMeasuredSamples: 3 },
      reliability: { measuredSamples: 3, validSamples: 3, invalidSamples: 0 },
      metrics: {
        ...measuredMetrics,
        visibleStreamTpsEstimate: null,
      },
    },
  ];

  return {
    run,
    summary: {
      runId: run.runId,
      coverage: {
        selectedCells: 5,
        measuredCells: 5,
        unmeasuredCells: 0,
        expectedMeasuredSamples: 15,
        recordedMeasuredSamples: 14,
      },
      reliability: { measuredSamples: 14, validSamples: 12, invalidSamples: 2 },
      cells,
    },
    publication: {
      payloadSha256: "b".repeat(64),
      publishedAt: "2026-07-16T08:02:00.000Z",
    },
    generation: 1,
  };
}

describe("MetricMatrix", () => {
  it("renders measured, invalid-only, metric-unavailable, unmeasured, unsupported, and excluded states", () => {
    render(
      <MetricMatrix
        metric="visibleStreamTpsEstimate"
        run={responseFixture().run}
        summary={responseFixture().summary}
      />,
    );

    const row = screen.getByRole("row", { name: /Model A/i });
    expect(within(row).getByText("80.0 tok/s")).toBeInTheDocument();
    expect(within(row).getByText("Invalid only")).toBeInTheDocument();
    expect(within(row).getByText("Unmeasured")).toBeInTheDocument();
    expect(within(row).getByText("Excluded")).toBeInTheDocument();

    const modelB = screen.getByRole("row", { name: /Model B/i });
    expect(within(modelB).getAllByText("Unsupported")).toHaveLength(3);
    const modelD = screen.getByRole("row", { name: /Model D/i });
    expect(within(modelD).getByText("Unavailable")).toBeInTheDocument();
  });

  it("selects two measured cells from the keyboard and replaces the oldest selection", async () => {
    const user = userEvent.setup();
    render(
      <MetricMatrix
        metric="visibleStreamTpsEstimate"
        run={responseFixture().run}
        summary={responseFixture().summary}
      />,
    );

    const first = screen.getByRole("button", { name: /Model A.*Low.*80\.0 tok\/s/i });
    const second = screen.getByRole("button", { name: /Model B.*Low.*40\.0 tok\/s/i });
    const third = screen.getByRole("button", { name: /Model C.*Low.*60\.0 tok\/s/i });
    first.focus();
    await user.keyboard("{Enter}");
    second.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Compare" })).toBeInTheDocument();
    expect(screen.getByText("A", { selector: ".selection-mark" })).toBeInTheDocument();
    expect(screen.getByText("B", { selector: ".selection-mark" })).toBeInTheDocument();

    await user.click(third);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(third).toHaveAttribute("aria-pressed", "true");
  });

  it("removes a selection when the next metric is unavailable for that cell", async () => {
    const user = userEvent.setup();
    const fixture = responseFixture();
    const view = render(
      <MetricMatrix metric="firstVisibleTextMs" run={fixture.run} summary={fixture.summary} />,
    );

    await user.click(screen.getByRole("button", { name: /Model D.*Low.*400 ms/i }));
    expect(screen.getByText("1 cell selected")).toBeInTheDocument();

    view.rerender(
      <MetricMatrix metric="visibleStreamTpsEstimate" run={fixture.run} summary={fixture.summary} />,
    );

    await waitFor(() => expect(screen.getByText("Select up to two measured cells")).toBeInTheDocument());
  });

  it("shows a factual empty state when no visible catalog models remain", () => {
    const fixture = responseFixture();
    fixture.run.catalog.models.forEach((model) => {
      model.hidden = true;
    });

    render(
      <MetricMatrix
        metric="visibleStreamTpsEstimate"
        run={fixture.run}
        summary={fixture.summary}
      />,
    );

    expect(screen.getByText("No comparable cells in this run.")).toBeInTheDocument();
  });
});
