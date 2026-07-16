import {
  createRunFixture,
  type LatestRunResponse,
} from "@codexspeed/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LatestPage } from "./LatestPage.js";

function latestFixture(): LatestRunResponse {
  const run = createRunFixture();
  return {
    run,
    summary: {
      runId: run.runId,
      coverage: {
        selectedCells: 1,
        measuredCells: 1,
        unmeasuredCells: 0,
        expectedMeasuredSamples: 1,
        recordedMeasuredSamples: 2,
      },
      reliability: { measuredSamples: 2, validSamples: 1, invalidSamples: 1 },
      cells: [
        {
          model: "gpt-5.3-codex",
          effort: "medium",
          coverage: { expectedMeasuredSamples: 1, recordedMeasuredSamples: 2 },
          reliability: {
            measuredSamples: 2,
            validSamples: 1,
            invalidSamples: 1,
          },
          metrics: {
            firstVisibleTextMs: { p50: 1_000, min: 1_000, max: 1_000, n: 1 },
            visibleStreamTpsEstimate: { p50: 49.9, min: 49.9, max: 49.9, n: 1 },
            visibleE2eTps: { p50: 40, min: 40, max: 40, n: 1 },
            generatedE2eTps: { p50: 48, min: 48, max: 48, n: 1 },
            totalLatencyMs: { p50: 12_500, min: 12_500, max: 12_500, n: 1 },
          },
        },
      ],
    },
    publication: {
      payloadSha256: "b".repeat(64),
      publishedAt: "2026-07-16T08:02:00.000Z",
    },
    generation: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LatestPage", () => {
  it("shows an empty publication state without presenting a retry for 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("missing", { status: 404 })),
    );

    render(<LatestPage />);

    expect(
      screen.getByRole("link", { name: "Test on this device" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No benchmark has been published yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry latest benchmark" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry after a latest API error and renders the validated response", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json(latestFixture()));
    vi.stubGlobal("fetch", fetchMock);

    render(<LatestPage />);
    expect(
      screen.getByRole("link", { name: "Test on this device" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Latest benchmark is unavailable.",
    );

    await user.click(
      screen.getByRole("button", { name: "Retry latest benchmark" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Latest benchmark" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const streamTab = screen.getByRole("tab", { name: "Visible stream TPS" });
    streamTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("tab", { name: "First visible text" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "First visible text" }),
    ).toHaveFocus();
  });
});
