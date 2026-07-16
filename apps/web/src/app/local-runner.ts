export const PUBLIC_RUNNER_VERSION = "0.2.0";
export const RELEASE_ROOT = `https://github.com/timmyagentic/codexspeed/releases/download/v${PUBLIC_RUNNER_VERSION}`;

export const POSIX_RUN_COMMAND =
  "curl --proto '=https' --tlsv1.2 -fsSL https://codexspeed.timmyagentic.com/run.sh | sh";
export const WINDOWS_RUN_COMMAND =
  "irm https://codexspeed.timmyagentic.com/run.ps1 | iex";
export const NODE_RUN_COMMAND = `npx --yes ${RELEASE_ROOT}/codexspeed-${PUBLIC_RUNNER_VERSION}.tgz`;

export const RUNNER_DOWNLOADS = [
  {
    label: "macOS Apple Silicon",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-macos-arm64.tar.gz`,
  },
  {
    label: "macOS Intel",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-macos-x64.tar.gz`,
  },
  {
    label: "Linux x64",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-linux-x64.tar.gz`,
  },
  {
    label: "Linux ARM64",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-linux-arm64.tar.gz`,
  },
  {
    label: "Windows x64",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-windows-x64.zip`,
  },
  {
    label: "Windows ARM64",
    filename: `codexspeed-v${PUBLIC_RUNNER_VERSION}-windows-arm64.zip`,
  },
] as const;
