export class ProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;

  constructor(status: number, code: string, title: string) {
    super(title);
    this.name = "ProblemError";
    this.status = status;
    this.code = code;
    this.title = title;
  }
}

export function problem(
  status: number,
  code: string,
  title: string,
  requestId: string,
): Response {
  return new Response(
    JSON.stringify({
      type: `/problems/${code}`,
      title,
      status,
      requestId,
    }),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
      },
    },
  );
}
