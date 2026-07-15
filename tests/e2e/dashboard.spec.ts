import { expect, test } from "@playwright/test";

import { E2E_RUN } from "./fixture.js";
import { expectHealthyPage, monitorPageHealth } from "./health.js";

test("renders all metrics and compares two measured cells with distribution evidence", async ({
  page,
}, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/CodexSpeed/iu);
  await expect(
    page.getByRole("heading", { name: "Latest benchmark" }),
  ).toBeVisible();
  const streamMatrix = page.getByRole("table", {
    name: "Visible stream TPS by model and reasoning effort",
  });
  await expect(streamMatrix).toBeVisible();
  const atlasRow = streamMatrix.getByRole("row", { name: /Model Atlas/iu });
  const borealRow = streamMatrix.getByRole("row", { name: /Model Boreal/iu });
  await expect(atlasRow.locator('[data-state="measured"]')).toHaveCount(2);
  await expect(atlasRow.locator('[data-state="unmeasured"]')).toHaveCount(1);
  await expect(atlasRow.locator('[data-state="excluded"]')).toHaveCount(1);
  await expect(borealRow.locator('[data-state="unsupported"]')).toHaveCount(2);
  await expect(borealRow.locator('[data-state="invalid-only"]')).toHaveCount(1);
  await expect(borealRow.locator('[data-state="unavailable"]')).toHaveCount(1);

  const expectedMetrics = [
    { label: "Visible stream TPS", value: "86.5 tok/s" },
    { label: "First visible text", value: "600 ms" },
    { label: "Total latency", value: "7.5 s" },
    { label: "Visible E2E TPS", value: "63.4 tok/s" },
  ];
  for (const metric of expectedMetrics) {
    const tab = page.getByRole("tab", { name: metric.label });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("table", {
        name: `${metric.label} by model and reasoning effort`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Model Atlas, Low, ${metric.label}: ${metric.value}, Measured`,
      }),
    ).toBeVisible();
  }

  await page.getByRole("tab", { name: "Visible stream TPS" }).click();
  await page
    .getByRole("button", { name: /Model Atlas, Low.*Measured/iu })
    .click();
  await page
    .getByRole("button", { name: /Model Atlas, High.*Measured/iu })
    .click();
  const compare = page.getByRole("complementary", { name: "Compare" });
  const comparisons = compare.locator("section.comparison");
  await expect(comparisons.nth(0)).toContainText("86.5 tok/s");
  await expect(comparisons.nth(0)).toContainText("83.2–89.8 tok/s");
  await expect(comparisons.nth(0)).toContainText("Samples2");
  await expect(comparisons.nth(1)).toContainText("73.5 tok/s");
  await expect(comparisons.nth(1)).toContainText("72.1–74.9 tok/s");
  await expect(comparisons.nth(1)).toContainText("Samples2");
  await expect(compare).toContainText("Relative difference (A vs B)+17.7%");

  await expectHealthyPage(page, health, testInfo);
});

test("supports keyboard traversal and history-to-detail navigation with exact source evidence", async ({
  page,
}, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "CodexSpeed home" }),
  ).toBeFocused();

  const firstMetric = page.getByRole("tab", { name: "Visible stream TPS" });
  await firstMetric.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "First visible text" }),
  ).toBeFocused();

  const cell = page.getByRole("button", {
    name: /Model Atlas, Low.*Measured/iu,
  });
  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(cell).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/\/runs$/u);
  await page.getByRole("link", { name: /Smoke run/iu }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${E2E_RUN.runId}$`, "u"));
  await expect(page.getByRole("heading", { name: "Samples" })).toBeVisible();
  await expect(
    page.getByText("Tool event", { exact: true }).first(),
  ).toBeVisible();
  const source = page.getByRole("link", { name: "Runner source v0.1.0 →" });
  await expect(source).toHaveAttribute(
    "href",
    "https://github.com/timmyagentic/codexspeed/tree/v0.1.0/packages/runner",
  );

  await page.reload();
  await expect(page.getByText(E2E_RUN.runId, { exact: true })).toBeVisible();
  await expectHealthyPage(page, health, testInfo);
});

test("renders the complete public methodology and deployed third-party notices", async ({
  page,
  request,
}, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/methodology");
  await expect(
    page.getByRole("heading", { name: "Methodology" }),
  ).toBeVisible();
  await expect(
    page.getByText(/one unmeasured warm-up per model/iu),
  ).toBeVisible();
  await expect(
    page.getByText(/default is Ultra.*first selected comparable effort/iu),
  ).toBeVisible();
  await expect(page.getByText(/seeded Fisher.Yates/iu)).toBeVisible();
  await expect(page.getByText(/estimated.*text chunks/iu)).toBeVisible();
  await expect(
    page.getByText(/auxiliary generated E2E API evidence/iu),
  ).toBeVisible();
  await expect(page.getByText(/Ultra.*excluded/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Smoke, full, and exclusions" }),
  ).toBeVisible();
  await expect(page.getByText(/A smoke run.*a full run/iu)).toBeVisible();
  await expect(page.getByText(/publisher key signature only/iu)).toBeVisible();
  await expect(page.getByText(/does not retry automatically/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Interpretation and limitations" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /one synthetic task, machine, network path, account channel.*time window/iu,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /does not measure answer quality.*not a universal model ranking/iu,
    ),
  ).toBeVisible();
  await expect(page.getByText(/Cloudflare Free/iu)).toBeVisible();
  await expect(page.getByText(/Apache-2.0/iu)).toBeVisible();
  const noticesLink = page
    .getByRole("article")
    .getByRole("link", { name: "Third-party notices" });
  await expect(noticesLink).toHaveAttribute("href", "/THIRD_PARTY_NOTICES.md");
  const notices = await request.get("/THIRD_PARTY_NOTICES.md");
  expect(notices.status()).toBe(200);
  const noticeText = await notices.text();
  expect(noticeText).toContain("React 19.2.7");
  expect(noticeText).toContain("Zod 3.25.76");
  await expectHealthyPage(page, health, testInfo);
});

test.describe("375 px mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("uses a menu, stacked matrix region, working comparison, and no page overflow", async ({
    page,
  }, testInfo) => {
    const health = monitorPageHealth(page);
    await page.goto("/");
    await expect(page.getByRole("table")).toHaveCount(0);
    const matrix = page.getByRole("region", {
      name: "Visible stream TPS benchmark matrix",
    });
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('[data-state="measured"]')).toHaveCount(2);
    await expect(matrix.locator('[data-state="unmeasured"]')).toHaveCount(1);
    await expect(matrix.locator('[data-state="unsupported"]')).toHaveCount(2);
    await expect(matrix.locator('[data-state="excluded"]')).toHaveCount(1);
    await expect(matrix.locator('[data-state="invalid-only"]')).toHaveCount(1);
    await expect(matrix.locator('[data-state="unavailable"]')).toHaveCount(1);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await page
      .getByRole("button", { name: /Model Atlas, Low.*Measured/iu })
      .click();
    await page
      .getByRole("button", { name: /Model Atlas, High.*Measured/iu })
      .click();
    await expect(page.getByText("Relative difference (A vs B)")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await expectHealthyPage(page, health, testInfo);
  });
});
