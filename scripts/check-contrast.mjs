#!/usr/bin/env node
// Every text pair on the skills panel clears WCAG contrast (D-148, ticket 0077).
//
// 06-ui-ux.md §8.3 MEASURES its pairs in a table. A table is correct on the day it is written and
// silent the day a token is retuned; this computes the same numbers FROM app/tokens.css, in both
// themes, on every build, and fails on any shortfall.
//
// The pairs are DECLARED below, not discovered. A declaration is a claim — "this screen puts
// --text-muted on --surface" — and the component test in app/skills/contrast.test.tsx holds the
// other half: that the screens use no colour token outside the declared set and no gold below
// 24sp. Between them, a new pair cannot ship unmeasured.
//
// THE BACKGROUND IS THE FLAT TOKEN. 0077's criterion asks for the parchment texture's darkest and
// lightest sampled points; no texture is rendered (every surface is a flat `var(--…)` fill), so
// the flat token IS the rendered background. When a texture lands, its sampled extremes join
// BACKGROUNDS here as their own entries.
//
// Plain node, no dependencies — it runs in both the GitHub gate and the Amplify container (D-163).
//
//   node scripts/check-contrast.mjs              check
//   node scripts/check-contrast.mjs --self-test  prove it FIRES on a failing pair

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** WCAG 2.x thresholds. Large = ≥24px, or ≥18.66px bold. Non-text graphics = 3:1 (SC 1.4.11). */
export const AA_TEXT = 4.5
export const AA_LARGE = 3
export const AA_GRAPHIC = 3

/** Where each surface is used on `/skills` and `/skills/:skillId`. */
const BACKGROUNDS = {
  bg: "--bg", // the page, the pinned header, section headings
  surface: "--surface", // tiles, the Total Level card, the NEXT card
  raised: "--surface-raised", // the detail sheet
}

/**
 * The pairs the two screens actually draw. `kind` picks the threshold. Gold text appears in none
 * of them: D-148 rule 1, and the component test enforces it at the source.
 */
export const PAIRS = [
  ...["--text-primary", "--text-secondary", "--text-muted"].flatMap((fg) =>
    Object.entries(BACKGROUNDS).map(([where, bg]) => ({ fg, bg, kind: "text", where })),
  ),
  // Bar fills carry meaning (activity vs meta, §5.3 rule 5) — non-text graphics against the tile.
  ...["--progress-activity", "--progress-meta"].flatMap((fg) =>
    [["surface", "--surface"], ["raised", "--surface-raised"]].map(([where, bg]) => ({ fg, bg, kind: "graphic", where })),
  ),
  // The crest beside TOTAL LEVEL: a stroked mark in --accent-text, a graphic (D-148 rule 1).
  { fg: "--accent-text", bg: "--surface", kind: "graphic", where: "surface" },
]

/** `{ light, dark }` maps of custom property → raw value, parsed from the token file. */
export function parseTokens(css) {
  const block = (re) => {
    const m = css.match(re)
    if (!m) throw new Error(`token block not found: ${re}`)
    return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]))
  }
  const light = block(/^:root\s*\{([\s\S]*?)^\}/m)
  // The manual override block is the same values as the media-query block; check both agree.
  const dark = { ...light, ...block(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m) }
  const media = { ...light, ...block(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)^\s*\}/m) }
  for (const k of Object.keys(dark)) {
    if (dark[k] !== media[k]) throw new Error(`dark theme blocks disagree on ${k}: ${dark[k]} vs ${media[k]}`)
  }
  return { light, dark }
}

/** Resolve a token through `var()` chains to `[r, g, b, a]`, components 0–255, alpha 0–1. */
export function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`var() cycle at ${name}`)
  seen.add(name)
  const v = tokens[name]
  if (v === undefined) throw new Error(`unknown token ${name}`)
  const ref = v.match(/^var\((--[\w-]+)\)$/)
  if (ref) return resolve(tokens, ref[1], seen)
  const hex = v.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1)
  const rgb = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]]
  throw new Error(`cannot resolve ${name}: ${v}`)
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio. A translucent foreground is composited over the background first. */
export function ratio(fg, bg) {
  if (bg[3] !== 1) throw new Error("a background must be opaque to be measured (D-148 rule 3)")
  const a = fg[3]
  const over = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
  const [hi, lo] = [luminance(over), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const threshold = (kind) => (kind === "text" ? AA_TEXT : kind === "large" ? AA_LARGE : AA_GRAPHIC)

/** Every declared pair in both themes, with its ratio and verdict. */
export function measure(css, pairs = PAIRS) {
  const themes = parseTokens(css)
  return Object.entries(themes).flatMap(([theme, tokens]) =>
    pairs.map((p) => {
      const r = ratio(resolve(tokens, p.fg), resolve(tokens, p.bg))
      return { theme, ...p, ratio: r, pass: r >= threshold(p.kind) }
    }),
  )
}

function main() {
  const css = readFileSync(`${ROOT}/app/tokens.css`, "utf8")

  if (process.argv.includes("--self-test")) {
    // --gold-500 as text on parchment is THE trap (2.1:1). If this passes, the check is decorative.
    const [r] = measure(css, [{ fg: "--gold-500", bg: "--parch-100", kind: "text", where: "self-test" }])
    if (r.pass) {
      console.error(`self-test FAILED: --gold-500 on --parch-100 measured ${r.ratio.toFixed(2)}:1 and passed`)
      process.exit(1)
    }
    console.log(`self-test ok: --gold-500 on --parch-100 = ${r.ratio.toFixed(2)}:1, rejected as text`)
    return
  }

  const rows = measure(css)
  for (const r of rows) {
    const line = `${r.pass ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${r.fg.padEnd(20)} on ${r.bg.padEnd(17)} ${r.ratio.toFixed(2).padStart(5)}:1  (${r.kind}, needs ${threshold(r.kind)}:1)`
    ;(r.pass ? console.log : console.error)(line)
  }
  const failed = rows.filter((r) => !r.pass)
  if (failed.length) {
    console.error(`\n${failed.length} pair(s) below WCAG AA — D-148, 06-ui-ux.md §8.3/§9.1`)
    process.exit(1)
  }
  console.log(`\n${rows.length} pairs, all at or above WCAG AA`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main()
