import type { RunUpload } from "@codexspeed/contracts";
import { AppServerProtocolError, type AppServerClient } from "./app-server.js";

export type DiscoveredCatalog = RunUpload["catalog"];
type CatalogModel = DiscoveredCatalog["models"][number];
type CatalogEffort = CatalogModel["defaultEffort"];

const MAX_MODELS = 100;
const CATALOG_EFFORTS = new Set<CatalogEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppServerProtocolError(`model/list returned an invalid ${field}`);
  }
  return value.trim();
}

function effort(value: unknown): CatalogEffort {
  const candidate = requiredString(value, "reasoning effort") as CatalogEffort;
  if (!CATALOG_EFFORTS.has(candidate)) {
    throw new AppServerProtocolError("model/list returned an unsupported reasoning effort");
  }
  return candidate;
}

function projectModel(value: unknown): CatalogModel {
  if (!isObject(value) || typeof value["hidden"] !== "boolean") {
    throw new AppServerProtocolError("model/list returned an invalid model");
  }
  if (!Array.isArray(value["supportedReasoningEfforts"])) {
    throw new AppServerProtocolError("model/list returned invalid supported reasoning efforts");
  }

  const supportedEfforts = value["supportedReasoningEfforts"].map((entry) => {
    if (!isObject(entry)) {
      throw new AppServerProtocolError("model/list returned an invalid reasoning effort option");
    }
    return effort(entry["reasoningEffort"]);
  });
  const defaultEffort = effort(value["defaultReasoningEffort"]);
  if (supportedEfforts.length === 0 || !supportedEfforts.includes(defaultEffort)) {
    throw new AppServerProtocolError("model/list returned an inconsistent default effort");
  }
  if (new Set(supportedEfforts).size !== supportedEfforts.length) {
    throw new AppServerProtocolError("model/list returned duplicate reasoning efforts");
  }

  return {
    id: requiredString(value["id"], "model ID"),
    displayName: requiredString(value["displayName"], "display name"),
    hidden: value["hidden"],
    defaultEffort,
    supportedEfforts,
  };
}

export async function discoverCatalog(client: AppServerClient): Promise<DiscoveredCatalog> {
  const models: CatalogModel[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const response: unknown = await client.request("model/list", {
      includeHidden: true,
      limit: MAX_MODELS,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!isObject(response) || !Array.isArray(response["data"])) {
      throw new AppServerProtocolError("model/list returned an invalid response");
    }

    for (const model of response["data"]) {
      models.push(projectModel(model));
      if (models.length > MAX_MODELS) {
        throw new AppServerProtocolError("model/list exceeded the public catalog limit");
      }
    }

    if (response["nextCursor"] === null || response["nextCursor"] === undefined) break;
    const nextCursor = requiredString(response["nextCursor"], "pagination cursor");
    if (seenCursors.has(nextCursor)) {
      throw new AppServerProtocolError("model/list repeated a pagination cursor");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (models.length === 0) {
    throw new AppServerProtocolError("model/list returned an empty catalog");
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new AppServerProtocolError("model/list returned duplicate model IDs");
  }
  return { models };
}
