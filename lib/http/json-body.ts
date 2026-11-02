/**
 * A small JSON object body, or the reason it is not one. Ticket `0331`.
 *
 * Bounded before parsing: the two mutation routes take a handful of fields, and a request body is
 * not something to `JSON.parse` unbounded on a compute that also serves the map.
 */
export const BODY_MAX_BYTES = 16 * 1024

export async function jsonObjectBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: string }> {
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > BODY_MAX_BYTES) return { ok: false, reason: `body must be at most ${BODY_MAX_BYTES} bytes` }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: "body must be JSON" }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "body must be a JSON object" }
  return { ok: true, body: parsed as Record<string, unknown> }
}

/**
 * Only the named fields, as the AppSync SDL's argument list allowed. Anything else in the body,
 * a `userId` included, never reaches the Lambda.
 */
export function pick(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in body) out[f] = body[f]
  return out
}
