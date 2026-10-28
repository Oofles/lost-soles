import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"

import { parseRuleSetFile, RULES_DIR, rulesPath } from "./load"
import { validateRuleSet } from "./validate"

/**
 * I-6 — A SHIPPED RULESET IS NEVER MUTATED. Ticket `0116`.
 *
 * `02-data-model.md` §9.1 states it against T5 and a seeder that refuses to write into an existing
 * partition. Neither exists (D-276: rules ship as bundled JSON, D-217/D-274), and §3.8 restates the
 * invariant on the files themselves: *"a shipped `vN` is never edited, because 04 §7.6 requires
 * every shipped ruleset to survive forever — a ledger row citing `v1` is meaningless if `v1` was
 * mutated."* Nothing enforced that sentence until this file.
 *
 * The pins are DATA, in `rules/shipped-rulesets.json`, not literals here: shipping the next
 * version is then a change under `rules/` only, which keeps D-031's "a new workout type is a data
 * row" true of the release that carries one. `build-rules-json.mjs --check` already binds each
 * `.json` to its YAML, so pinning the YAML pins both.
 */

const PINS = JSON.parse(readFileSync(`${RULES_DIR}/shipped-rulesets.json`, "utf8")) as { pinned: Record<string, string> }

/** LF-normalised, so a CRLF checkout is not a "mutation". Any other byte is. */
const sha256Of = (version: number) =>
  createHash("sha256").update(readFileSync(rulesPath(version), "utf8").replace(/\r\n/g, "\n")).digest("hex")

const bundled = Object.keys(BUNDLED_RULES).map(Number).sort((a, b) => a - b)
const newest = Math.max(...bundled)

describe("I-6 — a shipped rulesVersion is never mutated or deleted", () => {
  it.each(Object.entries(PINS.pinned))("v%s still exists, byte-for-byte as it shipped", (v, sha) => {
    expect(existsSync(rulesPath(Number(v))), `rules/xp-rules-v${v}.yaml was deleted`).toBe(true)
    expect(sha256Of(Number(v)), `rules/xp-rules-v${v}.yaml was edited after it shipped — write v${newest + 1} instead`).toBe(sha)
  })

  it("every bundled version but the newest is pinned — a version is shipped once a later one exists", () => {
    const unpinned = bundled.filter((v) => v !== newest && !(String(v) in PINS.pinned))
    expect(unpinned).toEqual([])
  })

  it.each(bundled)("I-26 — bundled v%s is valid, checked before the backend deploys (D-467)", (v) => {
    expect(validateRuleSet(BUNDLED_RULES[v as keyof typeof BUNDLED_RULES])).toEqual([])
    expect(validateRuleSet(parseRuleSetFile(v))).toEqual([])
  })

  it("every pinned version is still bundled, so the worker can still score under it", () => {
    expect(Object.keys(PINS.pinned).map(Number).filter((v) => !bundled.includes(v))).toEqual([])
  })
})
