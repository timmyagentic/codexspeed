import { CanonicalSemverSchema } from "@codexspeed/contracts";

const RUNNER_SOURCE_ROOT = "https://github.com/timmyagentic/codexspeed/tree";

export type RunnerSourceRevision = {
  label: string;
  url: string;
};

export function runnerSourceRevision(
  runnerVersion: string,
): RunnerSourceRevision | null {
  const parsed = CanonicalSemverSchema.safeParse(runnerVersion);
  if (!parsed.success) {
    return null;
  }

  return {
    label: `Runner source v${parsed.data}`,
    url: `${RUNNER_SOURCE_ROOT}/v${parsed.data}/packages/runner`,
  };
}
