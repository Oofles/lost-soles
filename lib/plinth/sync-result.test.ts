import { describe, expect, it } from "vitest"

import { plinthSyncResult } from "./sync-result"

/** Ticket `0087`, criteria 6–9: what a Sync press may say on `/`. */
describe("plinthSyncResult (0087)", () => {
  it("before any press, says nothing", () => {
    expect(plinthSyncResult(null)).toEqual({ line: null, reconnect: [] })
  })

  it("a sync that returns no new activities produces no message", () => {
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "nothing-new" }] }).line).toBeNull()
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "queued", queued: 0, alreadyKnown: 3 }] }).line).toBeNull()
  })

  it("a sync that fails for a non-auth reason produces no user-visible error", () => {
    const result = plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "failed", queued: 0, detail: "HTTP 503" }] })
    expect(result).toEqual({ line: null, reconnect: [] })
  })

  it("an old failed import is not a broken token either, and is not mentioned", () => {
    const result = plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "nothing-new" }], failedCount: 2 } as never)
    expect(result.line).toBeNull()
  })

  it("not connected says nothing here", () => {
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "not-connected" }] }).line).toBeNull()
  })

  it("queued activities are the one line, a partial sweep's included, with no failure attached", () => {
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "queued", queued: 1, alreadyKnown: 0 }] }).line).toBe("1 activity queued.")
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "failed", queued: 3, detail: "x" }] }).line).toBe("3 activities queued.")
  })

  it("a broken token is handed up as a source id, never as text in this line", () => {
    expect(plinthSyncResult({ outcomes: [{ sourceId: "s", kind: "reconnect" }] })).toEqual({ line: null, reconnect: ["s"] })
  })
})
