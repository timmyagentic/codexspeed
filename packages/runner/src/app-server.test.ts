import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppServerClient,
  AppServerExitedError,
  AppServerProtocolError,
  AppServerTimeoutError,
} from "./app-server.js";
import { discoverCatalog } from "./catalog.js";

const fakeServer = fileURLToPath(new URL("../test/fake-app-server.mjs", import.meta.url));
const clients = new Set<AppServerClient>();

async function connect(
  scenario: string,
  overrides: Partial<Parameters<typeof AppServerClient.connect>[0]> = {},
): Promise<AppServerClient> {
  const client = await AppServerClient.connect({
    command: process.execPath,
    args: [fakeServer, scenario],
    requestTimeoutMs: 500,
    turnTimeoutMs: 500,
    ...overrides,
  });
  clients.add(client);
  return client;
}

afterEach(async () => {
  await Promise.all([...clients].map(async (client) => client.close()));
  clients.clear();
});

describe("AppServerClient", () => {
  it("performs the initialize/initialized handshake and correlates numeric requests", async () => {
    const client = await connect("concurrent");

    const [one, two] = await Promise.all([
      client.request<{ value: string }>("echo/one", {}),
      client.request<{ value: string }>("echo/two", {}),
    ]);

    expect(one).toEqual({ value: "echo/one" });
    expect(two).toEqual({ value: "echo/two" });
  });

  it("times out a request with a stable error", async () => {
    const client = await connect("request-timeout");
    const startedAt = performance.now();

    await expect(
      client.request("model/list", {}, { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(AppServerTimeoutError);
    expect(performance.now() - startedAt).toBeLessThan(200);
  });

  it.each([
    ["malformed", AppServerProtocolError],
    ["exit", AppServerExitedError],
    ["oversized", AppServerProtocolError],
  ])("rejects pending work when the server scenario is %s", async (scenario, ErrorType) => {
    const client = await connect(scenario, { maxStdoutLineBytes: 1_024 });

    await expect(client.request("model/list", {})).rejects.toBeInstanceOf(ErrorType);
  });

  it("bounds stderr diagnostics and never exposes stderr through errors", async () => {
    const client = await connect("stderr-exit", { maxStderrBytes: 256 });

    const error = await client.request("model/list", {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppServerExitedError);
    expect(String(error)).not.toContain("SHOULD_NOT_LEAK");
    expect(String(error)).not.toContain("xxxxx");
  });

  it("closes gracefully and rejects new requests", async () => {
    const client = await connect("normal");

    await client.close();

    await expect(client.request("model/list", {})).rejects.toBeInstanceOf(AppServerExitedError);
  });

  it("rejects promptly when the executable cannot be spawned", async () => {
    const outcome = await Promise.race([
      AppServerClient.connect({
        command: "/definitely/missing/codexspeed-app-server",
        requestTimeoutMs: 50,
      }).catch((error: unknown) => error),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 750)),
    ]);

    expect(outcome).toBeInstanceOf(AppServerExitedError);
  });
});

describe("discoverCatalog", () => {
  it("paginates and projects only public allow-listed model fields", async () => {
    const client = await connect("catalog");

    const catalog = await discoverCatalog(client);

    expect(catalog).toEqual({
      models: [
        {
          id: "gpt-visible",
          displayName: "Visible Model",
          hidden: false,
          defaultEffort: "medium",
          supportedEfforts: ["low", "medium"],
        },
        {
          id: "gpt-hidden",
          displayName: "Hidden Model",
          hidden: true,
          defaultEffort: "ultra",
          supportedEfforts: ["high", "ultra"],
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain("must not escape");
    expect(JSON.stringify(catalog)).not.toContain("provider-internal");
  });
});
