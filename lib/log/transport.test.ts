import { describe, expect, it } from "vitest"

import { LogRefusedError } from "./queue"
import { errorFrom } from "./transport"

/**
 * The one decision the transport makes: is a GraphQL error a refusal (drop it) or a failure
 * (retry it)? The Lambda prefixes client-caused errors `REFUSED:<code>:` (0069); everything else
 * — a timeout, a 5xx, a cold start — must retry, because the queue's whole promise is that a
 * log is never lost to a bad moment.
 */
describe("errorFrom", () => {
  it("maps the Lambda's REFUSED prefix to a refusal with its code", () => {
    const e = errorFrom([{ message: "REFUSED:UNKNOWN_EXERCISE: no enabled skill logs exercise \"x\"" }])
    expect(e).toBeInstanceOf(LogRefusedError)
    expect((e as LogRefusedError).code).toBe("UNKNOWN_EXERCISE")
  })

  it("finds the refusal among several errors", () => {
    expect(errorFrom([{ message: "noise" }, { message: "REFUSED:NOT_OWNER:" }])).toBeInstanceOf(LogRefusedError)
  })

  it("treats everything else as retryable", () => {
    for (const message of ["Network error", "Lambda timed out", "Unauthorized", "refused: lowercase is not the prefix"]) {
      expect(errorFrom([{ message }])).not.toBeInstanceOf(LogRefusedError)
    }
    expect(errorFrom([{ errorType: "Lambda:Unhandled" }]).message).toContain("Lambda:Unhandled")
  })
})
