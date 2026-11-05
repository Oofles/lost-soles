import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Ticket `0278` — MapShell's build effect must not re-run for a value-equal `home`.
 *
 * The vitest environment is `node` (`vitest.config.ts`): no DOM, and effects do not run, so the
 * effect itself cannot be driven. Its dependency is derived by `cameraKey`, which
 * `lib/map-camera.test.ts` proves is equal for a new, value-equal `home` and different for a
 * changed one. What is left is that the effect is actually keyed on that derivation and not on the
 * object. A source assertion is a poor test and a good tripwire; `use-latest-run.test.ts` makes the
 * same trade for the same reason.
 */

const shell = readFileSync(new URL("./map-shell.tsx", import.meta.url), "utf8")

describe("MapShell's build effect (0278)", () => {
  /** The effect that constructs the Map: from the MapLibre construction to its dependency list. */
  const build = shell.slice(shell.indexOf("new lib.Map("))
  const deps = /\n {2}\}, \[([^\]]*)\]\)/.exec(build)

  it("is keyed on home's value, not the home object", () => {
    expect(shell.indexOf("new lib.Map(")).toBeGreaterThan(-1)
    expect(deps?.[1]).toBe("homeKey, framed")
    expect(shell).toContain("const homeKey = cameraKey(home)")
  })
})

/**
 * Ticket `0313` — the fog never waits on tiles (`06` §4.8). MapLibre's `load` waits for every visible
 * tile, so the fog (and everything that only needs the style) is handed the map on `style.load`.
 * `tools/fog-harness/run-tile-wait.mjs` proves on a real Map that `style.load` fires and the fog
 * composites while tiles hang and `load` never comes; this pins the wiring that harness relies on.
 * D-439's paint gate and the post-run `onStage` stay on `load`.
 */
describe("MapShell's two readiness signals (0313)", () => {
  it("hands the map over on style.load, and keeps load for its two consumers", () => {
    expect(shell).toContain('instance.once("style.load", () => setStyled(instance))')
    expect(shell).toContain('instance.once("load", () => setLoaded(instance))')
    expect(shell).toMatch(/const fogLayer = useFogMask\(styled,/)
    expect(shell).toMatch(/useLatestRun\(styled,/)
  })

  it("opens D-439's paint gate on load, not on style.load", () => {
    const gate = shell.slice(shell.indexOf("const markPainted = useMarkMapPainted()"))
    expect(gate.slice(0, gate.indexOf("}, ["))).toContain("if (!loaded) return")
    expect(gate).toMatch(/^[\s\S]*?\}, \[loaded, unsupported, markPainted\]\)/)
  })

  it("reports the post-run stage ready on load", () => {
    expect(shell).toContain('? { kind: "ready", map: loaded, layer: fogLayer }')
  })

  it("clears both on teardown", () => {
    expect(shell).toMatch(/function teardown\(\) \{\n\s+setStyled\(null\)\n\s+setLoaded\(null\)/)
  })
})
