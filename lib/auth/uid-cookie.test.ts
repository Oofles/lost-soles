import { describe, expect, it } from "vitest"

import { currentUid } from "@/lib/log/transport"

import { UID_COOKIE, UID_COOKIE_OPTIONS, uidFromCookieHeader } from "./uid-cookie"

/** Ticket 0332, D-476. The browser's uid, from `document.cookie`, with no network. */

const UID = "5488e4b8-d081-7014-748e-edd1937f8083"

describe("uidFromCookieHeader", () => {
  it("finds ls-uid among other cookies", () => {
    expect(uidFromCookieHeader(`a=1; ${UID_COOKIE}=${UID}; b=2`)).toBe(UID)
    expect(uidFromCookieHeader(`${UID_COOKIE}=${UID}`)).toBe(UID)
  })

  it("is undefined when absent, empty, or only a lookalike name", () => {
    expect(uidFromCookieHeader(undefined)).toBeUndefined()
    expect(uidFromCookieHeader("")).toBeUndefined()
    expect(uidFromCookieHeader(`${UID_COOKIE}=`)).toBeUndefined()
    expect(uidFromCookieHeader(`x${UID_COOKIE}=${UID}; ${UID_COOKIE}x=${UID}`)).toBeUndefined()
  })

  it("is undefined on a malformed percent-encoding rather than throwing", () => {
    expect(uidFromCookieHeader(`${UID_COOKIE}=%E0%A4%A`)).toBeUndefined()
  })
})

describe("the cookie's attributes", () => {
  it("is readable by script, Secure, Lax, Path=/, host-only, and lives as long as the session", () => {
    expect(UID_COOKIE_OPTIONS).toEqual({ httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 2_592_000 })
    expect(UID_COOKIE_OPTIONS).not.toHaveProperty("domain")
  })
})

describe("currentUid() (lib/log/transport.ts)", () => {
  it("reads the cookie, with no network", async () => {
    await expect(currentUid(() => `${UID_COOKIE}=${UID}`)).resolves.toBe(UID)
  })

  it("is undefined signed out, and outside a browser", async () => {
    await expect(currentUid(() => "authjs.csrf-token=x")).resolves.toBeUndefined()
    await expect(currentUid()).resolves.toBeUndefined()
  })
})
