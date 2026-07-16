import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MethodologyPage } from "./MethodologyPage.js";

describe("MethodologyPage", () => {
  it("makes the scrollable fixed prompt keyboard focusable", () => {
    render(<MethodologyPage />);

    const heading = screen.getByRole("heading", { name: "Fixed prompt" });
    const prompt = heading.parentElement?.querySelector("pre");

    expect(prompt).toBeInstanceOf(HTMLPreElement);
    expect(prompt).toHaveAttribute("tabindex", "0");
  });

  it("distinguishes bounded series runs from smoke and full runs", () => {
    render(<MethodologyPage />);

    expect(
      screen.getByRole("heading", {
        name: "Smoke, series, full, and exclusions",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/series run covers every comparable cell/iu),
    ).toBeVisible();
  });
});
