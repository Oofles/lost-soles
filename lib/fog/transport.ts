import { FOG_UPDATE_PATH, fogBlobPath, type FogUpdate, type FogUpdateResponse } from "./wire"

/**
 * THE BROWSER HALF OF THE DELIVERY CONTRACT. Ticket `0054`. `05-fog-of-war.md` §7.3.
 *
 * Two calls and nothing else, behind an interface so that `boot.ts` — which owns every
 * decision in `02-data-model.md` §6.4 — can be tested with no network, no `fetch` and no
 * Next.js. The seam is also where `0113`'s offline behaviour will attach.
 */
export interface FogTransport {
  /**
   * @param since the client's cached generation, or `null` on a cold start.
   * @returns a 304 when the client is already current — `02` §6.4 step 3's *"common case,
   *          and it costs one 304"* — otherwise the resolved plan.
   */
  update(since: number | null): Promise<FogUpdateResponse>
  /** The `LSFG` bytes for one generation. Immutable, so the HTTP cache is trustworthy. */
  blob(generation: number): Promise<Uint8Array>
}

export class FogTransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "FogTransportError"
  }
}

type Fetch = typeof globalThis.fetch

export function httpTransport(fetchImpl: Fetch = globalThis.fetch): FogTransport {
  return {
    async update(since) {
      /**
       * `?since` AND `If-None-Match`, which is not belt-and-braces.
       *
       * `since` is the semantic parameter: the server needs it to resolve `up-to-date` /
       * `delta` / `full`, and putting it in the URL means the request is legible in
       * DevTools and identifies itself to any cache in between.
       *
       * The header is what makes a **304 legal**. A 304 is only a conformant answer to a
       * CONDITIONAL request, and this ticket's second operator check is precisely that
       * the manifest request shows as a 304 in remote DevTools. The ETag is the
       * generation itself — there is nothing else it could usefully be, since generation
       * is *"the only cache key the client needs"* (`05` §7.3).
       */
      const headers: Record<string, string> = {}
      if (since !== null) headers["If-None-Match"] = `"${since}"`

      const response = await fetchImpl(`${FOG_UPDATE_PATH}?since=${since ?? 0}`, {
        headers,
        credentials: "same-origin",
        /**
         * The one mutable object in the delivery path (`05` §7.3). `no-store` keeps the
         * browser from answering out of its own cache — the conditional request above is
         * the revalidation, and a second cache layer in front of it would only be able to
         * make the answer older.
         */
        cache: "no-store",
      })

      if (response.status === 304) return { status: 304 }
      if (!response.ok) {
        throw new FogTransportError(response.status, `GET ${FOG_UPDATE_PATH} → ${response.status}`)
      }
      return { status: 200, update: (await response.json()) as FogUpdate }
    },

    async blob(generation) {
      /**
       * `cache: "default"`, deliberately, and it is the whole reason the route is named by
       * generation. The response carries `immutable`, a generation is never rewritten, so
       * a browser that already holds these bytes must be allowed to skip the transfer —
       * which is what makes a re-open after a delta-chain gap cheap rather than 370 KB.
       */
      const response = await fetchImpl(fogBlobPath(generation), {
        credentials: "same-origin",
        cache: "default",
      })
      if (!response.ok) {
        throw new FogTransportError(
          response.status,
          `GET ${fogBlobPath(generation)} → ${response.status}`,
        )
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
