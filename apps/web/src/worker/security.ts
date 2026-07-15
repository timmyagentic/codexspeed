const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export const NO_STORE_CACHE = "no-store";
export const IMMUTABLE_RUN_CACHE = "public, max-age=31536000, immutable";
export const RUN_LIST_CACHE = "public, max-age=30, s-maxage=30";

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function payloadEtag(payloadSha256: string): string {
  return `"${payloadSha256}"`;
}

export function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const header = request.headers.get("If-None-Match");
  if (header === null) {
    return false;
  }

  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}
