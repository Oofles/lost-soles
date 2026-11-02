import { NextResponse } from "next/server"

/**
 * Shared pieces of the same-origin model routes. Ticket `0331`, D-472.
 */

/** Byte-identical to what `middleware.ts` returns for a signed-out request. */
export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

export const badRequest = (reason: string) => NextResponse.json({ error: reason }, { status: 400 })

/**
 * An opaque id from a path segment or the query string: a skill id or an activity id, NEVER a user
 * id. Bounded, and no `#`, because both are spliced into composite keys (`${userId}#${skillId}`)
 * where a separator would change what the prefix means.
 */
export function opaqueId(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.includes("#")) return undefined
  return value
}
