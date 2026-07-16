import { RunUploadSchema, type RunUpload } from "@codexspeed/contracts";

export const LOCAL_ARTIFACT_MAX_BYTES = 1_048_576;

export class LocalArtifactError extends Error {}

export async function parseLocalArtifact(file: File): Promise<RunUpload> {
  if (file.size > LOCAL_ARTIFACT_MAX_BYTES) {
    throw new LocalArtifactError("Result file is larger than 1 MiB.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new LocalArtifactError("Result file is not valid UTF-8 JSON.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LocalArtifactError("Result file is not valid UTF-8 JSON.");
  }
  const parsed = RunUploadSchema.safeParse(value);
  if (!parsed.success) {
    throw new LocalArtifactError(
      "Result file does not match the CodexSpeed schema.",
    );
  }
  return parsed.data;
}
