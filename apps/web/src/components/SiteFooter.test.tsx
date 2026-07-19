import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./SiteFooter.js";

describe("SiteFooter", () => {
  it("states the public display-only contract and the evidence workflow", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText(/public, display-only archive/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/zero-upload local benchmark/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/signed result/i)).toBeInTheDocument();
    expect(screen.getByText(/public ledger/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Methodology" })).toHaveAttribute(
      "href",
      "/methodology",
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/timmyagentic/codexspeed",
    );
    expect(
      screen.getByRole("link", { name: "Third-party notices" }),
    ).toHaveAttribute("href", "/THIRD_PARTY_NOTICES.md");
  });
});
