import { createRunFixture } from "@codexspeed/contracts";
import { describe, expect, it } from "vitest";

import {
  LOCAL_ARTIFACT_MAX_BYTES,
  LocalArtifactError,
  parseLocalArtifact,
} from "./local-artifact.js";

describe("parseLocalArtifact", () => {
  it("parses one strict sanitized local run", async () => {
    const run = createRunFixture();
    const file = new File([JSON.stringify(run)], "result.json", {
      type: "application/json",
    });

    await expect(parseLocalArtifact(file)).resolves.toEqual(run);
  });

  it("rejects oversized, invalid UTF-8, and non-contract files safely", async () => {
    const oversized = new File(
      [new Uint8Array(LOCAL_ARTIFACT_MAX_BYTES + 1)],
      "large.json",
    );
    const invalidUtf8 = new File(
      [new Uint8Array([0xc3, 0x28])],
      "invalid.json",
    );
    const run = createRunFixture() as unknown as Record<string, unknown>;
    run["unexpected"] = "must-never-render-this-value";
    const invalidContract = new File([JSON.stringify(run)], "secret.json");

    await expect(parseLocalArtifact(oversized)).rejects.toEqual(
      new LocalArtifactError("Result file is larger than 1 MiB."),
    );
    await expect(parseLocalArtifact(invalidUtf8)).rejects.toEqual(
      new LocalArtifactError("Result file is not valid UTF-8 JSON."),
    );
    await expect(parseLocalArtifact(invalidContract)).rejects.toEqual(
      new LocalArtifactError(
        "Result file does not match the CodexSpeed schema.",
      ),
    );
  });
});
