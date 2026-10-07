import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { skillDetail, type DetailLedgerRow, type PlaceMilestone } from "@/lib/skills/detail"
import { nextLine } from "@/lib/skills/next"
import { skillsPanel } from "@/lib/skills/panel"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"
// @ts-expect-error — a plain .mjs build script, untyped on purpose (it runs in the Amplify container).
import { PAIRS, measure, parseTokens, resolve } from "@/scripts/check-contrast.mjs"

import { SkillSheet } from "./skill-sheet"
import { SkillsPanel } from "./skills-panel"

/**
 * Ticket 0077 — D-148 held at the source. `scripts/check-contrast.mjs` measures the token pairs;
 * this proves the two screens draw ONLY those pairs, put no gold on text below 24sp, and float no
 * translucent chrome. Whether it reads on the rendered page is the operator's (D-229).
 */

type Pair = { fg: string; bg: string; kind: string }
type Row = Pair & { theme: string; ratio: number; pass: boolean }

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
const activity = enabled.filter((s) => s.kind === "activity")
const meta = enabled.filter((s) => s.kind === "meta")
const NOW = Date.parse("2026-10-07T12:00:00Z")
const noop = () => {}

// Every section of the panel: trained activity, meta, NEXT and Untrained.
const untrained = activity[activity.length - 1]!
const model = skillsPanel(
  rules,
  enabled.filter((s) => s !== untrained).map((s, i) => ({ skillId: s.id, xp: cumulativeXp(8 + i) + 11 })),
)
const panel = renderToStaticMarkup(<SkillsPanel model={model} next={nextLine(rules, model.activity, { [activity[0]!.id]: [50] })} />)

// Every section of the sheet, ON THE MAP included — it ships empty (D-290), but its styles are checked now.
function sheet(skillId: string) {
  const rows: DetailLedgerRow[] = Array.from({ length: 12 }, (_, i) => {
    const startedAt = new Date(NOW - (1 + i * 2) * 86_400_000).toISOString()
    return { skillId, activityId: `a${i}`, reason: "distance", units: 5, xpAwarded: 500, xpRulesVersion: rules.version, isFloor: false, seq: `${startedAt}#a${i}#00` }
  })
  const places: PlaceMilestone[] = [{ level: 25, label: "Cairn at Level 25", lng: -1.5, lat: 53.8, zoom: 15 } as PlaceMilestone]
  const detail = skillDetail(rules, skillId, [{ skillId, xp: cumulativeXp(30) + 123 }], rows, places, NOW)
  return renderToStaticMarkup(<SkillSheet skillId={skillId} detail={detail} onDismiss={noop} onFly={noop} />)
}
const sheets = [activity[0]!, meta[0]!].map((s) => sheet(s.id))
const SCREENS = { "/skills": panel, ...Object.fromEntries(sheets.map((h, i) => [`/skills/${[activity[0]!, meta[0]!][i]!.id}`, h])) }

/** A styled element, with the text it OWNS (its own text plus its descendants'), from static markup. */
type El = { tag: string; style: Record<string, string>; attrs: string; text: string; fontPx: number; fg: string; bg: string }
/** A run of text with what it actually inherits: nearest colour, nearest background, computed size. */
type Run = { text: string; fg: string; bg: string; fontPx: number }

const token = (v: string | undefined) => /^var\((--[\w-]+)\)$/.exec(v ?? "")?.[1]
const REM = 16

function px(v: string | undefined): number | undefined {
  if (!v) return undefined
  const m = /^([\d.]+)(rem|px)$/.exec(v.trim())
  return m ? Number(m[1]) * (m[2] === "rem" ? REM : 1) : undefined
}

// `body` in app/tokens.css: --text-primary on --bg is what an unstyled run inherits.
const ROOT_EL: El = { tag: "body", style: {}, attrs: "", text: "", fontPx: 16, fg: "--text-primary", bg: "--bg" }

function parse(html: string): { els: El[]; runs: Run[] } {
  const out: El[] = []
  const runs: Run[] = []
  const stack: { el: El }[] = []
  // A <style> block's CSS is not text anyone reads.
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, "")
  for (const m of body.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      const t = m[5].replace(/&[a-z#0-9]+;/g, "x")
      for (const s of stack) s.el.text += t
      const at = stack[stack.length - 1]?.el ?? ROOT_EL
      if (t.trim()) runs.push({ text: t.trim(), fg: at.fg, bg: at.bg, fontPx: at.fontPx })
      continue
    }
    const [, close, tag, attrs, selfClose] = m
    if (close) {
      stack.pop()
      continue
    }
    const raw = /style="([^"]*)"/.exec(attrs!)?.[1] ?? ""
    const style = Object.fromEntries(
      raw.split(";").filter(Boolean).map((d) => {
        const i = d.indexOf(":")
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
      }),
    )
    const parent = stack[stack.length - 1]?.el ?? ROOT_EL
    const el: El = {
      tag: tag!,
      style,
      attrs: attrs!,
      text: "",
      fontPx: px(style["font-size"]) ?? parent.fontPx,
      fg: token(style.color) ?? parent.fg,
      bg: token(style.background) ?? parent.bg,
    }
    out.push(el)
    // React writes every void element self-closed (`<br/>`), so `/>` is the only non-push.
    if (!selfClose) stack.push({ el })
  }
  return { els: out, runs }
}

const GOLD = /^--(gold-\d+|accent|accent-text|progress-activity)$/
const graphicFg = new Set((PAIRS as Pair[]).filter((p) => p.kind === "graphic").map((p) => p.fg))
const css = readFileSync(join(process.cwd(), "app/tokens.css"), "utf8")
const themes = parseTokens(css) as Record<string, Record<string, string>>

describe.each(Object.entries(SCREENS))("%s — D-148 (0077)", (_, html) => {
  const { els, runs } = parse(html)

  it("every run of text is a measured text token on a measured background — and never gold below 24sp", () => {
    const measured = new Set((PAIRS as Pair[]).filter((p) => p.kind === "text").map((p) => `${p.fg} on ${p.bg}`))
    expect(runs.length).toBeGreaterThan(0)
    for (const r of runs) {
      if (GOLD.test(r.fg)) expect(r.fontPx, `gold text "${r.text}" at ${r.fontPx}px`).toBeGreaterThanOrEqual(24)
      else expect(measured.has(`${r.fg} on ${r.bg}`), `"${r.text}" is ${r.fg} on ${r.bg}, which no pair measures`).toBe(true)
    }
  })

  it("gold colours only marks: every gold-coloured element owns no text, and is measured as a graphic", () => {
    for (const e of els) {
      const fg = token(e.style.color)
      if (!fg || !GOLD.test(fg)) continue
      expect(e.text.trim(), `${fg} on <${e.tag}>`).toBe("")
      expect(graphicFg.has(fg), `${fg} is measured as a graphic`).toBe(true)
    }
  })

  it("floating chrome is fully opaque: no alpha below 1, no backdrop blur, no opacity", () => {
    expect(html).not.toMatch(/backdrop-filter|opacity:|rgba?\(|hsla?\(|transparent/)
    const floating = els.filter((e) => /sticky|fixed/.test(e.style.position ?? "") && !/data-scrim/.test(e.attrs))
    // The pinned header on the panel; the dialog is absolute inside a fixed scrim, checked by role.
    const dialog = els.filter((e) => /role="dialog"/.test(e.attrs))
    const chrome = [...floating, ...dialog]
    expect(chrome.length).toBeGreaterThan(0)
    for (const e of chrome) {
      const bg = token(e.style.background)
      expect(bg, `${e.tag} has a token background`).toBeDefined()
      for (const [theme, t] of Object.entries(themes)) expect(resolve(t, bg)[3], `${bg} in ${theme}`).toBe(1)
    }
  })

  it("nothing renders below 12sp (06 §8.4)", () => {
    for (const r of runs) expect(r.fontPx, r.text).toBeGreaterThanOrEqual(12)
  })
})

describe("level figures (0077)", () => {
  it("every tile level is 24sp tabular ink", () => {
    const levels = parse(panel).els.filter((e) => e.style["font-size"] === "1.5rem" && /^\d+$/.test(e.text.trim()))
    expect(levels.length).toBe(enabled.length)
    for (const e of levels) {
      expect(e.style["font-variant-numeric"]).toBe("tabular-nums")
      expect(token(e.style.color)).toBe("--text-primary")
    }
  })
})

describe("activity vs meta is not colour-only (0077)", () => {
  it("each tile's accessible name states its kind, and the section headings stay", () => {
    for (const s of enabled) expect(panel).toMatch(new RegExp(`aria-label="${s.name}, level \\d+, ${s.kind} skill"`))
    expect(panel).toContain("<h2")
    expect(panel).toMatch(/>ACTIVITY</)
    expect(panel).toMatch(/>META</)
  })
})

describe("the token pairs themselves (scripts/check-contrast.mjs)", () => {
  it("every declared pair passes in both themes", () => {
    const failed = (measure(css) as Row[]).filter((r) => !r.pass)
    expect(failed.map((r) => `${r.theme} ${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}`)).toEqual([])
  })

  it("measures §8.3's published ratios", () => {
    const at = (fg: string, bg: string) => (measure(css, [{ fg, bg, kind: "text" }]) as Row[])[0]!.ratio
    expect(at("--ink-900", "--parch-100")).toBeCloseTo(15.5, 1)
    expect(at("--ink-500", "--parch-100")).toBeCloseTo(4.81, 1)
    expect(at("--gold-500", "--parch-100")).toBeCloseTo(2.07, 1)
    expect(at("--gold-300", "--navy-900")).toBeCloseTo(11.7, 0)
  })

  it("would reject gold text on parchment, and a translucent background", () => {
    const [r] = measure(css, [{ fg: "--gold-500", bg: "--bg", kind: "text" }]) as Row[]
    expect(r!.pass).toBe(false)
    expect(() => measure(css, [{ fg: "--text-primary", bg: "--line", kind: "text" }])).toThrow(/opaque/)
  })
})
