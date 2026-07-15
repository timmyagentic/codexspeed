import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { E2E_RUN } from "./fixture.js";
import { expectHealthyPage, monitorPageHealth } from "./health.js";

const routeCases: readonly {
  route: string;
  ready(page: Page): Promise<void>;
}[] = [
  {
    route: "/",
    ready: async (page) => {
      await expect(
        page.getByRole("table", {
          name: "Visible stream TPS by model and reasoning effort",
        }),
      ).toBeVisible();
    },
  },
  {
    route: "/runs",
    ready: async (page) => {
      await expect(
        page.getByRole("link", { name: /Smoke run/iu }),
      ).toBeVisible();
    },
  },
  {
    route: `/runs/${E2E_RUN.runId}`,
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "Samples" }),
      ).toBeVisible();
      await expect(
        page.getByText(E2E_RUN.runId, { exact: true }),
      ).toBeVisible();
    },
  },
  {
    route: "/methodology",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "Methodology" }),
      ).toBeVisible();
    },
  },
];

for (const { route, ready } of routeCases) {
  test(`${route} has no serious or critical accessibility violations`, async ({
    page,
  }, testInfo) => {
    const health = monitorPageHealth(page);
    await page.goto(route);
    await ready(page);
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    await testInfo.attach("axe-results.json", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(violations).toEqual([]);
    await expectHealthyPage(page, health, testInfo);
  });
}
