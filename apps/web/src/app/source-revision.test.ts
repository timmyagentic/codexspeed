import { describe, expect, it } from "vitest";

import { runnerSourceRevision } from "./source-revision.js";

describe("runnerSourceRevision", () => {
  it("maps a canonical runner version to the exact immutable release tag", () => {
    expect(runnerSourceRevision("0.1.0")).toEqual({
      label: "Runner source v0.1.0",
      url: "https://github.com/timmyagentic/codexspeed/tree/v0.1.0/packages/runner",
    });
  });

  it.each(["v0.1.0", "01.2.3", "latest", "main", "0.1.0/../../settings"])(
    "does not build a mutable or unsafe link for %s",
    (runnerVersion) => {
      expect(runnerSourceRevision(runnerVersion)).toBeNull();
    },
  );
});
