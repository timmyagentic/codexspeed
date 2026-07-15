import { describe, expect, it } from "vitest";

import { formatMetric, metricHeat, relativeDifference } from "./format.js";

describe("formatMetric", () => {
  it.each([
    ["visibleStreamTpsEstimate", 82.44, "82.4 tok/s"],
    ["visibleE2eTps", 40, "40.0 tok/s"],
    ["firstVisibleTextMs", 999.4, "999 ms"],
    ["totalLatencyMs", 12_540, "12.5 s"],
  ] as const)("formats %s with its display unit", (metric, value, expected) => {
    expect(formatMetric(metric, value)).toBe(expected);
  });
});

describe("metricHeat", () => {
  it("gives higher throughput values more heat", () => {
    expect(metricHeat("visibleStreamTpsEstimate", 80, 20, 80)).toBe(1);
    expect(metricHeat("visibleStreamTpsEstimate", 20, 20, 80)).toBe(0);
  });

  it("inverts lower-is-better latency values", () => {
    expect(metricHeat("firstVisibleTextMs", 200, 200, 800)).toBe(1);
    expect(metricHeat("firstVisibleTextMs", 800, 200, 800)).toBe(0);
  });

  it("uses a stable midpoint when every value is equal", () => {
    expect(metricHeat("totalLatencyMs", 500, 500, 500)).toBe(0.5);
  });
});

describe("relativeDifference", () => {
  it("uses the B value as the baseline for higher-is-better throughput", () => {
    expect(relativeDifference("visibleStreamTpsEstimate", 80, 40)).toBe(100);
  });

  it("uses the B value as the baseline while inverting lower-is-better latency", () => {
    expect(relativeDifference("firstVisibleTextMs", 500, 1_000)).toBe(50);
  });

  it.each(["visibleE2eTps", "totalLatencyMs"] as const)(
    "does not report a relative %s difference against a zero baseline",
    (metric) => {
      expect(relativeDifference(metric, 10, 0)).toBeNull();
    },
  );
});
