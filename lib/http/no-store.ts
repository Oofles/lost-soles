/**
 * `Cache-Control` on every authed response. Ticket `0114`; `08-security-privacy.md` §2.4, C-3.
 *
 * "A shared CDN cache in front of a per-user map is a cross-user disclosure waiting for a second
 * account." Before this wrapper, each route set the header on its success path by hand and its
 * 404, 304, redirect and error paths not at all. A header that depends on remembering it at every
 * `return` is missing from some of them.
 *
 * So the header is set in ONE place, on whatever the handler returns, and
 * `scripts/check-route-cache-control.mjs` fails the build when a route handler is exported without
 * going through this wrapper. Every route under `app/` is authed: `middleware.ts` 404s a signed-out
 * API request before it reaches a handler. The one public endpoint, the webhook, is a Lambda
 * Function URL and is not a Next route (D-345).
 */

/** C-3's `private, no-store`, in the order the routes already spelled it. Order is not meaningful. */
export const NO_STORE = "no-store, private"

/**
 * D-228's one carve-out. A generation-named blob never changes, so re-downloading it on every load
 * is waste. `private` still keeps it out of every shared cache, which is C-3's point. Only
 * `/api/fog/blob/[gen]` and `/api/fog/lastrun/[gen]` may set it, and the route check enforces that.
 */
export const IMMUTABLE_PRIVATE = "private, max-age=31536000, immutable"

/**
 * Wraps a route handler so that every response it returns carries `private, no-store`, unless the
 * handler set exactly {@link IMMUTABLE_PRIVATE}. Any other value is overwritten, so a stray
 * `public` or `s-maxage` cannot survive this wrapper.
 */
export function withNoStore<A extends unknown[], R extends Response>(
  handler: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const response = await handler(...args)
    if (response.headers.get("cache-control") === IMMUTABLE_PRIVATE) return response
    try {
      response.headers.set("Cache-Control", NO_STORE)
      return response
    } catch {
      // `Response.redirect()` and `Response.error()` have immutable headers. Rebuild the response
      // rather than return one without the header. Nothing here uses them today; this is so a
      // future route that does gets the header instead of a TypeError.
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", NO_STORE)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }) as R
    }
  }
}
