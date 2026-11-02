import { withApiTimeout } from "@/lib/http/timeout"

/**
 * THE BROWSER'S CALL TO ONE OF THIS APP'S MODEL ROUTES. Ticket `0331`, D-472.
 *
 * The transports that used to call AppSync (`lib/{skills,runs/ledger,log,run-kind}/transport.ts`)
 * call these routes instead, through this. Same-origin, `no-store` (the routes are
 * `private, no-store` and carry no revalidation token), inside `06` §9.5's 10 s.
 *
 * A non-2xx is thrown as {@link RouteError}, carrying the GraphQL-shaped `errors` list the two
 * mutation routes return, so the transports' existing `errorFrom`/`errorText` read it unchanged.
 * A signed-out 404 is an error here too, as an AppSync call with no session was.
 */

export class RouteError extends Error {
  constructor(
    readonly status: number,
    readonly errors: readonly { message?: string; errorType?: string }[],
    message: string,
  ) {
    super(message)
    this.name = "RouteError"
  }
}

type Fetch = typeof globalThis.fetch

export function sameOriginJson<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  fetchImpl: Fetch = globalThis.fetch,
): Promise<T> {
  const method = init.method ?? "GET"
  return withApiTimeout(`${method} ${path}`, async (signal) => {
    const response = await fetchImpl(path, {
      method,
      signal,
      credentials: "same-origin",
      cache: "no-store",
      ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { errors?: unknown } | null
      const errors = Array.isArray(body?.errors) ? (body.errors as { message?: string }[]) : []
      throw new RouteError(response.status, errors, `${method} ${path} returned ${response.status}`)
    }
    return (await response.json()) as T
  })
}
