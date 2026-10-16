import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { OWNER_USER_IDS } from "@/lib/auth/owner-ids"

import { userIdForOwner } from "./owner-map"

/** Ticket 0091 — the static athlete → user map the public webhook resolves owners with. */
describe("userIdForOwner", () => {
  it("maps the operator's athlete to the operator's sub", () => {
    expect(userIdForOwner("51449053")).toBe("5488e4b8-d081-7014-748e-edd1937f8083")
  })

  it("answers undefined for a stranger, including prototype keys", () => {
    for (const id of ["1", "999999999", "constructor", "__proto__", "toString", ""]) {
      expect(userIdForOwner(id)).toBeUndefined()
    }
  })

  /**
   * EVERY MAPPED USER IS AN ALLOWLISTED OWNER. The two lists are maintained by hand and side by
   * side; a sub here that `OWNER_USER_IDS` does not know is a webhook enqueueing work for an
   * account the app itself would 404.
   */
  it("maps only to subs on the owner allowlist", () => {
    const source = readFileSync(join(import.meta.dirname, "owner-map.ts"), "utf8")
    const subs = [...source.matchAll(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g)].map(
      (m) => m[1],
    )
    expect(subs.length).toBeGreaterThan(0)
    for (const sub of subs) expect(OWNER_USER_IDS).toContain(sub)
  })

  it("imports nothing, so the cold-start webhook pays nothing to load it", () => {
    const source = readFileSync(join(import.meta.dirname, "owner-map.ts"), "utf8")
    expect(source).not.toMatch(/^import /m)
  })
})
