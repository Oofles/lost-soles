/**
 * PARSING STRAVA'S JSON WITHOUT CORRUPTING ITS IDS. Ticket 0034.
 *
 * `03-integrations.md` §2.7 opens with the rule: *"All Strava IDs are strings. Always.
 * `upload_id` is an int64 that exceeds `Number.MAX_SAFE_INTEGER` and is silently
 * corrupted by `JSON.parse` in Node and in the browser — no error, just a wrong number.
 * `activity.id` has the same hazard for recent activities."*
 *
 * WHY THIS IS NOT A PLAIN REVIVER, which is what that section suggests.
 *
 * A `JSON.parse` reviver cannot fix this and never could. By the time the reviver is
 * called, the number has ALREADY been scanned into an IEEE-754 double — the digits are
 * gone, and `String(value)` returns the corrupted value faithfully. The reviver sees the
 * damage, not the source.
 *
 *   JSON.parse('{"id":12345678901234567890}').id  ->  12345678901234567000
 *
 * What DOES work is the reviver's third argument, `context.source` — the ES2025
 * source-text access proposal — which hands back the exact characters the wire carried.
 * That is a reviver, so the design doc's instruction is right in spirit and wrong about
 * the mechanism; the note is recorded here rather than left for the next person to
 * rediscover at the cost of a wrong activity id.
 *
 * WHY THERE IS A FALLBACK AT ALL. `context.source` is recent. This repo pins Node 22 in
 * `.nvmrc` while local development and CI run Node 23, and the Amplify SSR compute is a
 * third runtime nobody here chose. A green test on the developer's machine would prove
 * nothing about the one that matters, and the failure it would hide is the worst kind:
 * an `externalId` that is quietly wrong produces a SECOND activity for one run, forever,
 * on a map that never re-fogs (D-020).
 *
 * So the fallback is deliberately NOT a best-effort regex over the raw text. It is exact
 * up to 2^53 and it THROWS beyond — the same choice `oauth.ts`'s `athleteIdToString`
 * makes, and for the same reason: refusing to make the connection is recoverable, making
 * it against the wrong activity is not. Strava's ids are ten to eleven digits today, so
 * the throwing branch is a guard against a future, not a live limitation.
 */

/**
 * The keys whose NUMERIC values are identifiers. Deliberately a small allowlist rather
 * than "stringify every number": `distance`, `elapsed_time` and `average_speed` are
 * numbers that must stay numbers, and a blanket rule would break every one of them.
 *
 * `athlete.id` and `map.id` are covered by the bare `id` entry. `map.id` arrives as a
 * string already (`"a12345678"`), and the `typeof value === "number"` guard leaves it
 * alone. `external_id` and `gear_id` are strings at the source and need nothing.
 */
const ID_KEYS = new Set(["id", "upload_id"])

/**
 * Whether this runtime hands the reviver the source text. Probed once, at module load,
 * with a value small enough that the probe cannot be expensive.
 *
 * Probed rather than version-sniffed: `process.version` tells you which Node is running
 * and not which V8 it was built against, and the question here is only ever about the
 * behaviour.
 */
export const SOURCE_TEXT_AVAILABLE: boolean = (() => {
  try {
    let sawSource = false
    JSON.parse('{"n":1}', function (_key, value, context?: { source?: string }) {
      if (typeof context?.source === "string") sawSource = true
      return value as unknown
    })
    return sawSource
  } catch {
    return false
  }
})()

export class IdPrecisionError extends Error {
  readonly key: string

  constructor(key: string, approximate: number) {
    super(
      `Strava returned a "${key}" of ${approximate}, which is past 2^53 and cannot be ` +
        `represented exactly by this runtime's JSON parser. Refusing to guess at an id.`,
    )
    this.name = "IdPrecisionError"
    this.key = key
  }
}

/**
 * `JSON.parse`, with identifier-shaped numbers preserved as their exact wire digits.
 *
 * Returns `unknown`: this module's job is precision, not validation. What the shape of a
 * Strava activity is belongs to whoever reads one.
 */
export function parseWithExactIds(text: string): unknown {
  if (SOURCE_TEXT_AVAILABLE) {
    return JSON.parse(text, function (key, value, context?: { source?: string }) {
      if (typeof value === "number" && ID_KEYS.has(key) && typeof context?.source === "string") {
        // The characters the wire carried, before anything rounded them. Note this
        // preserves the digits exactly even when they would not round-trip a double.
        return context.source
      }
      return value as unknown
    })
  }

  return JSON.parse(text, function (key, value) {
    if (typeof value === "number" && ID_KEYS.has(key)) {
      if (!Number.isSafeInteger(value)) throw new IdPrecisionError(key, value)
      // Exact below 2^53: `String` of a safe integer is its decimal digits.
      return String(value)
    }
    return value as unknown
  })
}
