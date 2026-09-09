import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultFogReadDeps, getObject } from "@/lib/fog/server"
import { objectKeys } from "@/src/pipeline/explored-blob-store"

/**
 * GET /api/fog/blob/<generation> — ticket `0054`. `05-fog-of-war.md` §7.1, §7.3.
 *
 * The `LSFG` bytes for one generation, decompressed. The client decodes them with the
 * same `decodeExploredBlob` the ingest worker encodes with (`src/domain/explored-blob.ts`
 * is shared for exactly this reason), so there is nothing to reinterpret here.
 *
 * ─── SERVED, NOT PRESIGNED ──────────────────────────────────────────────────
 *
 * `01-architecture.md` §5 described a presigned S3 URL. D-228 replaced it: the browser's
 * S3 grant is keyed by identity-pool id and the objects are keyed by Cognito `sub`, so a
 * presigned URL was never reachable for the delta chain and never correct for this. The
 * cost is one transfer of ~370 KB through the compute role, once per generation change —
 * and only when the delta chain does not reach.
 *
 * ─── GUNZIPPED HERE RATHER THAN PASSED THROUGH ──────────────────────────────
 *
 * The object is stored gzipped with `Content-Encoding: gzip`, which is a promise made to
 * a browser fetching S3 directly. Forwarding both the bytes and that header through a
 * Next route means trusting three layers — the route, the platform's own compression, and
 * the CDN — not to re-encode or double-encode it, and a double-encoded body fails as a
 * corrupt blob with no clue pointing at transport. `02` §6.2 measures gzip's gain over
 * delta+varint as close to nothing anyway (*"treat the varint size as the floor"*), so
 * decompressing here costs a few tens of kilobytes and removes a whole class of failure.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

export async function GET(
  _request: Request,
  context: { params: Promise<{ gen: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const { gen } = await context.params
  const generation = Number(gen)
  /**
   * A generation is a positive safe integer and nothing else. This is also the path
   * traversal guard: the value is turned into a NUMBER before it is interpolated into a
   * key, so no string a caller supplies can reach `objectKeys.cells` at all.
   */
  if (!Number.isSafeInteger(generation) || generation < 1) return notFound()

  const bytes = await getObject(objectKeys.cells(userId, generation), defaultFogReadDeps())
  /**
   * A generation that was allocated and never published — a worker that lost the manifest
   * race (D-219) — leaves no object. That is a normal outcome, not an error, and 404 is
   * the honest answer: the client's remedy is to re-read the manifest, which now names a
   * generation that does exist.
   */
  if (bytes === undefined) return notFound()

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      /**
       * IMMUTABLE, AND `private`. A generation is never rewritten (`05` §7.3), so a year
       * is the correct max-age and the browser may skip the transfer entirely on a
       * re-open. `private` is what keeps a shared cache in front of the app from holding
       * one person's territory under a URL another person could ask for — the same reason
       * the update route sets it, and the reason this is not simply `public`.
       */
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(bytes.length),
    },
  }) as NextResponse
}
