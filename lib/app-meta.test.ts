import { describe, expect, it } from "vitest"

import { APP_NAME, APP_TAGLINE } from "@/lib/app-meta"

describe("app metadata", () => {
  it("names the app", () => {
    expect(APP_NAME).toBe("Lost Soles")
  })

  it("states the D-020 promise, which is the whole product", () => {
    expect(APP_TAGLINE).toContain("only ever grows")
  })
})
