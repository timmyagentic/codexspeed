import { describe, expect, it } from "vitest";

import {
  createCodexProcessInvocation,
  resolveCodexCommand,
} from "./runtime.js";

describe("Codex command discovery", () => {
  it("uses an explicit command without probing the machine", async () => {
    let probes = 0;
    await expect(
      resolveCodexCommand("/custom/codex", {
        platform: "linux",
        homePath: "/workspace/test-home",
        pathValue: "/bin",
        pathExtensions: [""],
        isAvailable: async () => {
          probes += 1;
          return false;
        },
      }),
    ).resolves.toBe("/custom/codex");
    expect(probes).toBe(0);
  });

  it("finds the first Codex executable on PATH", async () => {
    await expect(
      resolveCodexCommand(undefined, {
        platform: "linux",
        homePath: "/workspace/test-home",
        pathValue: "/first:/second",
        pathExtensions: [""],
        isAvailable: async (path) => path === "/second/codex",
      }),
    ).resolves.toBe("/second/codex");
  });

  it("falls back to the Codex binary inside the macOS ChatGPT app", async () => {
    const appBinary = "/Applications/ChatGPT.app/Contents/Resources/codex";
    await expect(
      resolveCodexCommand(undefined, {
        platform: "darwin",
        homePath: "/workspace/test-home",
        pathValue: "/usr/bin:/bin",
        pathExtensions: [""],
        isAvailable: async (path) => path === appBinary,
      }),
    ).resolves.toBe(appBinary);
  });

  it("returns a stable setup error when Codex cannot be found", async () => {
    await expect(
      resolveCodexCommand(undefined, {
        platform: "linux",
        homePath: "/workspace/test-home",
        pathValue: "/usr/bin:/bin",
        pathExtensions: [""],
        isAvailable: async () => false,
      }),
    ).rejects.toThrow(
      "Codex CLI is unavailable; install Codex and sign in with ChatGPT first",
    );
  });
});

describe("Codex process invocation", () => {
  it("starts native commands directly", () => {
    expect(
      createCodexProcessInvocation(
        "/usr/bin/codex",
        ["prefix"],
        ["app-server"],
        "linux",
      ),
    ).toEqual({
      command: "/usr/bin/codex",
      arguments: ["prefix", "app-server"],
      windowsVerbatimArguments: false,
    });
  });

  it("starts a Windows npm command shim through ComSpec", () => {
    expect(
      createCodexProcessInvocation(
        "C:\\Program Files\\nodejs\\codex.cmd",
        [],
        ["login", "status"],
        "win32",
        "C:\\Windows\\System32\\cmd.exe",
      ),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      arguments: [
        "/d",
        "/s",
        "/v:off",
        "/c",
        '""C:\\Program Files\\nodejs\\codex.cmd" "login" "status""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it("rejects unsafe Windows command interpolation", () => {
    expect(() =>
      createCodexProcessInvocation(
        "C:\\Tools\\%USERNAME%\\codex.cmd",
        [],
        ["--version"],
        "win32",
        "C:\\Windows\\System32\\cmd.exe",
      ),
    ).toThrow(
      "Codex command contains characters unsupported by the Windows launcher",
    );
  });
});
