import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { collectAdvisories, judge, validateAllowlist, withAdvisory } from "./check-npm-audit.mjs"

/**
 * Ticket 0318. The fixture is a trimmed real `npm audit --json` capture of the full tree after
 * 0308: the two allowlisted leaves, the moderate `csv-parse`, and two parents whose `via` holds
 * only package names. No test here touches the registry.
 */
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"))
const fixture = read("./fixtures/npm-audit-full-tree.json")
const allowlist = read("./npm-audit-allowlist.json")

describe("check-npm-audit", () => {
  it("passes the current full tree: 37 high paths, two allowlisted advisories", () => {
    expect(fixture.metadata.vulnerabilities.high).toBe(37)
    const { failures, admitted } = judge(fixture, allowlist)
    expect(failures).toEqual([])
    expect(admitted.map((a) => a.advisory).sort()).toEqual(["GHSA-7mx3-vvmw-hjmv", "GHSA-mrhx-c7xc-m3w5"])
  })

  it("judges by advisory, not by path: parent entries contribute nothing", () => {
    const ids = collectAdvisories(fixture).map((a) => `${a.package} ${a.advisory}`).sort()
    expect(ids).toEqual([
      "@graphql-tools/utils GHSA-7mx3-vvmw-hjmv",
      "csv-parse GHSA-8cw4-87c7-c6xx",
      "zod GHSA-mrhx-c7xc-m3w5",
    ])
  })

  it("turns red on an unlisted high advisory", () => {
    const planted = withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "high" })
    const { failures } = judge(planted, allowlist)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/NOT ALLOWLISTED: left-pad GHSA-2222-3333-4444 \(high\)/)
  })

  it("turns red on an unlisted critical advisory", () => {
    const planted = withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "critical" })
    expect(judge(planted, allowlist).failures).toHaveLength(1)
  })

  it("matches the package too: an allowlisted GHSA on another package is not admitted", () => {
    const planted = withAdvisory(fixture, { name: "not-zod", ghsa: "GHSA-mrhx-c7xc-m3w5", severity: "high" })
    expect(judge(planted, allowlist).failures[0]).toMatch(/NOT ALLOWLISTED: not-zod/)
  })

  it("ignores advisories below high, as `--audit-level=high` does", () => {
    const planted = withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "moderate" })
    expect(judge(planted, allowlist).failures).toEqual([])
  })

  it("turns red when an allowlisted advisory is re-rated above its entry", () => {
    const rerated = structuredClone(fixture)
    rerated.vulnerabilities.zod.via[0].severity = "critical"
    expect(judge(rerated, allowlist).failures[0]).toMatch(/RE-RATED: zod GHSA-mrhx-c7xc-m3w5/)
  })

  it("turns red on a stale entry, so exceptions cannot outlive their advisory", () => {
    const fixed = structuredClone(fixture)
    delete fixed.vulnerabilities["@graphql-tools/utils"]
    expect(judge(fixed, allowlist).failures).toEqual([
      expect.stringMatching(/STALE ENTRY: @graphql-tools\/utils GHSA-7mx3-vvmw-hjmv/),
    ])
  })

  it("fails closed on an npm error document or a non-v2 shape", () => {
    expect(() => judge({ error: { code: "ENOTFOUND", summary: "unreachable" } }, allowlist)).toThrow(/error/)
    expect(() => judge({ advisories: {} }, allowlist)).toThrow(/auditReportVersion 2/)
  })

  it("the committed allowlist is well-formed and names only 0308's two high advisories", () => {
    expect(validateAllowlist(allowlist)).toEqual([])
    expect(allowlist.advisories.map((e) => `${e.package} ${e.advisory}`)).toEqual([
      "@graphql-tools/utils GHSA-7mx3-vvmw-hjmv",
      "zod GHSA-mrhx-c7xc-m3w5",
    ])
    for (const e of allowlist.advisories) expect(e.recheck).toMatch(/0319/)
  })

  it("rejects a malformed allowlist: short id, missing reason, below-gate severity, duplicate", () => {
    const base = allowlist.advisories[0]
    expect(validateAllowlist({ advisories: [{ ...base, advisory: "1241230" }] })[0]).toMatch(/full GHSA id/)
    expect(validateAllowlist({ advisories: [{ ...base, reason: "" }] })[0]).toMatch(/missing `reason`/)
    expect(validateAllowlist({ advisories: [{ ...base, severity: "moderate" }] })[0]).toMatch(/below the gate/)
    expect(validateAllowlist({ advisories: [base, base] })[0]).toMatch(/duplicate/)
  })
})
