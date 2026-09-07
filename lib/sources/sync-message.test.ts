import { describe, expect, it } from "vitest"

import type { SourceSyncOutcome } from "./sync"
import { syncResultLine } from "./sync-message"

/**
 * Ticket 0043 criterion 6. Every branch here is a claim about what happened to the
 * operator's data, made to the one person who can act on it — so the mapping is tested
 * rather than eyeballed. "Nothing new" over a silently failed enqueue is a lie that costs
 * a run on a map that cannot re-fog.
 */

const NAME = () => "Example Source"

const line = (...outcomes: SourceSyncOutcome[]) => syncResultLine(outcomes, NAME)

describe("what the button says", () => {
  it("counts what it queued", () => {
    expect(line({ sourceId: "s", kind: "queued", queued: 3, alreadyKnown: 0 })).toBe(
      "3 activities queued.",
    )
  })

  /** One is not "1 activities". A result line that cannot count reads as broken. */
  it("uses the singular for one", () => {
    expect(line({ sourceId: "s", kind: "queued", queued: 1, alreadyKnown: 4 })).toBe(
      "1 activity queued.",
    )
  })

  /**
   * THE SECOND PRESS. Activities were listed and every one was already in the ledger, so
   * nothing was queued — which reads identically to an empty window and should. What must
   * NOT happen is a count of zero rendered as "0 activities queued", which looks like a
   * failure and is not one.
   */
  it("reads as nothing new when everything listed was already known", () => {
    expect(line({ sourceId: "s", kind: "queued", queued: 0, alreadyKnown: 3 })).toBe(
      "Nothing new.",
    )
  })

  it("says nothing new for an empty window", () => {
    expect(line({ sourceId: "s", kind: "nothing-new" })).toBe("Nothing new.")
  })

  /**
   * Criterion 7's two cases, and they are DIFFERENT sentences on purpose: one asks for a
   * connection that never existed, the other says something the operator already set up
   * has broken and names where to fix it.
   */
  it("points a dead credential at the place that repairs it", () => {
    expect(line({ sourceId: "s", kind: "reconnect" })).toBe(
      "Reconnect Example Source in Settings.",
    )
  })

  it("distinguishes never-connected from broken", () => {
    expect(line({ sourceId: "s", kind: "not-connected" })).toBe("Example Source is not connected.")
  })

  /**
   * THE PARTIAL SWEEP. Four landed and then the provider stopped. Reporting only the
   * failure would make pressing again look pointless when it is exactly right — the
   * watermark has been pinned below the one that failed.
   */
  it("names the work that did land before it broke", () => {
    expect(line({ sourceId: "s", kind: "failed", queued: 4, detail: "Error" })).toBe(
      "4 queued, then Example Source stopped responding. Try again.",
    )
  })

  it("does not claim progress that did not happen", () => {
    expect(line({ sourceId: "s", kind: "failed", queued: 0, detail: "Error" })).toBe(
      "Could not reach Example Source. Try again.",
    )
  })

  /** No source registered at all — a state the app can reach before the first connect. */
  it("says something rather than nothing when there are no sources", () => {
    expect(line()).toBe("No sources are connected.")
  })

  /**
   * Two sources is not reachable today and the function is written for it anyway, because
   * the alternative is a `[0]` that silently drops the second source's result on the day
   * D-112 or D-113 adds one.
   */
  it("joins every source's answer", () => {
    expect(
      line(
        { sourceId: "a", kind: "queued", queued: 2, alreadyKnown: 0 },
        { sourceId: "b", kind: "reconnect" },
      ),
    ).toBe("2 activities queued. Reconnect Example Source in Settings.")
  })

  /** The detail string never reaches the page — it exists for a log line, not a reader. */
  it("never renders the failure detail", () => {
    expect(line({ sourceId: "s", kind: "failed", queued: 0, detail: "TokenExchangeError" })).not.toContain(
      "TokenExchangeError",
    )
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0044, CRITERION 4 — OUTSTANDING FAILURES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `09-roadmap.md` §2.3 admits the milestone shipped with "no error surface — the user
 * finds out because the map did not change". This is the sentence that ends that, and
 * the thing to keep straight is that it describes A DIFFERENT PRESS: the outcomes above
 * are this sweep, the count below is activities that were queued earlier and that the
 * worker could not import.
 */
describe("outstanding failures", () => {
  const name = () => "Strava"

  it("says nothing when nothing is outstanding", () => {
    expect(syncResultLine([{ sourceId: "s", kind: "nothing-new" }], name, 0)).toBe("Nothing new.")
  })

  /** Defaulted, so every existing caller and test reads unchanged. */
  it("says nothing when the count is not supplied at all", () => {
    expect(syncResultLine([{ sourceId: "s", kind: "nothing-new" }], name)).toBe("Nothing new.")
  })

  /**
   * THE CASE THE TICKET IS ABOUT. A sweep that finds nothing new while an earlier import
   * is broken used to render as "Nothing new." — a true sentence that hides the reason
   * the map is missing a run.
   */
  it("appends the failure to a sweep that found nothing", () => {
    expect(syncResultLine([{ sourceId: "s", kind: "nothing-new" }], name, 1)).toBe(
      "Nothing new. 1 activity failed to import.",
    )
  })

  /**
   * THE TWO SENTENCES ARE NOT MERGED. A press that queued three activities did real
   * work, and collapsing it into the failure would make a successful sweep read as a
   * broken one whenever anything old was still outstanding.
   */
  it("keeps a successful sweep and an old failure as separate sentences", () => {
    expect(
      syncResultLine([{ sourceId: "s", kind: "queued", queued: 3, alreadyKnown: 0 }], name, 2),
    ).toBe("3 activities queued. 2 activities failed to import.")
  })

  /**
   * CRITERION 5. A revoked authorization keeps its own distinct sentence — the one that
   * names the action a human can take — and the failure count sits beside it rather than
   * replacing it. "Reconnect" and "something failed" are different facts.
   */
  it("leaves the reconnect sentence intact beside a failure", () => {
    expect(syncResultLine([{ sourceId: "s", kind: "reconnect" }], name, 1)).toBe(
      "Reconnect Strava in Settings. 1 activity failed to import.",
    )
  })

  /**
   * A CONNECTION REMOVED AFTER AN IMPORT BROKE. "No sources are connected" alone would
   * be true and would hide the reason the map is missing a run.
   */
  it("reports a failure even with no sources connected", () => {
    expect(syncResultLine([], name, 1)).toBe(
      "No sources are connected. 1 activity failed to import.",
    )
  })

  it("uses the singular for exactly one", () => {
    expect(syncResultLine([], name, 1)).toContain("1 activity failed")
    expect(syncResultLine([], name, 4)).toContain("4 activities failed")
  })
})
