import { describe, expect, it } from "vitest"

import { callerOf } from "./caller"
import { handler as logWorkout } from "./log-workout/handler"
import { handler as setActivityKind } from "./set-activity-kind/handler"

/**
 * `0331`, D-472. The mutation Lambdas take the user from a direct invoke's `userId`, and from
 * AppSync's `identity.sub` until `0334`, never from a client argument.
 */
describe("callerOf", () => {
  it("reads a direct invoke's userId, and the rest as the arguments", () => {
    expect(callerOf({ userId: "u-1", activityId: "a", kind: "run" })).toEqual({ userId: "u-1", args: { activityId: "a", kind: "run" } })
  })

  it("reads AppSync's identity.sub, and ignores a userId the client put in the arguments", () => {
    expect(callerOf({ arguments: { kind: "run", userId: "u-other" }, identity: { sub: "u-1" } })).toEqual({
      userId: "u-1",
      args: { kind: "run", userId: "u-other" },
    })
  })

  /** An AppSync event is recognised by `arguments`, so a top-level userId beside it is not believed. */
  it("never mixes the two shapes", () => {
    expect(callerOf({ arguments: {}, identity: null, userId: "u-1" }).userId).toBeUndefined()
  })

  it("has no user for an empty, malformed or blank event", () => {
    for (const e of [undefined, null, "x", {}, { userId: "" }, { userId: 7 }]) expect(callerOf(e).userId).toBeUndefined()
  })
})

describe("both handlers refuse a direct invoke from a non-owner before touching anything", () => {
  it("log-workout", async () => {
    await expect(logWorkout({ userId: "not-on-the-allowlist", exerciseId: "pushup" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
    await expect(logWorkout({ exerciseId: "pushup" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
  })

  it("set-activity-kind", async () => {
    await expect(setActivityKind({ userId: "not-on-the-allowlist", activityId: "a", kind: "run" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
    await expect(setActivityKind({ activityId: "a", kind: "run" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
  })
})
