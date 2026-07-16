import { expect, test, type Page } from "@playwright/test";

import { E2E_BODY } from "./fixture.js";
import { expectHealthyPage, monitorPageHealth } from "./health.js";

function monitorApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  return requests;
}

async function openRepresentativeResult(page: Page) {
  await page.getByLabel("Open a CodexSpeed result").setInputFiles({
    buffer: Buffer.from(E2E_BODY),
    mimeType: "application/json",
    name: "codexspeed-result.json",
  });
  await expect(
    page.getByRole("heading", { name: "Result on this device" }),
  ).toBeVisible();
}

test("opens and visualizes a result entirely in the browser without API traffic", async ({
  page,
}, testInfo) => {
  const health = monitorPageHealth(page);
  const apiRequests = monitorApiRequests(page);
  await page.goto("/local");

  await expect(page).toHaveTitle(/CodexSpeed/iu);
  await expect(
    page.getByRole("heading", { name: "Test Codex speed on this device" }),
  ).toBeVisible();
  await expect(page.getByLabel("macOS or Linux command")).toHaveValue(
    "curl --proto '=https' --tlsv1.2 -fsSL https://codexspeed.timmyagentic.com/run.sh | sh",
  );
  await expect(
    page.getByRole("link", { name: "macOS Apple Silicon" }),
  ).toHaveAttribute("href", /codexspeed-v0\.2\.0-macos-arm64\.tar\.gz$/u);

  await openRepresentativeResult(page);
  await expect(
    page.getByText("Runner v0.1.3 · Codex CLI v0.144.1 · macos / arm64"),
  ).toBeVisible();
  await expect(
    page.getByRole("table", {
      name: "Visible stream TPS by model and reasoning effort",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Model Atlas, Low, Visible stream TPS: 86.5 tok/s, Measured",
    }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);

  await expectHealthyPage(page, health, testInfo);
});

test("serves the checksum-verifying POSIX and PowerShell launchers", async ({
  request,
}) => {
  const posix = await request.get("/run.sh");
  expect(posix.status()).toBe(200);
  expect(posix.headers()["content-type"]).toContain("text/plain");
  const posixBody = await posix.text();
  expect(posixBody).toContain('version="0.2.0"');
  expect(posixBody).toContain(
    'release="${repository}/releases/download/v${version}"',
  );
  expect(posixBody).toContain(
    "curl --proto '=https' --tlsv1.2 -fsSL \"$release/SHA256SUMS\"",
  );
  expect(posixBody).toContain('if [ "$actual" != "$expected" ]');

  const powershell = await request.get("/run.ps1");
  expect(powershell.status()).toBe(200);
  expect(powershell.headers()["content-type"]).toContain("text/plain");
  const powershellBody = await powershell.text();
  expect(powershellBody).toContain('$Version = "0.2.0"');
  expect(powershellBody).toContain(
    'Invoke-WebRequest -UseBasicParsing -Uri "$Release/SHA256SUMS"',
  );
  expect(powershellBody).toContain("Get-FileHash -Algorithm SHA256");
  expect(powershellBody).toContain("if ($Actual -ne $Expected)");
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
] as const) {
  test(`${viewport.width} px local result has no horizontal page overflow`, async ({
    page,
  }, testInfo) => {
    const health = monitorPageHealth(page);
    await page.setViewportSize(viewport);
    await page.goto("/local");
    await openRepresentativeResult(page);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await expectHealthyPage(page, health, testInfo);
  });
}
