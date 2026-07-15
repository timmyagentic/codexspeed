import {
  LatestRunResponseSchema,
  PublicRunResponseSchema,
  RunListResponseSchema,
  type LatestRunResponse,
  type PublicRunResponse,
  type RunListResponse,
} from "@codexspeed/contracts";
type RuntimeSchema<T> = { parse: (value: unknown) => T };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(url: string, schema: RuntimeSchema<T>, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`);
  }
  return schema.parse(await response.json());
}

export function fetchLatest(signal?: AbortSignal): Promise<LatestRunResponse> {
  return requestJson("/api/v1/latest", LatestRunResponseSchema, signal);
}

export function fetchRun(runId: string, signal?: AbortSignal): Promise<PublicRunResponse> {
  return requestJson(`/api/v1/runs/${encodeURIComponent(runId)}`, PublicRunResponseSchema, signal);
}

export function fetchRuns(cursor?: string, signal?: AbortSignal): Promise<RunListResponse> {
  const parameters = new URLSearchParams({ limit: "20" });
  if (cursor !== undefined) {
    parameters.set("cursor", cursor);
  }
  return requestJson(`/api/v1/runs?${parameters.toString()}`, RunListResponseSchema, signal);
}
