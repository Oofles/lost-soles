import { describe, expect, it } from "vitest"

import { callerOf } from "./caller"
import { handler as logWorkout } from "./log-workout/handler"
import { handler as setActivityKind } from "./set-activity-kind/handler"

/**
 * `0331`, D-472; `0334`, D-475. The mutation Lambdas take the user from a direct invoke's `userId`
 * and nowhere else. AppSync's old event shape is no longer understood, so it carries no user.
 */
describe("callerOf", () => {
  it("reads a direct invoke's userId, and the rest as the arguments", () => {
    expect(callerOf({ userId: "u-1", activityId: "a", kind: "run" })).toEqual({ userId: "u-1", args: { activityId: "a", kind: "run" } })
  })

  it("never believes AppSync's identity.sub (the AppSync branch was removed in 0334)", () => {
    expect(callerOf({ arguments: { kind: "run" }, identity: { sub: "5488e4b8-d081-7014-748e-edd1937f8083" } }).userId).toBeUndefined()
  })

  it("has no user for an empty, malformed or blank event", () => {
    for (const e of [undefined, null, "x", {}, { userId: "" }, { userId: 7 }]) expect(callerOf(e).userId).toBeUndefined()
  })
})

describe("both handlers refuse a direct invoke from a non-owner before touching anything", () => {
  it("log-workout", async () => {
    await expect(logWorkout({ userId: "not-on-the-allowlist", exerciseId: "pushup" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
    await expect(logWorkout({ exerciseId: "pushup" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
    // The owner's sub in AppSync's old shape is refused too: there is no AppSync caller (0334).
    await expect(
      logWorkout({ arguments: { exerciseId: "pushup" }, identity: { sub: "5488e4b8-d081-7014-748e-edd1937f8083" } }),
    ).rejects.toThrow(/^REFUSED:NOT_OWNER/)
  })

  it("set-activity-kind", async () => {
    await expect(setActivityKind({ userId: "not-on-the-allowlist", activityId: "a", kind: "run" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
    await expect(setActivityKind({ activityId: "a", kind: "run" })).rejects.toThrow(/^REFUSED:NOT_OWNER/)
  })
})
