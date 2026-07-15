import { expect, type Page, type TestInfo } from "@playwright/test";

export type PageHealth = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
};

export function monitorPageHealth(page: Page): PageHealth {
  const health: PageHealth = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") health.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => health.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    health.failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      health.badResponses.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });
  return health;
}

export async function expectHealthyPage(
  page: Page,
  health: PageHealth,
  testInfo: TestInfo,
) {
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText(
    /vite.*error|uncaught runtime error/iu,
  );
  await testInfo.attach("page-health.json", {
    body: JSON.stringify(health, null, 2),
    contentType: "application/json",
  });
  expect(health).toEqual({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
  });
}
