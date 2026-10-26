import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

// @ts-expect-error — a plain .mjs build script, untyped on purpose (it runs in the Amplify container).
import { parseTokens, resolve } from "@/scripts/check-contrast.mjs"

/**
 * TICKET `0112` — D-148 ACROSS THE WHOLE APP, at the source.
 *
 * *"Gold appears only as fill or rule, or as type at ≥24sp or on navy; all floating chrome is
 * opaque."* `app/skills/contrast.test.tsx` holds this for `/skills` by rendering it, and
 * `plinth.test.tsx` for `/`. This holds it for every other file, by reading the source: every place
 * a gold token is used as a `color`, every gold fill that carries type, and every fixed element's
 * background. A new use fails here until it is either fixed or listed below with its reason.
 *
 * The rendered check — does it READ on the page — is the operator's (D-229).
 */

const ROOT = join(import.meta.dirname, "..")
const DIRS = ["app", "components"]
/** Debug readouts behind `?fog=` flags: never on screen in ordinary use, and not chrome (05 §6.3). */
const DEBUG = new Set(["components/map/perf-overlay.tsx", "components/map/mask-hud.tsx", "components/map/reveal-scrub.tsx"])

function sources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const file = relative(ROOT, path)
        if (!DEBUG.has(file)) out.push({ file, src: readFileSync(path, "utf8") })
      }
    }
  }
  for (const d of DIRS) walk(join(ROOT, d))
  return out
}

const GOLD = "accent|accent-text|gold-\\d+|progress-activity"
/** A gold token as the `color` of something — JSX style or a CSS string — never `border-color` etc. */
const GOLD_COLOR = new RegExp(`(?<![-\\w])color: ?"?var\\(--(${GOLD})\\)`, "g")

/**
 * The gold `color`s that are not type, each with its reason. Anything else is gold text.
 * Keyed `file: the matched line, trimmed`.
 */
const GOLD_MARKS: Record<string, string> = {
  // The crest beside TOTAL LEVEL: an SVG stroke in `currentColor`, measured as a graphic in
  // `check-contrast.mjs` (D-148 rule 1, `0077`).
  'app/skills/skills-panel.tsx: <span style={{ color: "var(--accent-text)", display: "inline-flex" }}>': "crest graphic",
  // `L41 ↑`: the arrow is `--progress-activity` by design (06 §3.3), aria-hidden, a mark beside ink type.
  'app/run/[activityId]/run-ledger.tsx: <span aria-hidden="true" style={{ color: "var(--progress-activity)", opacity: s.levelUp && p >= 1 ? 1 : 0 }}>↑</span>':
    "level-gained arrow glyph",
}

describe("D-148 across the app (0112)", () => {
  const files = sources()

  it("reads a real tree", () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it("no gold token colours type anywhere — only the listed marks, each a graphic", () => {
    const found: string[] = []
    for (const { file, src } of files) {
      for (const line of src.split("\n")) {
        if (GOLD_COLOR.test(line)) found.push(`${file}: ${line.trim()}`)
        GOLD_COLOR.lastIndex = 0
      }
    }
    expect(found.sort()).toEqual(Object.keys(GOLD_MARKS).sort())
  })

  it("type on a gold fill is ink in both themes, never a token that turns to parchment in dark", () => {
    // A gold background with a `color` beside it, in one rule or one style object.
    const fill = new RegExp(`background: ?"?var\\(--(${GOLD})\\)"?[,;]\\s*color: ?"?var\\(--([\\w-]+)\\)`, "g")
    const found: string[] = []
    for (const { file, src } of files) for (const m of src.matchAll(fill)) found.push(`${file}: --${m[2]}`)
    expect(found.length).toBeGreaterThan(0) // the mode toggle's selected row and the level-up sigil
    for (const f of found) expect(f, f).toMatch(/: --ink-900$/)
  })

  it("every fixed element has an opaque token background, or is light rather than chrome", () => {
    const css = readFileSync(join(ROOT, "app/tokens.css"), "utf8")
    const themes = parseTokens(css) as Record<string, Record<string, string>>
    /** Fixed, and deliberately not chrome — each with its reason. */
    const NOT_CHROME: Record<string, string> = {
      "components/level-up-card.tsx": "the card's --scrim layer (06 §3.2 beat 3); the card on it is --surface",
      "app/run/[activityId]/run-sequence.tsx#cell-pulse": "the earning cell's pulse: light on the map, pointer-events none",
      "app/skills/skill-sheet.tsx": "the sheet's --scrim; the dialog on it is --surface-raised",
      // Positioning wrappers with no surface of their own: every control inside is --surface-raised,
      // which `plinth.test.tsx` and this file's own pass over `.map-control` / `.region-jump-button` hold.
      "components/map/map-controls.tsx": "the .map-controls column wrapper",
      "components/map/region-jump-control.tsx": "the .region-jump wrapper",
    }
    const bad: string[] = []
    for (const { file, src } of files) {
      const at = [...src.matchAll(/position: ?"?fixed/g)].map((m) => m.index)
      for (const i of at) {
        // The rule or style object the declaration sits in: up to its closing brace.
        const end = src.indexOf("}", i)
        const start = Math.max(src.lastIndexOf("{", i), 0)
        const body = src.slice(start, end)
        const bg = /background: ?"?var\((--[\w-]+)\)"?/.exec(body)?.[1]
        const key = /data-testid="cell-pulse"/.test(src.slice(Math.max(0, i - 400), i)) ? `${file}#cell-pulse` : file
        if (bg && /--scrim/.test(bg) && NOT_CHROME[key]) continue
        if (!bg) {
          if (NOT_CHROME[key]) continue
          bad.push(`${key}: no token background`)
          continue
        }
        for (const [theme, t] of Object.entries(themes)) {
          if (resolve(t, bg)[3] !== 1) bad.push(`${key}: ${bg} is translucent in ${theme}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it("the wrappers' controls are themselves opaque", () => {
    const src = (f: string) => files.find((x) => x.file === f)!.src
    for (const [file, rule] of [
      ["components/map/map-controls.tsx", ".map-control {"],
      ["components/map/region-jump-control.tsx", ".region-jump-button {"],
      ["components/map/region-jump-control.tsx", ".region-jump-list {"],
    ] as const) {
      const s = src(file)
      const body = s.slice(s.indexOf(rule), s.indexOf("}", s.indexOf(rule)))
      expect(body, `${file} ${rule}`).toContain("background: var(--surface-raised)")
    }
  })
})
