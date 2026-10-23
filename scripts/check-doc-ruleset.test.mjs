import { describe, expect, it } from "vitest"

import { SEEDS, check, loadDocs, loadRulesets } from "./check-doc-ruleset.mjs"

/**
 * Ticket 0162. The same seeds `--self-test` runs in CI, under vitest so `npm test` carries them:
 * each failure mode is shown RED on a seeded disagreement before the green tree is trusted.
 */
describe("check-doc-ruleset (D-193)", () => {
  const docs = loadDocs()
  const rulesets = loadRulesets()

  it("is green on the tree", () => {
    expect(check(docs, rulesets)).toEqual([])
  })

  for (const [name, mutate, want] of SEEDS) {
    it(`goes red on ${name}`, () => {
      const d = { ...docs }
      const r = structuredClone(rulesets)
      mutate(d, r)
      const got = check(d, r)
      expect(got.some((m) => want.test(m)), got.join("\n") || "(green)").toBe(true)
    })
  }

  it("reports every disagreement, not the first", () => {
    const d = { ...docs }
    const r = structuredClone(rulesets)
    for (const [, mutate] of SEEDS.slice(0, 4)) mutate(d, r)
    expect(check(d, r).length).toBeGreaterThanOrEqual(4)
  })
})
