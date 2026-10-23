#!/usr/bin/env node
/**
 * D-193: a design doc may not restate a per-row value from `rules/xp-rules-vN.yaml` as a bare
 * fact. Ticket 0162 turns that from a rule held by review into a check.
 *
 * `src/rules/doc-schema.test.ts` already asserts `04` §1.3's YAML example field by field. This
 * covers the PROSE TABLES and the count sentences that restate the same rows:
 *
 *   04 §1.1  the activity-skill and meta-skill tables: every row of that `kind` present, no
 *            others; `Unit` is the row's unit; any "N XP/km" is its rate; `1/3 of …` is the
 *            `feeds` rate into it; a POST-MVP row is exactly a disabled row. Plus the "ships N
 *            enabled skills: M activity skills — …" sentence and "Only X opens the map".
 *   04 §1.2  the Total Level ceiling table — a DATED SNAPSHOT (see below).
 *   04 §3.2  the rates table: every ENABLED row present, no others; unit, `XP per unit`, and the
 *            "N … = M" arithmetic in `A typical session` (M = N × rate, to the nearest whole XP).
 *   02 §3.2  the `RuleSkill` attribute table: every key a shipped row uses is an attribute; the
 *            `kind`, `logMode` and `unit` vocabularies hold every value in use; the `exercises`
 *            shape holds every exercise key in use and lists every `logMode` that has exercises.
 *            Plus the two "Only `x` … in vN" sentences, checked against vN.
 *
 * WHICH VERSION. The newest `rules/xp-rules-vN.yaml` — the ruleset a user is scored under today
 * (D-279). Older versions are immutable (D-282), so a doc that describes an older one says so with
 * a snapshot marker or a "in vN" qualifier, and is checked against THAT version.
 *
 * DATED SNAPSHOTS (D-193 permits them). A registered section containing the visible line
 *
 *     > **Ruleset snapshot: `vN`, YYYY-MM-DD.** …
 *
 * is checked against vN instead of the newest, and vN must be the version effective on that date
 * (the newest whose `effectiveFrom` is on or before it). A snapshot is therefore CHECKED against
 * its stated date, not exempted: it can never drift, because its version never changes. There is
 * no exemption marker at all, on purpose — an exemption nobody can see is how the next table
 * drifts.
 *
 * UNREGISTERED TABLES. Any table in a top-level design doc (`docs/NN-*.md`, `docs/contracts/`)
 * whose first column names FIVE or more distinct skills is an enumeration of the registry, and it
 * fails unless its section is registered in PASSAGES below. Five, because `04` §8's worked
 * examples name three or four skills each and are backed by `propagate.test.ts`, not by this.
 *
 * NOT A PROSE LINTER (the ticket's scope rule). It reads values the ruleset owns, out of tables
 * and a short list of named sentences. `04` §3.2's session-parity argument is prose containing
 * numbers, and it is not read.
 *
 * Every disagreement is reported, not the first.
 *
 *   node scripts/check-doc-ruleset.mjs              check the tree
 *   node scripts/check-doc-ruleset.mjs --self-test  prove each failure mode goes red
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { parse } from "yaml"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

// ── Markdown ──────────────────────────────────────────────────────────────────────────────

/** Lines of the section starting at the heading with this prefix, up to the next heading of the
 *  same or higher level. Null when the heading is absent. */
export function section(text, headingPrefix) {
  const lines = text.split("\n")
  const from = lines.findIndex((l) => l.startsWith(headingPrefix))
  if (from === -1) return null
  const level = headingPrefix.match(/^#+/)[0].length
  let to = lines.length
  for (let i = from + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+) /)
    if (m && m[1].length <= level) { to = i; break }
  }
  return { start: from + 1, lines: lines.slice(from, to) }
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim())

/** Every pipe table in `lines`: { header: string[], rows: string[][], line: number (1-based) }. */
export function tables(lines, start = 1) {
  const out = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue
    const t = { header: splitRow(lines[i]), rows: [], line: start + i }
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) t.rows.push(splitRow(lines[j]))
    out.push(t)
    i = j - 1
  }
  return out
}

/** `**Wayfaring**` → `Wayfaring`; `` `km` (new) `` → `km (new)`. */
const plain = (cell) => cell.replace(/\*\*|`/g, "").trim()
const firstToken = (cell) => plain(cell).split(/[\s(]/)[0]

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty"]
const toInt = (w) => (/^\d+$/.test(w) ? Number(w) : WORDS.indexOf(w.toLowerCase()))
const num = (s) => Number(s.replace(/,/g, ""))
const nameList = (s) => s.split(/,|\band\b/).map((x) => x.replace(/[*`]/g, "").trim()).filter(Boolean)
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

// ── Rulesets ──────────────────────────────────────────────────────────────────────────────

/** `{ [version]: parsed }` for every `rules/xp-rules-vN.yaml`. */
export function loadRulesets(dir = join(ROOT, "rules")) {
  const out = {}
  for (const f of readdirSync(dir)) {
    const m = f.match(/^xp-rules-v(\d+)\.yaml$/)
    if (m) out[Number(m[1])] = parse(readFileSync(join(dir, f), "utf8"))
  }
  return out
}

const newest = (rulesets) => Math.max(...Object.keys(rulesets).map(Number))

/** The version effective on `date` (YYYY-MM-DD): the newest whose effectiveFrom ≤ end of day. */
function effectiveOn(rulesets, date) {
  const t = Date.parse(`${date}T23:59:59Z`)
  let best = null
  for (const [v, r] of Object.entries(rulesets)) {
    const from = Date.parse(r.effectiveFrom instanceof Date ? r.effectiveFrom.toISOString() : String(r.effectiveFrom))
    if (from <= t && (best === null || Number(v) > best)) best = Number(v)
  }
  return best
}

const SNAPSHOT = /\*\*Ruleset snapshot: `v(\d+)`, (\d{4}-\d{2}-\d{2})\.\*\*/

// ── The registry of checked passages ──────────────────────────────────────────────────────
//
// `tables[].column` picks the table by a header it alone carries. `enumerates` is the set of rows
// the table must hold exactly. A passage whose heading or table is missing FAILS: a check that
// silently matched nothing is a gate that has only ever been seen passing.

export const PASSAGES = [
  {
    doc: "docs/04-game-design.md",
    heading: "### 1.1 ",
    tables: [
      { column: "Trains on", enumerates: (s) => s.kind === "activity", what: "every activity row" },
      { column: "Fed by", enumerates: (s) => s.kind === "meta", what: "every meta row" },
    ],
    claims: ["shipsCount", "onlyOpensMap"],
  },
  { doc: "docs/04-game-design.md", heading: "### 1.2 ", requireSnapshot: true, claims: ["ceiling"] },
  {
    doc: "docs/04-game-design.md",
    heading: "### 3.2 ",
    tables: [{ column: "XP per unit", enumerates: (s) => s.enabled === true, what: "every enabled row" }],
  },
  { doc: "docs/02-data-model.md", heading: "### 3.2 ", claims: ["attributes", "onlyInVersion"] },
]

// ── Checks ────────────────────────────────────────────────────────────────────────────────

function checkSkillTable(t, spec, rules, v, at, err) {
  const col = (name) => t.header.findIndex((h) => plain(h) === name)
  const byName = new Map(rules.skills.map((s) => [s.name.toLowerCase(), s]))
  const byId = new Map(rules.skills.map((s) => [s.id, s]))
  const file = `rules/xp-rules-v${v}.yaml`
  const seen = new Set()
  const iUnit = col("Unit"), iRate = col("XP per unit"), iFed = col("Fed by"), iSession = col("A typical session")

  t.rows.forEach((row, r) => {
    const label = plain(row[0])
    const where = `${at}, line ${t.line + 2 + r}, row "${label}"`
    const s = byName.get(label.toLowerCase()) ?? byId.get(label.toLowerCase())
    if (!s) return err(`${where}: no skill named "${label}" in ${file}`)
    seen.add(s.id)
    const text = row.join(" | ")

    if (!spec.enumerates(s)) err(`${where}: this table holds ${spec.what}, and ${file} has "${s.id}" as kind=${s.kind}, enabled=${s.enabled}`)

    if (iUnit !== -1 && firstToken(row[iUnit]) !== s.unit) {
      err(`${where}: unit — doc says "${firstToken(row[iUnit])}", ${file} says "${s.unit}"`)
    }

    // A rate is a bold leading number, or `1/3 …` for a feeds recipient.
    const feedRates = rules.skills.flatMap((f) => (f.feeds ?? []).filter((x) => x.skill === s.id).map((x) => x.rate))
    for (const i of [iRate, iFed]) {
      if (i === -1) continue
      const cell = plain(row[i])
      const frac = cell.match(/^(\d+)\s*\/\s*(\d+)\b/)
      if (frac) {
        const want = Number(frac[1]) / Number(frac[2])
        if (feedRates.length === 0) err(`${where}: doc says ${frac[0]} of other skills' XP feeds "${s.id}"; nothing in ${file} feeds it`)
        for (const got of new Set(feedRates)) {
          if (Math.abs(got - want) > 0.001) err(`${where}: feeds rate — doc says ${frac[0]}, ${file} says ${got}`)
        }
        continue
      }
      const n = cell.match(/^(\d+(?:\.\d+)?)/)
      if (i === iRate) {
        if (!n) err(`${where}: "XP per unit" — no number in "${cell}"`)
        else if (num(n[1]) !== s.xpPerUnit) err(`${where}: xpPerUnit — doc says ${n[1]}, ${file} says ${s.xpPerUnit}`)
      }
    }

    // "60 XP/km" anywhere in the row.
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*XP\s*\/\s*(\w+)/g)) {
      if (num(m[1]) !== s.xpPerUnit) err(`${where}: "${m[0]}" — ${file} says xpPerUnit ${s.xpPerUnit}`)
    }

    // "75 = 300": the total derived from the rate (D-193 names derived totals).
    if (iSession !== -1) {
      const m = plain(row[iSession]).match(/^([\d.,]+)[^=\d]*=\s*([\d,]+)/)
      if (m) {
        const want = num(m[1]) * s.xpPerUnit
        if (Math.abs(want - num(m[2])) > 0.5 + 1e-9) {
          err(`${where}: "${m[0]}" — ${m[1]} × ${s.xpPerUnit} (${file}) is ${Math.round(want)}, not ${m[2]}`)
        }
      }
    }

    // The enabled flag: a POST-MVP row is exactly a disabled row.
    const marked = /POST-MVP/.test(text)
    if (marked && s.enabled !== false) err(`${where}: marked POST-MVP, but ${file} has enabled: ${s.enabled}`)
    if (!marked && s.enabled === false) err(`${where}: ${file} has enabled: false, and the row does not say POST-MVP`)
  })

  for (const s of rules.skills.filter(spec.enumerates)) {
    if (!seen.has(s.id)) err(`${at}, table at line ${t.line}: holds ${spec.what}, and has no row for "${s.name}" (${s.id}) — added to ${file}, not to the doc`)
  }
}

const CLAIMS = {
  /** 04 §1.1: "MVP ships **nine enabled skills**: seven activity skills — A, B — plus C and D (" */
  shipsCount(text, rules, v, at, err) {
    const m = text.match(/ships \*\*(\w+) enabled skills\*\*: (\w+) activity skills — ([^—]+) — plus ([^(]+?) \(/)
    if (!m) return err(`${at}: the "MVP ships **N enabled skills**: M activity skills — … — plus … (" sentence was not found. Reworded: update CLAIMS.shipsCount in this check. Removed: remove the claim from PASSAGES.`)
    const file = `rules/xp-rules-v${v}.yaml`
    const enabled = rules.skills.filter((s) => s.enabled === true)
    const act = enabled.filter((s) => s.kind === "activity").map((s) => s.name)
    const meta = enabled.filter((s) => s.kind === "meta").map((s) => s.name)
    if (toInt(m[1]) !== enabled.length) err(`${at}: "${m[1]} enabled skills" — ${file} has ${enabled.length}`)
    if (toInt(m[2]) !== act.length) err(`${at}: "${m[2]} activity skills" — ${file} has ${act.length} enabled`)
    if (!sameSet(nameList(m[3]), act)) err(`${at}: activity skills listed as [${nameList(m[3])}] — ${file} enables [${act}]`)
    if (!sameSet(nameList(m[4]), meta)) err(`${at}: meta skills listed as [${nameList(m[4])}] — ${file} enables [${meta}]`)
  },

  /** 04 §1.1: "**Only Wayfaring opens the map**" — revealsGround. */
  onlyOpensMap(text, rules, v, at, err) {
    const m = text.match(/\*\*Only (\w+) opens the map\*\*/)
    if (!m) return err(`${at}: the "**Only X opens the map**" sentence was not found. Reworded: update CLAIMS.onlyOpensMap. Removed: remove the claim from PASSAGES.`)
    const real = rules.skills.filter((s) => s.revealsGround === true).map((s) => s.name)
    if (!sameSet([m[1]], real)) err(`${at}: "Only ${m[1]} opens the map" — revealsGround: true in rules/xp-rules-v${v}.yaml on [${real}]`)
  },

  /** 04 §1.2, the dated snapshot: the row count, its names, maxLevel, and the ceiling table. */
  ceiling(text, rules, v, at, err, lines, start) {
    const file = `rules/xp-rules-v${v}.yaml`
    const enabled = rules.skills.filter((s) => s.enabled === true)
    const m = text.match(/\*\*(\d+) enabled rows\*\* \(([^)]+)\)/)
    if (!m) err(`${at}: the "**N enabled rows** (names)" sentence was not found`)
    else {
      if (num(m[1]) !== enabled.length) err(`${at}: "${m[1]} enabled rows" — ${file} has ${enabled.length}`)
      if (!sameSet(nameList(m[2]), enabled.map((s) => s.name))) err(`${at}: enabled rows listed as [${nameList(m[2])}] — ${file} enables [${enabled.map((s) => s.name)}]`)
    }
    const ml = text.match(/`maxLevel: (\d+)`/)
    if (ml && num(ml[1]) !== rules.curve.maxLevel) err(`${at}: "maxLevel: ${ml[1]}" — ${file} says ${rules.curve.maxLevel}`)

    const t = tables(lines, start).find((x) => x.header.map(plain).includes("ceiling"))
    if (!t) return err(`${at}: no table with a "ceiling" column`)
    const iRows = t.header.map(plain).indexOf("rows"), iCeil = t.header.map(plain).indexOf("ceiling")
    t.rows.forEach((row, r) => {
      const label = plain(row[0]), where = `${at}, line ${t.line + 2 + r}, row "${label}"`
      const rows = num(plain(row[iRows])), ceil = num(plain(row[iCeil]))
      const deep = /deepMaxLevel/.test(label)
      const level = deep ? rules.curve.deepMaxLevel : rules.curve.maxLevel
      const wantRows = /\bif\b.*\benabled\b/.test(label) ? rules.skills.length : enabled.length
      if (rows !== wantRows) err(`${where}: rows — doc says ${rows}, ${file} gives ${wantRows}`)
      if (ceil !== rows * level) err(`${where}: ceiling — doc says ${ceil}, ${rows} × ${deep ? "deepMaxLevel" : "maxLevel"} ${level} (${file}) is ${rows * level}`)
    })
  },

  /** 02 §3.2: the RuleSkill attribute table and its vocabularies. */
  attributes(text, rules, v, at, err, lines, start) {
    const file = `rules/xp-rules-v${v}.yaml`
    const t = tables(lines, start).find((x) => plain(x.header[0]) === "attr")
    if (!t) return err(`${at}: no table whose first column is "attr"`)
    const attr = new Map(t.rows.map((row) => [plain(row[0]), row]))
    const used = new Set(rules.skills.flatMap((s) => Object.keys(s)).map((k) => (k === "id" ? "skillId" : k)))
    for (const k of used) if (!attr.has(k)) err(`${at}: ${file} rows carry "${k}", and the attribute table has no row for it`)

    /** The first code span in the notes column, split on `\|`. */
    const vocab = (key) => {
      const row = attr.get(key)
      const span = row?.[3]?.match(/`([^`]+)`/)
      return span ? span[1].split(/\\\|/).map((x) => x.trim()) : null
    }
    for (const key of ["kind", "logMode", "unit"]) {
      const doc = vocab(key)
      if (!doc) { err(`${at}: no \`a \\| b\` vocabulary in the "${key}" row`); continue }
      const inUse = [...new Set(rules.skills.map((s) => s[key]))]
      for (const val of inUse) if (!doc.includes(val)) err(`${at}, row "${key}": ${file} uses "${val}", and the doc's set is [${doc}]`)
    }

    const ex = attr.get("exercises")
    if (ex) {
      const notes = ex[3] ?? ""
      const modes = notes.match(/for `logMode: ([^`]+)`/)?.[1].split(/\\\|/).map((x) => x.trim())
      const shape = notes.match(/`\{([^}]+)\}`/)?.[1].split(",").map((x) => x.trim().replace(/\?$/, ""))
      const withEx = rules.skills.filter((s) => s.exercises?.length)
      if (!modes) err(`${at}, row "exercises": no "for \`logMode: …\`" list`)
      else for (const m of new Set(withEx.map((s) => s.logMode))) {
        if (!modes.includes(m)) err(`${at}, row "exercises": ${file} has exercises on a logMode: ${m} row (${withEx.filter((s) => s.logMode === m).map((s) => s.id)}), and the doc says only [${modes}]`)
      }
      if (!shape) err(`${at}, row "exercises": no \`{…}\` shape`)
      else for (const k of new Set(withEx.flatMap((s) => s.exercises.flatMap((e) => Object.keys(e))))) {
        if (!shape.includes(k)) err(`${at}, row "exercises": ${file} exercises carry "${k}", and the doc's shape is {${shape}}`)
      }
    }
  },

  /** 02 §3.2: "Only `wayfaring` is `true` in v1", "Only `cartography` carries it in v1" — each
   *  checked against the version it names, which is immutable. */
  onlyInVersion(text, _rules, _v, at, err, lines, start, rulesets) {
    const t = tables(lines, start).find((x) => plain(x.header[0]) === "attr")
    if (!t) return
    const checks = [
      { key: "revealsGround", re: /Only `(\w+)` is `true` in v(\d+)/, has: (s) => s.revealsGround === true },
      { key: "unitMultipliers", re: /Only `(\w+)` carries it in v(\d+)/, has: (s) => s.unitMultipliers != null },
    ]
    for (const c of checks) {
      const row = t.rows.find((r) => plain(r[0]) === c.key)
      const m = row?.join("|").match(c.re)
      if (!m) { err(`${at}, row "${c.key}": the "Only \`x\` … in vN" sentence was not found`); continue }
      const r = rulesets[Number(m[2])]
      if (!r) { err(`${at}, row "${c.key}": cites v${m[2]}, and there is no rules/xp-rules-v${m[2]}.yaml`); continue }
      const real = r.skills.filter(c.has).map((s) => s.id)
      if (!sameSet([m[1]], real)) err(`${at}, row "${c.key}": "Only ${m[1]} … in v${m[2]}" — rules/xp-rules-v${m[2]}.yaml has [${real}]`)
    }
  },
}

/** Every disagreement between `docs` ({ path: text }) and `rulesets` ({ version: parsed }). */
export function check(docs, rulesets) {
  const errs = []
  const err = (m) => errs.push(m)
  const latest = newest(rulesets)
  const registered = new Set()

  for (const p of PASSAGES) {
    const text = docs[p.doc]
    if (text === undefined) { err(`${p.doc}: not found`); continue }
    const sec = section(text, p.heading)
    const at = `${p.doc} §${p.heading.replace(/^#+ /, "").trim()}`
    if (!sec) { err(`${at}: heading not found — renamed? Update PASSAGES in this check.`); continue }
    registered.add(`${p.doc}\0${sec.start}`)

    let v = latest
    const body = sec.lines.join("\n")
    const snap = body.match(SNAPSHOT)
    if (snap) {
      v = Number(snap[1])
      const eff = effectiveOn(rulesets, snap[2])
      if (!rulesets[v]) { err(`${at}: snapshot names v${v}, and there is no rules/xp-rules-v${v}.yaml`); continue }
      if (eff !== v) err(`${at}: snapshot says v${v} on ${snap[2]}, and the version effective on ${snap[2]} is v${eff}`)
    } else if (p.requireSnapshot) {
      err(`${at}: a dated snapshot without its "> **Ruleset snapshot: \`vN\`, YYYY-MM-DD.**" line — mark it, or it is a bare restatement (D-193)`)
    }
    const rules = rulesets[v]
    const flat = body.replace(/\s*\n\s*(?:>\s*)?/g, " ")

    const ts = tables(sec.lines, sec.start)
    for (const spec of p.tables ?? []) {
      const t = ts.find((x) => x.header.map(plain).includes(spec.column))
      if (!t) { err(`${at}: no table with a "${spec.column}" column`); continue }
      checkSkillTable(t, spec, rules, v, at, err)
    }
    for (const c of p.claims ?? []) CLAIMS[c](flat, rules, v, at, err, sec.lines, sec.start, rulesets)
  }

  // Unregistered enumerations of the registry.
  const names = new Set(rulesets[latest].skills.flatMap((s) => [s.name.toLowerCase(), s.id]))
  for (const [path, text] of Object.entries(docs)) {
    const lines = text.split("\n")
    for (const t of tables(lines)) {
      const hits = new Set(t.rows.map((r) => plain(r[0]).toLowerCase()).filter((x) => names.has(x)))
      if (hits.size < 5) continue
      // Which section is it in?
      let h = t.line - 1
      while (h > 0 && !/^#{2,} /.test(lines[h - 1])) h--
      const owner = h > 0 ? h : 0
      if (!registered.has(`${path}\0${owner}`)) {
        err(`${path}, table at line ${t.line}: enumerates ${hits.size} skills in a section ("${lines[owner - 1] ?? "top"}") this check does not read. Register it in PASSAGES (D-193).`)
      }
    }
  }
  return errs
}

/** The design docs the check reads: top-level `docs/NN-*.md` and `docs/contracts/*.md`. */
export function loadDocs(root = ROOT) {
  const out = {}
  for (const dir of ["docs", "docs/contracts"]) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      if (dir === "docs" ? /^\d\d-.*\.md$/.test(f) : f.endsWith(".md")) out[`${dir}/${f}`] = readFileSync(join(abs, f), "utf8")
    }
  }
  return out
}

// ── Self-test: every failure mode, seeded, must go red and name what it found ─────────────

const clone = (o) => structuredClone(o)

/** [name, mutate(docs, rulesets), regex the report must match]. Exported for the vitest file. */
export const SEEDS = [
  ["a rate in 04 §3.2", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("| Might | `rep` (pushup) | **4** |", "| Might | `rep` (pushup) | **5** |") }, /§3\.2.*row "Might": xpPerUnit — doc says 5, rules\/xp-rules-v\d+\.yaml says 4/],
  ["a rate in the YAML", (_d, r) => { r[newest(r)].skills.find((s) => s.id === "roving").xpPerUnit = 35 }, /§1\.1.*row "Roving": "60 XP\/km" — .* says xpPerUnit 35/],
  ["a unit in 04 §1.1", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("| Planks | second |", "| Planks | minute |") }, /§1\.1.*row "Endurance": unit — doc says "minute", .* says "second"/],
  ["a derived total in 04 §3.2", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("| 75 = 300 |", "| 75 = 320 |") }, /row "Might": "75 = 320" — 75 × 4 .* is 300, not 320/],
  ["a feeds rate", (_d, r) => { for (const s of r[newest(r)].skills) for (const f of s.feeds ?? []) f.rate = 0.25 }, /row "Constitution": feeds rate — doc says 1\/3, .* says 0\.25/],
  ["a flag: enabled", (_d, r) => { r[newest(r)].skills.find((s) => s.id === "slayer").enabled = true }, /row "Slayer": marked POST-MVP, but .* has enabled: true/],
  ["a flag: revealsGround", (_d, r) => { r[newest(r)].skills.find((s) => s.id === "roving").revealsGround = true }, /"Only Wayfaring opens the map" — revealsGround: true .* on \[Wayfaring,Roving\]/],
  ["a skill row added to the YAML (the 0157 case)", (_d, r) => {
    const v = r[newest(r)]
    v.skills.push({ ...clone(v.skills.find((s) => s.id === "might")), id: "grip", name: "Grip", displayOrder: 65 })
  }, /§1\.1, table at line \d+: holds every activity row, and has no row for "Grip" \(grip\)/],
  ["a skill count in the 04 §1.1 sentence", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("**nine enabled skills**", "**eight enabled skills**") }, /"eight enabled skills" — .* has 9/],
  ["a unit missing from 02 §3.2 (the `share` case)", (d) => { d["docs/02-data-model.md"] = d["docs/02-data-model.md"].replace("`km \\| rep \\| second \\| cell \\| share`", "`km \\| rep \\| second \\| cell`") }, /row "unit": .* uses "share", and the doc's set is \[km,rep,second,cell\]/],
  ["an exercise key missing from 02 §3.2", (d) => { d["docs/02-data-model.md"] = d["docs/02-data-model.md"].replace("`{id, label, entry, kind, quickValues}`", "`{id, label, entry, quickValues}`") }, /row "exercises": .* exercises carry "kind"/],
  ["an attribute missing from 02 §3.2", (_d, r) => { r[newest(r)].skills[0].cooldownDays = 1 }, /rows carry "cooldownDays", and the attribute table has no row for it/],
  ["a snapshot whose date and version disagree", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("**Ruleset snapshot: `v1`, 2026-09-04.**", "**Ruleset snapshot: `v1`, 2026-10-05.**") }, /§1\.2: snapshot says v1 on 2026-10-05, and the version effective on 2026-10-05 is v2/],
  ["a snapshot value", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("| 9 | **891** |", "| 9 | **900** |") }, /row "MVP, as shipped": ceiling — doc says 900, 9 × maxLevel 99 .* is 891/],
  ["a snapshot marker removed", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("**Ruleset snapshot: `v1`, 2026-09-04.**", "**Snapshot.**") }, /§1\.2: a dated snapshot without its/],
  ["an unregistered skill table", (d) => { d["docs/06-ui.md"] = "## 9. New\n\n| Skill | x |\n|---|---|\n| Wayfaring | 1 |\n| Vigil | 1 |\n| Roving | 1 |\n| Might | 1 |\n| Fortitude | 1 |\n" }, /docs\/06-ui\.md, table at line 3: enumerates 5 skills .* Register it in PASSAGES/],
  ["a renamed heading", (d) => { d["docs/04-game-design.md"] = d["docs/04-game-design.md"].replace("### 3.2 Rates", "### 3.2a Rates") }, /§3\.2: heading not found/],
]

function selfTest() {
  const docs = loadDocs(), rulesets = loadRulesets()
  const base = check(docs, rulesets)
  if (base.length) { console.error("check-doc-ruleset: self-test needs a clean tree first:\n  " + base.join("\n  ")); process.exit(1) }
  let failed = 0
  for (const [name, mutate, want] of SEEDS) {
    const d = { ...docs }, r = clone(rulesets)
    mutate(d, r)
    const got = check(d, r)
    if (!got.some((m) => want.test(m))) { failed++; console.error(`  FAIL  ${name}: not caught as ${want}\n        got: ${got.join("\n             ") || "(green)"}`) }
    else console.log(`  red   ${name}`)
  }
  // Every disagreement, not the first.
  const d = { ...docs }, r = clone(rulesets)
  for (const [, mutate] of SEEDS.slice(0, 4)) mutate(d, r)
  if (check(d, r).length < 4) { failed++; console.error("  FAIL  four seeded disagreements did not produce four reports") }
  else console.log("  red   four seeded disagreements, four reports")
  if (failed) process.exit(1)
  console.log("check-doc-ruleset: self-test passed")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--self-test")) selfTest()
  else {
    const rulesets = loadRulesets()
    const errs = check(loadDocs(), rulesets)
    if (errs.length) {
      console.error(`check-doc-ruleset: ${errs.length} disagreement(s) between the design docs and rules/ (D-193):`)
      for (const e of errs) console.error(`  ${e}`)
      process.exit(1)
    }
    console.log(`check-doc-ruleset: 04 §1.1 §1.2 §3.2, 02 §3.2 agree with rules/xp-rules-v${newest(rulesets)}.yaml (snapshots with their own version)`)
  }
}
