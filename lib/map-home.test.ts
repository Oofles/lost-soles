import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE ASSERTION THAT MATTERS HERE IS THE SIGNED-OUT ONE.
 *
 * `/` is the signed-out landing route — middleware.ts sends every other route to it and
 * the Authenticator renders sign-in in its place — so whatever this function returns for
 * an unauthenticated request is fetchable by anyone who finds the site. The operator's
 * home coordinate is the kind of thing 08 §7.2 and D-199 exist to keep out of public
 * artefacts, and "it's only the map default" is exactly the reasoning §7.2 predicts will
 * break the rule.
 */
vi.mock("next/headers", () => ({ cookies: () => ({}) }))

const authenticated = vi.fn<() => boolean>()
vi.mock("@/lib/amplify-server", () => ({
  runWithAmplifyServerContext: async () => authenticated(),
}))

const { homeCameraForSession } = await import("./map-home")

const ENV = { ...process.env }

beforeEach(() => {
  authenticated.mockReturnValue(true)
  process.env.LOST_SOLES_HOME_LAT = "30.0805"
  process.env.LOST_SOLES_HOME_LNG = "-81.4046"
  delete process.env.LOST_SOLES_HOME_ZOOM
})

afterEach(() => {
  process.env = { ...ENV }
  vi.clearAllMocks()
})

describe("the configured home camera (0053)", () => {
  it("is withheld entirely from a signed-out request", async () => {
    authenticated.mockReturnValue(false)
    await expect(homeCameraForSession()).resolves.toBeNull()
  })

  it("is returned to a signed-in request, at neighbourhood zoom", async () => {
    const home = await homeCameraForSession()
    expect(home).toStrictEqual({ lat: 30.0805, lng: -81.4046, zoom: 14, bearing: 0 })
  })

  it("honours a configured zoom", async () => {
    process.env.LOST_SOLES_HOME_ZOOM = "16"
    expect((await homeCameraForSession())?.zoom).toBe(16)
  })

  it("ignores an out-of-range configured zoom rather than passing it to MapLibre", async () => {
    process.env.LOST_SOLES_HOME_ZOOM = "99"
    expect((await homeCameraForSession())?.zoom).toBe(14)
  })

  /**
   * An unset or malformed variable must yield null, not a coordinate off the coast of
   * Africa. `Number(undefined)` is NaN and `Number("")` is 0 — the second is the
   * dangerous one, because 0,0 is a valid-looking camera.
   */
  it.each([
    ["unset", undefined, undefined],
    ["empty strings", "", ""],
    ["not numbers", "north", "west"],
    ["past the pole", "91", "-81.4"],
    ["past the antimeridian", "30", "181"],
  ])("returns null when the variables are %s", async (_label, lat, lng) => {
    if (lat === undefined) delete process.env.LOST_SOLES_HOME_LAT
    else process.env.LOST_SOLES_HOME_LAT = lat
    if (lng === undefined) delete process.env.LOST_SOLES_HOME_LNG
    else process.env.LOST_SOLES_HOME_LNG = lng

    await expect(homeCameraForSession()).resolves.toBeNull()
  })
})
