import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Ticket `0057` — the two claims about `useLatestRun` that can be proved without a browser.
 *
 * ─── WHY THIS FILE GREPS ────────────────────────────────────────────────────
 *
 * The vitest environment here is `node`, deliberately (`vitest.config.ts`): there is no DOM, no
 * `@testing-library/react`, and effects do not run under `renderToStaticMarkup`. So the hook
 * itself cannot be driven. Its two halves ARE tested where they live — `route-corridor.test.ts`,
 * `map-layers.test.ts` and `runs/client.test.ts` between them cover everything it composes.
 *
 * What is left over is one ordering invariant that lives in neither: `map-shell.tsx` must call
 * `useFogMask` BEFORE `useLatestRun`, because `setBucket` discards the optimistic corridor and
 * effects run in declaration order. Get it wrong and the corridor is wiped on the commit it was
 * set — intermittently, depending on what else re-rendered, which is the worst kind of bug to
 * find later. A source assertion is a poor test and a good tripwire; `no-per-frame-projection.
 * test.ts` is the precedent and makes the same trade for the same reason.
 */

const shell = readFileSync(new URL("./map-shell.tsx", import.meta.url), "utf8")
const hook = readFileSync(new URL("./use-latest-run.ts", import.meta.url), "utf8")

describe("hook order in map-shell (criterion 5's clearing rule)", () => {
  it("calls useFogMask before useLatestRun", () => {
    const fog = shell.indexOf("useFogMask(loaded)")
    const run = shell.indexOf("useLatestRun(")
    expect(fog).toBeGreaterThan(-1)
    expect(run).toBeGreaterThan(-1)
    expect(fog).toBeLessThan(run)
  })
})

describe("criterion 4 — the line does not wait for the cells", () => {
  /**
   * The route's geometry comes from `/api/runs/latest` and from nothing else. If it were ever
   * derived from the explored set — the obvious "we already have the cells" shortcut — a run
   * whose cells have not been written would draw no line, which is exactly the case §4.4 says
   * must still draw one.
   *
   * Asserted as an absence, because that is what the mistake would look like: a `set`, a `cells`
   * or a `packBucket` in the module that owns the line.
   */
  it("reads route geometry from the run endpoint, never from the explored set", () => {
    expect(hook).toContain("fetchLatestRun")
    expect(hook).not.toContain("packBucket")
    expect(hook).not.toMatch(/explored\.(set|cells)/)
  })

  /**
   * The generation IS read — it is the refetch trigger (§7.4) — and that is not the same thing
   * as deriving geometry from it. Stated so the assertion above cannot be "fixed" by removing
   * the trigger.
   */
  it("uses the explored generation only to decide when to re-ask", () => {
    expect(hook).toContain("useExplored()")
    expect(hook).toContain("[generation]")
  })
})
