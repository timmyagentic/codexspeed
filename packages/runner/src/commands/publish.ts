import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import {
  MAX_ARTIFACT_BYTES,
  PublisherError,
  publishArtifact,
  type PublishArtifactOptions,
} from "../publisher.js";

export type PublishCommandOptions = {
  file: string;
  endpoint?: string;
  allowHttpLocalhost: boolean;
};

export type PublishCommandDependencies = {
  publishEnvironment?: NodeJS.ProcessEnv;
  publishFetch?: typeof globalThis.fetch;
  publishNow?: () => Date;
  publishTimeoutMs?: number;
};

async function readBoundedArtifact(file: string): Promise<Uint8Array> {
  let initialMetadata;
  try {
    initialMetadata = await lstat(file);
  } catch {
    throw new PublisherError("benchmark artifact could not be read");
  }
  if (!initialMetadata.isFile() || initialMetadata.isSymbolicLink()) {
    throw new PublisherError("benchmark artifact must be a regular file");
  }
  if (initialMetadata.size > MAX_ARTIFACT_BYTES) {
    throw new PublisherError("benchmark artifact exceeds 1 MiB");
  }

  const flags =
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(file, flags);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new PublisherError("benchmark artifact must be a regular file");
    }
    if (metadata.size > MAX_ARTIFACT_BYTES) {
      throw new PublisherError("benchmark artifact exceeds 1 MiB");
    }

    const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytes,
        buffer.byteLength - totalBytes,
        null,
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    if (totalBytes > MAX_ARTIFACT_BYTES) {
      throw new PublisherError("benchmark artifact exceeds 1 MiB");
    }
    return buffer.subarray(0, totalBytes);
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    throw new PublisherError("benchmark artifact could not be read");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function runPublish(
  options: PublishCommandOptions,
  dependencies: PublishCommandDependencies,
): Promise<string[]> {
  const bytes = await readBoundedArtifact(options.file);

  const environment = dependencies.publishEnvironment ?? process.env;
  const publisherOptions: PublishArtifactOptions = {
    allowHttpLocalhost: options.allowHttpLocalhost,
    keyId: environment["CODEXSPEED_KEY_ID"],
    hmacSecret: environment["CODEXSPEED_HMAC_SECRET"],
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(dependencies.publishFetch === undefined ? {} : { fetch: dependencies.publishFetch }),
    ...(dependencies.publishNow === undefined ? {} : { now: dependencies.publishNow }),
    ...(dependencies.publishTimeoutMs === undefined
      ? {}
      : { timeoutMs: dependencies.publishTimeoutMs }),
  };
  const result = await publishArtifact(bytes, publisherOptions);
  return [
    `Published run ${result.runId} (${result.outcome === "created" ? "created" : "already published"})`,
    `Payload SHA-256: ${result.payloadSha256}`,
  ];
}
