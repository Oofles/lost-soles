import { describe, expect, it } from "vitest"

import type { Trace } from "./activity"
import { FOG_ALGO_VERSION } from "./discovery"
import { canonicalJson, sameActivity, scoreTimeKey, traceDigest } from "./score-key"

/** `0050` criterion 2. `05-fog-of-war.md` §3.5; `02-data-model.md` T8. */

/** Synthetic geography, Point Nemo (08 §7.2, D-199). */
const trace = (over: Partial<Trace> = {}): Trace => ({
  points: [
    { lat: -48.876, lng: -123.393, t: 0 },
    { lat: -48.8735, lng: -123.393, t: 90_000 },
  ],
  gaps: [],
  simplified: false,
  bbox: [-123.393, -48.876, -123.393, -48.8735],
  pointCount: 2,
  ...over,
})

/** A second source id that names nothing real — see the note on the test that uses it. */
const OTHER_SOURCE = "a-source-the-domain-may-not-name"

const INPUT = {
  source: "gpslogger",
  externalId: "9001",
  startedAt: "2026-09-06T03:00:00.000Z",
  trace: trace(),
}

describe("canonicalJson", () => {
  /**
   * `JSON.stringify` preserves INSERTION order. Two normalizers emitting the same points with
   * their keys in different orders would hash differently, and every re-import would look like
   * a revision — the exact failure §3.5's second layer exists to detect.
   */
  it("sorts keys at every depth, so the hash is a function of the values", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ x: { d: 1, c: 2 } })).toBe('{"x":{"c":2,"d":1}}')
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  /**
   * Array order is DATA here, not presentation: a trace reversed is a different trace, and two
   * traces differing only in point order must not share a key.
   */
  it("keeps array order", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it("drops undefined, so an optional field left off matches one set to undefined", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it("handles primitives and null", () => {
    expect(canonicalJson(null)).toBe("null")
    expect(canonicalJson(1)).toBe("1")
    expect(canonicalJson("x")).toBe('"x"')
    expect(canonicalJson(true)).toBe("true")
  })

  it("emits no whitespace", () => {
    expect(canonicalJson({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}')
  })
})

describe("scoreTimeKey — §3.5's formula, exactly", () => {
  it("is <source>#<externalId>#<16 hex>#v<FOG_ALGO_VERSION>", () => {
    const key = scoreTimeKey(INPUT)
    const parts = key.split("#")
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe("gpslogger")
    expect(parts[1]).toBe("9001")
    expect(parts[2]).toMatch(/^[0-9a-f]{16}$/)
    expect(parts[3]).toBe(`v${FOG_ALGO_VERSION}`)
  })

  it("is stable — the same activity hashes the same way every time", () => {
    expect(scoreTimeKey(INPUT)).toBe(scoreTimeKey({ ...INPUT, trace: trace() }))
  })

  /**
   * LAYER 1. Two different activities never collide, however similar their geometry — the
   * source and id are in the key verbatim, not hashed.
   */
  /**
   * The second source is a MADE-UP NAME, and it has to be: `check-boundaries.mjs` forbids
   * naming a real source anywhere in `src/domain` (D-100, D-121.1), down to the prose. The
   * property under test is that the source segment participates in the key at all, which any
   * two distinct strings prove.
   */
  it("differs for a different activity id, and for a different source", () => {
    expect(scoreTimeKey({ ...INPUT, externalId: "9002" })).not.toBe(scoreTimeKey(INPUT))
    expect(scoreTimeKey({ ...INPUT, source: OTHER_SOURCE })).not.toBe(scoreTimeKey(INPUT))
  })

  /**
   * LAYER 2, and the case §3.5 names: *"the SAME source id now has DIFFERENT geometry — the
   * user cropped the activity, or corrected its start time."* The accept gate calls that a
   * duplicate; it is not.
   */
  it("CHANGES when the same activity id is edited — a cropped trace", () => {
    const cropped = trace({ points: [trace().points[0]!], pointCount: 1 })
    expect(scoreTimeKey({ ...INPUT, trace: cropped })).not.toBe(scoreTimeKey(INPUT))
  })

  it("CHANGES when the start time is corrected, even by a second", () => {
    expect(scoreTimeKey({ ...INPUT, startedAt: "2026-09-06T03:00:01.000Z" })).not.toBe(
      scoreTimeKey(INPUT),
    )
  })

  /**
   * §3.5: *"`FOG_ALGO_VERSION` is in the key so that a deliberate algorithm change invalidates
   * every key and forces a full, auditable rescore rather than a silent mix."* Asserted as the
   * literal suffix, so a bump cannot be made without this test noticing.
   */
  it("carries the algorithm version, so a bump invalidates every key", () => {
    expect(scoreTimeKey(INPUT).endsWith(`#v${FOG_ALGO_VERSION}`)).toBe(true)
    expect(FOG_ALGO_VERSION).toBe(1)
  })

  /**
   * §3.6: *"a ledger entry is still written (with `cellCount: 0`), so the idempotency gate
   * covers no-GPS activities too and re-import stays a no-op."*
   */
  it("gives a treadmill run a key too, and two imports of it collide", () => {
    const noTrace = { ...INPUT, trace: undefined }
    expect(scoreTimeKey(noTrace)).toMatch(/^gpslogger#9001#[0-9a-f]{16}#v1$/)
    expect(scoreTimeKey(noTrace)).toBe(scoreTimeKey({ ...noTrace }))
    expect(scoreTimeKey(noTrace)).not.toBe(scoreTimeKey(INPUT))
  })

  it("does not read anything but the points and the start time", () => {
    // `bbox` and `simplified` are derived; a normalizer recomputing them must not mint a key.
    const same = trace({ simplified: true, bbox: [0, 0, 0, 0] })
    expect(traceDigest(INPUT.startedAt, same)).toBe(traceDigest(INPUT.startedAt, trace()))
  })
})

describe("sameActivity — telling a revision from a new run (§3.5)", () => {
  it("is true for two keys over the same source id with different content", () => {
    const cropped = trace({ points: [trace().points[0]!], pointCount: 1 })
    expect(sameActivity(scoreTimeKey(INPUT), scoreTimeKey({ ...INPUT, trace: cropped }))).toBe(true)
  })

  it("is false for a different activity", () => {
    expect(sameActivity(scoreTimeKey(INPUT), scoreTimeKey({ ...INPUT, externalId: "9002" }))).toBe(
      false,
    )
  })

  it("is false across sources, even for the same external id", () => {
    expect(
      sameActivity(scoreTimeKey(INPUT), scoreTimeKey({ ...INPUT, source: OTHER_SOURCE })),
    ).toBe(false)
  })

  /** Two keys for the same content under different algorithm versions are still one activity. */
  it("ignores the algorithm version, which is not part of identity", () => {
    const key = scoreTimeKey(INPUT)
    expect(sameActivity(key, key.replace(/#v\d+$/, "#v99"))).toBe(true)
  })
})
