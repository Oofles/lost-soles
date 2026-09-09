import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultFogReadDeps, resolveFogUpdate } from "@/lib/fog/server"

/**
 * GET /api/fog?since=<generation> — ticket `0054`. `05-fog-of-war.md` §7.3;
 * `02-data-model.md` §6.4.
 *
 * The one mutable object in the delivery path, resolved into a plan. `manifest.json` is
 * read from S3 on every request; that is what `Cache-Control: no-cache` on the object has
 * always meant, and the manifest is the authority (`02` §6.4).
 *
 * ─── AUTHENTICATED, NOT OWNER-ONLY, AND THAT IS A DELIBERATE DIFFERENCE ─────
 *
 * `/api/tickets/capture` is owner-allowlisted because it is a write primitive pointed at
 * the source repository, and §6.4/1 says it stays that way *"even after D-014 adds
 * friends"*. This route is the opposite shape: it serves the CALLER THEIR OWN MAP, scoped
 * by the `sub` re-derived from the verified session. An allowlist here would 404 the
 * second account the day one exists, which is not a stricter rule — it is a wrong one.
 *
 * The uid is never read from the query string, the body or a header
 * (`08-security-privacy.md` §5.3). `since` is the only client-supplied input, and the
 * worst a lie about it can do is make the caller fetch their own blob again.
 *
 * NO `POST`/`PUT`/`DELETE` EXPORT. Their absence is the control: a route file exporting
 * only `GET` answers 405 to everything else by construction.
 */

/** SSR, never statically evaluated: this reads a session and S3. */
export const dynamic = "force-dynamic"

/** Byte-identical to what `middleware.ts` returns for a signed-out request. */
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

/**
 * `Number("")` is 0 and `Number("abc")` is NaN — neither may become a generation. A
 * non-integer, negative or absurd `since` is treated as "nothing cached", which is the
 * safe direction: the caller is sent to the full blob rather than handed a delta chain
 * assembled from a number nobody chose.
 */
function parseSince(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) return 0
  return value
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const since = parseSince(new URL(request.url).searchParams.get("since"))
  const update = await resolveFogUpdate(userId, since, defaultFogReadDeps())

  /**
   * THE ETAG IS THE GENERATION, because generation is *"the only cache key the client
   * needs"* (`05` §7.3). Nothing else about this response can change without it changing.
   *
   * A 304 IS ONLY ANSWERED TO A CONDITIONAL REQUEST. `since` alone would be enough to
   * know the client is current, but a 304 sent to an unconditional GET is not a
   * conformant response and a plain `curl` would be left with an empty body it did not
   * ask for. So a caller that sends no `If-None-Match` gets a 200 carrying
   * `plan: "up-to-date"`, which says the same thing in a body — and the browser, which
   * does send the header, gets the 304 this ticket's second operator check looks for.
   */
  const etag = `"${update.generation}"`
  const headers = {
    ETag: etag,
    /**
     * `private`, and that word is doing real work. The app sits behind a CDN, and this
     * body describes one person's map. `no-store` keeps it out of the browser's cache,
     * `private` keeps it out of every shared cache in between — the two together are what
     * make a per-user response safe to serve from a cached origin at all.
     */
    "Cache-Control": "no-store, private",
  }

  if (update.generation > 0 && request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers }) as NextResponse
  }

  return NextResponse.json(update, { headers })
}
