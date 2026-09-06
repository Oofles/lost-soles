import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { computeActivityId } from "./activity-id"

/**
 * Ticket 0025. Determinism is not an implementation detail here — it is the entire
 * reason `activityId` is a hash rather than a ULID (contract §2, conflict #6). If this
 * ever stops holding, every webhook retry duplicates an activity on a map that cannot
 * re-fog.
 */
describe("computeActivityId", () => {
  // Deliberately NOT the MVP source. The domain's own tests have no business naming a
  // vendor — check-boundaries.mjs caught exactly that here, and the right response was to
  // change the test rather than narrow the check a fourth time (D-167's stated trigger).
  // The source value is arbitrary to what these tests assert.
  const args = ["user-1", "gpslogger", "1234567890123456789"] as const

  it("is stable across calls", () => {
    expect(computeActivityId(...args)).toBe(computeActivityId(...args))
  })

  it("matches the formula the contract states, not merely itself", () => {
    // Asserting only self-consistency would pass even if the formula changed. This
    // pins it to sha256(`userId:source:externalId`) as written in contract §2.
    const expected = createHash("sha256")
      .update("user-1:gpslogger:1234567890123456789")
      .digest("hex")
    expect(computeActivityId(...args)).toBe(expected)
  })

  it.each([
    ["userId", ["user-2", "gpslogger", "1234567890123456789"]],
    ["source", ["user-1", "manual", "1234567890123456789"]],
    ["externalId", ["user-1", "gpslogger", "1234567890123456780"]],
  ])("changing the %s changes the id", (_field, changed) => {
    expect(computeActivityId(...(changed as [string, string, string]))).not.toBe(
      computeActivityId(...args),
    )
  })

  it("cannot be confused by field boundaries", () => {
    // Without a separator, ("ab","c") and ("a","bc") would hash identically. Vendor
    // ids are opaque strings, so this is a real collision surface, not a curiosity.
    expect(computeActivityId("ab", "c" as never, "x")).not.toBe(
      computeActivityId("a", "bc" as never, "x"),
    )
  })

  /**
   * ACROSS PROCESSES AND ACROSS RUNS (ticket 0040 criterion 1, I-5) — which is a
   * stronger claim than the two tests above make. Both of them recompute the answer in
   * THIS process with THIS crypto; they would stay green if the formula changed under
   * them, so long as it changed consistently.
   *
   * A literal checked into the file is the only form of the assertion that cannot do
   * that. This digest was produced by a separate `node` invocation, and it is what the
   * receipt table's rows are keyed on for ninety days at a time — an id that shifted
   * between deploys would silently split one activity into two, permanently, on a map
   * that cannot re-fog (D-020).
   */
  it("matches a digest computed by a different process entirely", () => {
    expect(computeActivityId(...args)).toBe(
      "97a32673eaf4d824c630e1fcf8a4bc17cc49795b06a2f6b7f1ea6488a1890c8c",
    )
  })

  it("returns a full 64-character hex sha256", () => {
    expect(computeActivityId(...args)).toMatch(/^[0-9a-f]{64}$/)
  })
})
