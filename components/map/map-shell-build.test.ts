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
