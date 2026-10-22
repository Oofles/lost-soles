import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultFogReadDeps, getObject } from "@/lib/fog/server"
import { objectKeys } from "@/src/pipeline/explored-blob-store"
import { IMMUTABLE_PRIVATE, withNoStore } from "@/lib/http/no-store"

/**
 * GET /api/fog/lastrun/<generation> — ticket `0100`. `05-fog-of-war.md` §7.2, `06-ui-ux.md` §4.6.
 *
 * The `LSFL` lastRunDay sidecar for one generation, decompressed: u16 days since 2020-01-01,
 * parallel to that generation's `LSFG` cell array (`src/domain/explored-blob.ts`). Ingest has written
 * it beside every generation since `0049`; until this route nothing could read it. The cold-territory
 * wash is its only consumer, and the client fetches it lazily, the first time atlas is shown
 * (operator, 2026-10-20, `0100` Q1 = A).
 *
 * A COPY OF `/api/fog/blob/[gen]`, ON PURPOSE, and every choice there holds here for the same
 * reason: the uid comes from the session only (a caller cannot name an account), the generation is
 * turned into a NUMBER before it reaches a key (no path traversal), the object is gunzipped here
 * rather than trusted through three layers of content-encoding, and a missing generation is a 404.
 * `private, immutable` because a generation is never rewritten and must never sit in a shared cache.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

async function handleGet(
  _request: Request,
  context: { params: Promise<{ gen: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const { gen } = await context.params
  const generation = Number(gen)
  if (!Number.isSafeInteger(generation) || generation < 1) return notFound()

  const bytes = await getObject(objectKeys.lastRun(userId, generation), defaultFogReadDeps())
  if (bytes === undefined) return notFound()

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": IMMUTABLE_PRIVATE,
      "Content-Length": String(bytes.length),
    },
  }) as NextResponse
}

/**
 * C-3 (`08` §2.4, ticket 0114): every response but the 200 carries `Cache-Control: private,
 * no-store`. The 200 keeps D-228's `IMMUTABLE_PRIVATE` carve-out, which the wrapper leaves alone.
 */
export const GET = withNoStore(handleGet)
