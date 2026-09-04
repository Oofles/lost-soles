import { describe, expect, it } from "vitest"

import {
  nextListSinceWatermark,
  NIGHTLY_OVERLAP_SECONDS,
  SWEEP_OVERLAP_SECONDS,
} from "./list-since-watermark"

/**
 * Ticket 0034, criteria 8 and 9.
 *
 * The property under test is not "the watermark is correct" — it is **the watermark is
 * never too far forward**. Too far back costs a list call, which §2.5 rates as free. Too
 * far forward loses a run permanently, on a map that by D-020 never re-fogs. Every case
 * below is written against that asymmetry rather than against an expected value.
 */

const PREVIOUS = "2026-09-01T00:00:00.000Z"
const at = (iso: string) => Date.parse(iso) / 1000
const sweep = (over: Partial<Parameters<typeof nextListSinceWatermark>[0]> = {}) =>
  nextListSinceWatermark({
    previous: PREVIOUS,
    confirmed: [],
    unconfirmed: [],
    overlapSeconds: SWEEP_OVERLAP_SECONDS,
    ...over,
  })

describe("the margins are the numbers §2.3 specifies", () => {
  it("48 hours for the 6-hourly sweep, 14 days for the nightly net", () => {
    // Named constants rather than literals at the call site, so a change is one edit and
    // is visible in a diff as a policy change rather than as a magic number moving.
    expect(SWEEP_OVERLAP_SECONDS).toBe(48 * 3600)
    expect(NIGHTLY_OVERLAP_SECONDS).toBe(14 * 86400)
  })
})

describe("nothing was seen", () => {
  it("leaves the watermark exactly where it was", () => {
    /**
     * An empty page and a silently-broken request look identical from here. Advancing on
     * one would walk the watermark forward a sweep at a time on a connection returning
     * nothing — which is the failure mode that hides itself.
     */
    expect(sweep()).toBe(PREVIOUS)
  })
})

describe("everything was confirmed", () => {
  it("advances to the newest confirmed, less the overlap", () => {
    const result = sweep({
      confirmed: ["2026-09-10T08:00:00.000Z", "2026-09-10T12:00:00.000Z"],
    })
    expect(at(result)).toBe(at("2026-09-10T12:00:00.000Z") - SWEEP_OVERLAP_SECONDS)
  })

  it("moves BACKWARDS in steady state, and that is the margin working", () => {
    /**
     * The tempting `Math.max(previous, …)` would look tidier and would quietly delete the
     * overlap: in steady state the new value lands at roughly `now - 48h`, which is behind
     * a watermark set six hours ago. The sweep is MEANT to keep re-examining two days.
     */
    const result = sweep({
      previous: "2026-09-10T06:00:00.000Z",
      confirmed: ["2026-09-10T12:00:00.000Z"],
    })
    expect(at(result)).toBeLessThan(at("2026-09-10T06:00:00.000Z"))
  })

  it("uses the wider margin when the nightly sweep asks for it", () => {
    const result = sweep({
      confirmed: ["2026-09-10T12:00:00.000Z"],
      overlapSeconds: NIGHTLY_OVERLAP_SECONDS,
    })
    expect(at(result)).toBe(at("2026-09-10T12:00:00.000Z") - NIGHTLY_OVERLAP_SECONDS)
  })
})

/** Criterion 8 — the case the whole design exists for. */
describe("a sweep killed mid-page", () => {
  it("pins the watermark below the oldest UNCONFIRMED activity", () => {
    const result = sweep({
      confirmed: ["2026-09-10T08:00:00.000Z"],
      unconfirmed: ["2026-09-10T09:00:00.000Z", "2026-09-10T11:00:00.000Z"],
    })

    // At or below the oldest thing that did not make it. This single assertion is the
    // criterion: anything above it is an activity that will never be listed again.
    expect(at(result)).toBeLessThanOrEqual(at("2026-09-10T09:00:00.000Z"))
    expect(at(result)).toBe(at("2026-09-10T09:00:00.000Z") - SWEEP_OVERLAP_SECONDS)
  })

  it("re-lists confirmed work rather than skip unconfirmed work", () => {
    /**
     * The interesting ordering: a CONFIRMED activity that is NEWER than an unconfirmed
     * one. The boundary is still the oldest unconfirmed, so the newer confirmed activity
     * gets listed a second time. That is the cheap half of the asymmetry being paid on
     * purpose — and it is safe because `IngestReceipt` dedupes on `ingestKey`.
     */
    const confirmedNewer = "2026-09-10T23:00:00.000Z"
    const result = sweep({
      confirmed: [confirmedNewer],
      unconfirmed: ["2026-09-10T09:00:00.000Z"],
    })

    expect(at(result)).toBeLessThan(at(confirmedNewer))
  })

  it("one unconfirmed activity outweighs two hundred confirmed ones", () => {
    const confirmed = Array.from({ length: 200 }, (_, i) =>
      new Date(Date.parse("2026-09-10T00:00:00.000Z") + i * 60_000).toISOString(),
    )
    const result = sweep({ confirmed, unconfirmed: ["2026-09-10T00:30:00.000Z"] })

    expect(at(result)).toBeLessThanOrEqual(at("2026-09-10T00:30:00.000Z"))
  })

  it("the next sweep therefore re-lists what the crash dropped", () => {
    // The end-to-end statement of criterion 8, at this layer: feed the result back in as
    // the next run's `after`, and the dropped activity is inside the window again.
    const dropped = "2026-09-10T09:00:00.000Z"
    const next = sweep({ confirmed: ["2026-09-10T08:00:00.000Z"], unconfirmed: [dropped] })

    expect(at(dropped)).toBeGreaterThan(at(next))
  })
})

describe("bad input", () => {
  it("refuses a value that is not an ISO instant rather than producing an epoch date", () => {
    // `Date.parse` returns NaN, and NaN arithmetic would silently yield 1970 — a watermark
    // that re-lists eight years of history on every sweep.
    expect(() => sweep({ confirmed: ["yesterday"] })).toThrow(/ISO 8601/)
  })
})
