import { createRunFixture } from "@codexspeed/contracts";
import { describe, expect, it } from "vitest";

import { formatTerminalResult } from "./terminal-result.js";

describe("formatTerminalResult", () => {
  it("prints canonical local metrics with reliability and privacy context", () => {
    const run = createRunFixture();

    const result = formatTerminalResult(run, "/tmp/codexspeed-result.json");

    expect(result.hasValidMeasurements).toBe(true);
    expect(result.lines).toContain(
      "Visible stream speed (estimated): 49.9 tok/s p50 (49.9-49.9, n=1)",
    );
    expect(result.lines).toContain(
      "First visible text: 1.00 s p50 (1.00-1.00, n=1)",
    );
    expect(result.lines).toContain(
      "Visible end-to-end: 40.0 tok/s p50 (40.0-40.0, n=1)",
    );
    expect(result.lines).toContain(
      "Total latency: 12.50 s p50 (12.50-12.50, n=1)",
    );
    expect(result.lines).toContain("Reliability: 1/2 measured samples valid");
    expect(result.lines).toContain(
      "Saved locally: /tmp/codexspeed-result.json",
    );
    expect(result.lines.at(-1)).toBe("Nothing was uploaded.");
  });

  it("does not invent speed when every measured sample is invalid", () => {
    const run = createRunFixture();
    for (const sample of run.samples) sample.toolEventCount = 1;

    const result = formatTerminalResult(run, "result.json");

    expect(result.hasValidMeasurements).toBe(false);
    expect(result.lines).toContain(
      "Visible stream speed (estimated): unavailable",
    );
    expect(result.lines).toContain("Reliability: 0/2 measured samples valid");
    expect(result.lines).toContain(
      "Warning: no valid measured samples were produced.",
    );
  });
});
