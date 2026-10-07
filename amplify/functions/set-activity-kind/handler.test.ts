import { describe, expect, it } from "vitest"

import { handler, toResult } from "./handler"

/**
 * `0244`, criterion 1's other half: the user is `identity.sub` and must be the owner. The refusal
 * happens before any env var is read or any client called, so no AWS is needed to prove it.
 */
describe("setActivityKind refuses before touching anything", () => {
  it("refuses an event with no identity", async () => {
    await expect(handler({ arguments: { activityId: "a", kind: "walk" }, identity: null })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
  })

  it("refuses a signed-in user who is not the owner", async () => {
    await expect(handler({ arguments: { activityId: "a", kind: "walk" }, identity: { sub: "not-on-the-allowlist" } })).rejects.toThrow(
      /^REFUSED:NOT_OWNER/,
    )
  })
})

describe("toResult — the rescore result in the SDL's shape", () => {
  it("lists what each skill gained and what was retained", () => {
    const r = toResult({
      outcome: "applied",
      activityId: "a",
      from: "walk",
      to: "run",
      derivedKind: "walk",
      key: "raw/k",
      cellsRevealed: 0,
      xp: { gained: { athletics: 40 }, floors: { wayfaring: 12 }, rowsDeleted: 1, rowsWritten: 2 },
      message: "m",
    })
    expect(r).toMatchObject({ kind: "run", from: "walk", derivedKind: "walk", gained: [{ skillId: "athletics", xp: 40 }], retained: [{ skillId: "wayfaring", xp: 12 }] })
  })

  it("reports no XP as two empty lists, not as null", () => {
    const r = toResult({ outcome: "applied", activityId: "a", from: "walk", to: "run", derivedKind: "walk", key: "k", cellsRevealed: 0, xp: null, message: "m" })
    expect(r.gained).toEqual([])
    expect(r.retained).toEqual([])
  })

  it("passes an unchanged outcome through", () => {
    expect(toResult({ outcome: "unchanged", activityId: "a", kind: "run", message: "already run" })).toMatchObject({ outcome: "unchanged", kind: "run", from: null })
  })
})
