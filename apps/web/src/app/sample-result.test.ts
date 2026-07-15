import { createRunFixture } from "@codexspeed/contracts";
import { describe, expect, it } from "vitest";

import { describePublishedSample } from "./sample-result.js";

describe("describePublishedSample", () => {
  it("uses the frozen suite 1.0 reason precedence", () => {
    const sample = { ...createRunFixture().samples[0]!, reroutedTo: "fallback-model" };

    expect(describePublishedSample("1.0.0", sample)).toEqual({
      valid: false,
      label: "Rerouted → fallback-model",
    });
  });

  it("does not reinterpret an unknown historical suite with current rules", () => {
    const sample = createRunFixture().samples[0]!;

    expect(describePublishedSample("2.0.0", sample)).toEqual({
      valid: null,
      label: "Validity reason unavailable for suite 2.0.0",
    });
  });
});
