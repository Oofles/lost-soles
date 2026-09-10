import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultRunReadDeps, latestRun } from "@/lib/runs/server"

/**
 * GET /api/runs/latest — ticket `0195`. `02-data-model.md` §5.1 (S-7);
 * `05-fog-of-war.md` §4.4.
 *
 * The caller's most recent traced activity, as a GeoJSON `FeatureCollection`. `0057` draws it
 * above the fog and writes it into the coverage mask as an optimistic corridor; nothing else
 * reads it yet.
 *
 * ─── THE LATEST RUN ONLY, AND THAT IS THE WHOLE ENDPOINT ────────────────────
 *
 * `0057`'s criteria name *"the latest run"* twice and never ask for more. `0085` owns the
 * permanent web of every past route, in capability 12, and it will need paging, a bounding-box
 * filter and a client that can ask for both — none of which exist. A list endpoint built now
 * would be a list endpoint built against no caller, guessed at, and rewritten when the caller
 * finally arrives.
 *
 * ─── AUTHENTICATED, SCOPED BY THE SESSION, THE SAME SHAPE AS `/api/fog` ─────
 *
 * The uid is re-derived from the verified session and is never read from the query string, the
 * body or a header (`08-security-privacy.md` §5.3). It is the DynamoDB partition key and half
 * the S3 key below it, so it is the only thing standing between this route and another
 * account's map — which is why `lib/runs/server.ts` rebuilds the object key from it rather
 * than trusting the `traceRef` string on the row it just read.
 *
 * NO `POST`/`PUT`/`DELETE` EXPORT. Their absence is the control: a route file exporting only
 * `GET` answers 405 to everything else by construction.
 */

/** SSR, never statically evaluated: this reads a session, DynamoDB and S3. */
export const dynamic = "force-dynamic"

/** Byte-identical to what `middleware.ts` returns for a signed-out request. */
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

export async function GET(): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const collection = await latestRun(userId, defaultRunReadDeps())

  return NextResponse.json(collection, {
    headers: {
      /**
       * `private`, for the reason `/api/fog` sets out at length: the app sits behind a CDN and
       * this body is a precise record of where one person ran. `no-store` keeps it out of the
       * browser's cache, `private` keeps it out of every shared cache in between.
       *
       * NO `ETag` HERE, unlike `/api/fog`. That route has a generation counter — a cache key
       * that provably changes whenever the body does. This one has no such number, and an
       * ETag derived from the body would have to serialise it first, which is the whole cost
       * of the response. `05` §7.4's trigger already tells the client when to re-ask.
       */
      "Cache-Control": "no-store, private",
    },
  })
}
