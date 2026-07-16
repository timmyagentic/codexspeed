import { createRunFixture } from "@codexspeed/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NODE_RUN_COMMAND,
  PUBLIC_RUNNER_VERSION,
  RELEASE_ROOT,
} from "../local-runner.js";
import { LocalRunPage } from "./LocalRunPage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalRunPage", () => {
  it("offers fixed-version run and download paths with local-only copy", () => {
    render(<LocalRunPage />);

    expect(
      screen.getByRole("heading", { name: "Test Codex speed on this device" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NODE_RUN_COMMAND)).toBeInTheDocument();
    expect(PUBLIC_RUNNER_VERSION).toBe("0.2.0");
    expect(RELEASE_ROOT).toContain("/releases/download/v0.2.0");
    expect(
      screen.getByText(/Nothing is uploaded automatically/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "macOS Apple Silicon" }),
    ).toHaveAttribute(
      "href",
      `${RELEASE_ROOT}/codexspeed-v0.2.0-macos-arm64.tar.gz`,
    );
  });

  it("opens and renders a local JSON result without any network request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const run = createRunFixture();
    render(<LocalRunPage />);

    await user.upload(
      screen.getByLabelText("Open a CodexSpeed result"),
      new File([JSON.stringify(run)], "result.json", {
        type: "application/json",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Result on this device" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", {
        name: "Visible stream TPS by model and reasoning effort",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("49.9 tok/s")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a safe error without echoing invalid file contents", async () => {
    const user = userEvent.setup();
    render(<LocalRunPage />);

    await user.upload(
      screen.getByLabelText("Open a CodexSpeed result"),
      new File(['{"unexpected":"do-not-echo-this-value"}'], "invalid.json"),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Result file does not match the CodexSpeed schema.",
    );
    expect(alert).not.toHaveTextContent("do-not-echo-this-value");
  });
});
