import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./SiteHeader.js";

describe("SiteHeader", () => {
  it("marks the active destination as the current page", () => {
    render(<SiteHeader activePath="/runs/fixture-run" />);

    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("returns focus to the menu trigger when Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<SiteHeader activePath="/" />);

    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    const runs = screen.getByRole("link", { name: "Runs" });
    runs.focus();

    await user.keyboard("{Escape}");

    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });
});
