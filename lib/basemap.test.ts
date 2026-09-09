import { layers, namedFlavor } from "@protomaps/basemaps"
import { describe, expect, it, vi } from "vitest"

/**
 * `@/amplify_outputs.json` is gitignored and generated per environment, so its content
 * at test time is whatever happens to be on disk — the deployed file locally, the
 * example file in CI. Stubbed here so these assertions test the style and not the
 * machine they run on. `basemap.ts`'s own missing-key failure is asserted separately.
 */
vi.mock("@/amplify_outputs.json", () => ({
  default: { custom: { basemapTilesUrl: "https://dexample123.cloudfront.net" } },
}))

const { BASEMAP_ARCHIVE, basemapArchiveUrl, basemapStyle } = await import("./basemap")

describe("basemap style (0052)", () => {
  /**
   * THE CRITERION THIS FILE EXISTS FOR: "The style is stock @protomaps/basemaps
   * light, pinned to an exact version, with ZERO local colour overrides — a diff
   * against the published style is empty."
   *
   * Asserted by recomputing the published layers from the package and comparing the
   * whole array. A single re-tinted road casing fails this, which is the point:
   * D-051 says legibility beats atmosphere, and 09-roadmap.md §2.3 puts the parchment
   * fork in capability 15, AFTER the milestone. An override landing here early is a
   * schedule decision made by accident.
   */
  it("is byte-identical to the published light flavour", () => {
    expect(basemapStyle().layers).toStrictEqual(
      layers("protomaps", namedFlavor("light"), { lang: "en" }),
    )
  })

  it("carries a non-trivial number of layers — an empty style would also 'match'", () => {
    expect(basemapStyle().layers.length).toBeGreaterThan(50)
  })

  it("credits both Protomaps and OpenStreetMap", () => {
    const attribution = basemapStyle().sources.protomaps.attribution
    expect(attribution).toContain("Protomaps")
    expect(attribution).toContain("OpenStreetMap")
  })

  it("resolves tiles through the pmtiles protocol against the distribution", () => {
    expect(basemapArchiveUrl()).toBe(
      `pmtiles://https://dexample123.cloudfront.net/${BASEMAP_ARCHIVE}`,
    )
    expect(basemapStyle().sources.protomaps.url).toBe(basemapArchiveUrl())
  })

  /**
   * D-226's cost argument holds only while tiles come from the distribution. A URL
   * pointing at the Amplify origin would bill egress at $0.15/GB and is the exact
   * regression 08 §Risk 1 forbids.
   */
  it("never points at Amplify Hosting or an S3 endpoint", () => {
    const url = basemapStyle().sources.protomaps.url
    expect(url).not.toContain("amplifyapp.com")
    expect(url).not.toContain("s3.amazonaws.com")
    expect(url).not.toContain("devaultsecurity.com")
  })
})
