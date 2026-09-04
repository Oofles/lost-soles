import { describe, expect, it } from "vitest"

import { IdPrecisionError, parseWithExactIds, SOURCE_TEXT_AVAILABLE } from "./json-ids"

/**
 * Ticket 0034, criteria 4 and 5. `03-integrations.md` §2.7: *"All Strava IDs are strings.
 * Always."*
 *
 * The hazard is that the failure is SILENT. `JSON.parse` does not throw on an int64 — it
 * rounds, hands back a number that looks entirely reasonable, and the wrong id becomes a
 * second activity for one run on a map that never re-fogs.
 */

/**
 * Nineteen digits. Comfortably past 2^53 (16 digits) and shaped like the `upload_id`
 * §2.7 names, which is the field that actually exceeds it today.
 */
const BIG_ID = "12345678901234567890"

describe("criterion 5 — a plain JSON.parse is shown to get this wrong", () => {
  it("corrupts a large id, silently, with no error", () => {
    /**
     * THIS TEST EXISTS TO PROVE THE REVIVER IS DOING WORK. Without it, criterion 4 could
     * pass against a runtime that happened not to need any help, and nobody would know
     * which of the two was true.
     */
    const naive = JSON.parse(`{"id":${BIG_ID}}`) as { id: number }

    expect(String(naive.id)).not.toBe(BIG_ID)
    // And this is the part that makes it dangerous rather than merely lossy: no throw,
    // and a value that reads as a perfectly ordinary id.
    expect(typeof naive.id).toBe("number")
    expect(Number.isNaN(naive.id)).toBe(false)
  })
})

describe("criterion 4 — ids survive as exact strings", () => {
  it("preserves an id past 2^53 character for character", () => {
    if (!SOURCE_TEXT_AVAILABLE) {
      // On a runtime without source-text access the documented behaviour is a THROW, not
      // a rounded id. Asserted in its own describe below; skipped here rather than
      // silently weakened, so this test never passes for the wrong reason.
      expect(() => parseWithExactIds(`{"id":${BIG_ID}}`)).toThrow(IdPrecisionError)
      return
    }

    const parsed = parseWithExactIds(`{"id":${BIG_ID}}`) as { id: string }
    expect(parsed.id).toBe(BIG_ID)
    expect(typeof parsed.id).toBe("string")
  })

  it("preserves an ordinary ten-digit id as a string too", () => {
    // The common case. Uniform output matters: a consumer must never have to ask whether
    // this particular id was big enough to be a string.
    const parsed = parseWithExactIds('{"id":15134912345}') as { id: string }
    expect(parsed.id).toBe("15134912345")
  })

  it("covers upload_id, the field §2.7 names as the one that exceeds 2^53 today", () => {
    const text = `{"id":42,"upload_id":${BIG_ID}}`
    if (!SOURCE_TEXT_AVAILABLE) {
      expect(() => parseWithExactIds(text)).toThrow(IdPrecisionError)
      return
    }
    expect(parseWithExactIds(text)).toEqual({ id: "42", upload_id: BIG_ID })
  })

  it("reaches a nested athlete.id", () => {
    const parsed = parseWithExactIds('{"athlete":{"id":51449053}}') as { athlete: { id: string } }
    expect(parsed.athlete.id).toBe("51449053")
  })

  it("reaches ids inside an array, which is the shape the list endpoint returns", () => {
    const parsed = parseWithExactIds('[{"id":1},{"id":2}]') as Array<{ id: string }>
    expect(parsed.map((a) => a.id)).toEqual(["1", "2"])
  })
})

describe("what it deliberately leaves alone", () => {
  it("does not touch measurements, which must stay numbers", () => {
    /**
     * The allowlist is the whole reason this is safe. "Stringify every number" would turn
     * `distance` into `"10442.5"` and break every consumer downstream — a much larger bug
     * than the one being fixed.
     */
    const parsed = parseWithExactIds(
      '{"id":7,"distance":10442.5,"elapsed_time":3600,"average_speed":2.9}',
    ) as Record<string, unknown>

    expect(parsed.distance).toBe(10442.5)
    expect(parsed.elapsed_time).toBe(3600)
    expect(parsed.average_speed).toBe(2.9)
    expect(parsed.id).toBe("7")
  })

  it("leaves an id that is already a string exactly as it was", () => {
    // `map.id` is `"a12345678"` at the source — a string, and not a decimal one.
    const parsed = parseWithExactIds('{"map":{"id":"a12345678"}}') as { map: { id: string } }
    expect(parsed.map.id).toBe("a12345678")
  })

  it("leaves a key that merely contains 'id' alone", () => {
    // `gear_id` and `external_id` are strings at the source; `resource_state` is a number
    // that is not an identifier. None of them are in the allowlist.
    const parsed = parseWithExactIds('{"resource_state":2,"kudos_count":3}') as Record<string, number>
    expect(parsed).toEqual({ resource_state: 2, kudos_count: 3 })
  })
})

describe("the fallback, on a runtime without source-text access", () => {
  it("refuses rather than guessing when it cannot be exact", () => {
    /**
     * The `athleteIdToString` precedent from ticket 0032, and the same reasoning: refusing
     * to ingest is recoverable, ingesting against the wrong activity is not. This is a
     * guard against a future — Strava's ids are ten to eleven digits today — and it must
     * never quietly become a rounding.
     */
    if (SOURCE_TEXT_AVAILABLE) {
      // This runtime takes the exact path, so the throw is unreachable here. Asserting the
      // detection instead keeps the test honest about which branch it just exercised.
      expect(SOURCE_TEXT_AVAILABLE).toBe(true)
      return
    }
    expect(() => parseWithExactIds(`{"id":${BIG_ID}}`)).toThrow(IdPrecisionError)
  })

  it("reports which branch this runtime takes", () => {
    // Not an assertion so much as a record. `.nvmrc` pins 22, local and CI run 23, and the
    // SSR compute is a third runtime — so which branch is live is a fact worth surfacing
    // rather than assuming.
    expect(typeof SOURCE_TEXT_AVAILABLE).toBe("boolean")
  })
})

describe("malformed input", () => {
  it("throws on JSON that is not JSON, as JSON.parse would", () => {
    expect(() => parseWithExactIds("{not json")).toThrow()
  })
})
