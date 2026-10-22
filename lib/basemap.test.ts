import { existsSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { basemapLayers } from "./basemap-style"
import { thirdPartyRequestHosts } from "./style-requests"

/**
 * `@/amplify_outputs.json` is gitignored and generated per environment, so its content
 * at test time is whatever happens to be on disk — the deployed file locally, the
 * example file in CI. Stubbed here so these assertions test the style and not the
 * machine they run on. `basemap.ts`'s own missing-key failure is asserted separately.
 */
vi.mock("@/amplify_outputs.json", () => ({
  default: { custom: { basemapTilesUrl: "https://dexample123.cloudfront.net" } },
}))

const { BASEMAP_ARCHIVE, BASEMAP_ASSETS_PATH, BASEMAP_SOURCE, basemapArchiveUrl, basemapStyle: styleFor, registerPmtilesProtocol } =
  await import("./basemap")

const basemapStyle = (variant: "atlas" | "adventure" = "adventure") => styleFor(variant)

describe("pmtiles protocol registration (0052)", () => {
  /**
   * TESTED AGAINST A FAKE, because the real `maplibre-gl` is ticket 0053's dependency
   * and is deliberately not installed here — see `registerPmtilesProtocol`'s comment.
   * What this can prove is the half that lives in 0052: the scheme string matches the
   * `pmtiles://` URLs the style emits, and a handler is actually passed. 0053 wires
   * the same function to a real map, which is where a wrong scheme would show up as a
   * blank canvas.
   */
  it("registers a handler under the same scheme the style URLs use", () => {
    const registered: Array<[string, unknown]> = []
    registerPmtilesProtocol({
      addProtocol: (name, handler) => registered.push([name, handler]),
    })

    expect(registered).toHaveLength(1)
    const [scheme, handler] = registered[0]
    expect(scheme).toBe("pmtiles")
    expect(typeof handler).toBe("function")
    expect(basemapArchiveUrl().startsWith(`${scheme}://`)).toBe(true)
  })
})

describe("basemap style (0052, forked by 0097)", () => {
  /**
   * 0052's criterion was "a diff against the published style is empty". 0097 is the fork that
   * criterion was holding the place for, so what is asserted now is that `basemapStyle` binds
   * the fork — `lib/basemap-style.ts`, tested in `basemap-style.test.ts` — and nothing else.
   */
  it("is the two-variant fork, in the variant asked for", () => {
    for (const variant of ["atlas", "adventure"] as const) {
      expect(basemapStyle(variant).layers).toStrictEqual(
        basemapLayers(BASEMAP_SOURCE, variant),
      )
    }
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

describe("the basemap's glyphs and sprite are first-party (0293, 06 §9.5)", () => {
  const APP = "https://soles.example"
  const TILES = "https://dexample123.cloudfront.net"

  /**
   * THE BUILT STYLE, AS THE BROWSER WOULD REQUEST IT: every glyph, sprite and tile URL resolves to
   * the app's own origin or the tiles distribution (D-226), and nothing else. `styleRequestUrls`
   * reads the request-bearing fields only, so the attribution's `<a href>` credits — links, never
   * fetched — are not mistaken for requests. `0113` widens this allowlist check to the whole app.
   */
  it.each(["atlas", "adventure"] as const)("%s names no third-party host", (variant) => {
    const style = styleFor(variant, APP)
    expect(thirdPartyRequestHosts(style, [APP, TILES])).toEqual([])
    expect(JSON.stringify(style)).not.toContain("protomaps.github.io")
  })

  it("serves them from the app origin, at the path the middleware exempts", () => {
    const style = styleFor("adventure", APP)
    expect(style.glyphs).toBe(`${APP}${BASEMAP_ASSETS_PATH}/fonts/{fontstack}/{range}.pbf`)
    expect(style.sprite).toBe(`${APP}${BASEMAP_ASSETS_PATH}/sprites/v4/light`)
  })

  it("is root-relative, never a foreign host, with no page origin (node, file://)", () => {
    expect(styleFor("atlas").glyphs.startsWith(`${BASEMAP_ASSETS_PATH}/`)).toBe(true)
    expect(styleFor("atlas", "null").sprite).toBe(`${BASEMAP_ASSETS_PATH}/sprites/v4/light`)
  })

  /** The check has teeth: the pre-0293 style, and each other request field, would fail it. */
  it("flags a third-party glyph, sprite or tile host", () => {
    expect(
      thirdPartyRequestHosts(
        {
          glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
          sprite: [{ id: "x", url: "https://sprites.example/x" }],
          sources: {
            a: { url: "pmtiles://https://tiles.example/a.pmtiles", attribution: '<a href="https://osm.example">c</a>' },
            b: { tiles: ["//cdn.example/{z}/{x}/{y}.pbf"] },
          },
        },
        [APP, TILES],
      ).sort(),
    ).toEqual(["cdn.example", "protomaps.github.io", "sprites.example", "tiles.example"])
  })

  /**
   * EVERY FILE THE STYLE CAN ASK FOR EXISTS ON DISK: each font stack any layer names (every literal
   * in `text-font`, expressions included) has all 256 glyph ranges, and the sprite has 1x and 2x
   * sheets. An upstream upgrade that adds a stack fails here, not as a missing label in production.
   */
  it("ships every font stack and sprite sheet the style references", () => {
    const stacks = new Set<string>()
    const walk = (v: unknown): void => {
      if (typeof v === "string" && v.startsWith("Noto ")) stacks.add(v)
      else if (Array.isArray(v)) v.forEach(walk)
    }
    for (const variant of ["atlas", "adventure"] as const) {
      for (const l of styleFor(variant, APP).layers as Array<{ layout?: Record<string, unknown> }>) {
        walk(l.layout?.["text-font"])
      }
    }
    expect([...stacks].sort()).toEqual(["Noto Sans Italic", "Noto Sans Medium", "Noto Sans Regular"])
    const root = join(process.cwd(), "public", BASEMAP_ASSETS_PATH)
    for (const stack of stacks) {
      for (let r = 0; r < 256; r++) {
        expect(existsSync(join(root, "fonts", stack, `${r * 256}-${r * 256 + 255}.pbf`))).toBe(true)
      }
    }
    for (const f of ["light.json", "light.png", "light@2x.json", "light@2x.png"]) {
      expect(existsSync(join(root, "sprites", "v4", f))).toBe(true)
    }
  })
})
