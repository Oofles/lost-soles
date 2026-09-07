import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"
import { loadRuleSet } from "@/src/rules/load"
import { selectActivitySkills } from "@/src/rules/select-activity-skills"

import { normalizeStrava } from "./normalize"

/**
 * TICKET 0037, CRITERION 12 — the end-to-end that proves D-141 rather than asserting it.
 *
 * The claim under test is the one that is easy to say and hard to keep: **a no-GPS run
 * falls to Vigil BY THE MATCHER, not by a branch in the adapter.** The adapter sets
 * `hasTrace`; `rules/xp-rules-v1.yaml`'s `requiresTrace` does the rest. If this ticket had
 * introduced any line resembling `hasTrace ? "wayfaring" : "vigil"`, D-141 would have been
 * broken at the last possible moment — and every test that only checked the OUTPUT would
 * still be green.
 *
 * So this file runs the real fixtures through the real `normalize` into the real ruleset,
 * with nothing stubbed, and then separately asserts the adapter contains no skill id at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, "__fixtures__")

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/user-01JQ8Z/strava/x/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  archivedAt: "2026-06-01T03:20:11.482Z",
}

const job = (externalId: string): IngestJob => ({
  ingestKey: "k",
  userId: "user-01JQ8Z",
  source: "strava",
  externalId,
  command: "ingest",
  startedAt: "2026-06-01T02:53:48Z",
  meta: { aspectType: "create", hasGpsHint: true },
  enqueuedAt: "2026-06-01T03:19:00.000Z",
})

const RULES = loadRuleSet(1)

/** normalize a fixture, then ask the ruleset what it trains. Nothing in between. */
function skillsFor(fixture: string, externalId: string): string[] {
  const raw = readFileSync(join(FIXTURES, `${fixture}.json`))
  const { activity } = normalizeStrava(raw, REF, job(externalId))
  return selectActivitySkills(activity, RULES).map((s) => s.id)
}

describe("the same run, with and without a trace, selects different skills", () => {
  it("an outdoor run selects wayfaring", () => {
    expect(skillsFor("run-continuous", "18736594040")).toContain("wayfaring")
  })

  it("a no-GPS run selects vigil", () => {
    expect(skillsFor("treadmill-no-streams", "18736594046")).toContain("vigil")
  })

  it("a watch-recorded indoor run with no latlng key also selects vigil", () => {
    // The nastiest no-GPS case (§2.6): 200, streams present, no `latlng`. It must land in
    // exactly the same place as the 404 — the discriminator is `hasTrace`, nothing else.
    expect(skillsFor("indoor-watch-no-latlng", "18736594051")).toContain("vigil")
  })

  it("and they are MUTUALLY EXCLUSIVE — never both, never neither", () => {
    const outdoor = skillsFor("run-continuous", "18736594040")
    const indoor = skillsFor("indoor-watch-no-latlng", "18736594051")

    expect(outdoor).toContain("wayfaring")
    expect(outdoor).not.toContain("vigil")
    expect(indoor).toContain("vigil")
    expect(indoor).not.toContain("wayfaring")
  })

  it("the ONLY difference between the two activities is hasTrace", () => {
    // The proof that no branch is involved: flip `hasTrace` on an otherwise identical
    // object and the selection flips with it, without any adapter code running at all.
    const raw = readFileSync(join(FIXTURES, "run-continuous.json"))
    const { activity } = normalizeStrava(raw, REF, job("18736594040"))

    expect(selectActivitySkills(activity, RULES).map((s) => s.id)).toContain("wayfaring")
    expect(
      selectActivitySkills({ ...activity, hasTrace: false }, RULES).map((s) => s.id),
    ).toContain("vigil")
  })
})

describe("a ride is classified honestly and scored by the rules, not by the adapter", () => {
  it("selects roving, because the YAML says rides count", () => {
    // 0036 mapped `Ride` to `ride` rather than dropping it, against §2.6's *(ignored)*
    // column. This is why that was right: `roving` matches `kinds: [ride]`, so a ride
    // earns XP today, and an adapter that had collapsed it to `other` would have silently
    // decided otherwise.
    expect(skillsFor("ride-fast-descent", "18736594050")).toContain("roving")
  })
})

describe("strength-shaped Strava activities enter nothing (criterion 5)", () => {
  /**
   * "ARCHIVED AND IGNORED" IS NOT A BRANCH EITHER, and it took reading the YAML to see how
   * it actually works. `might`, `fortitude` and `endurance` match `kinds: [strength, other]`
   * with `sources: any`, so a Strava `WeightTraining` DOES match them — but their measures
   * are `reps:pushup`, `reps:situp` and `seconds:plank`, all of which are read off
   * `Activity.sets`, and a Strava activity has none.
   *
   * D-060 is forced, not chosen: Strava has no concept of reps, sets or exercise detail
   * anywhere in its API. So the activity is archived, it matches, and it counts zero —
   * without a single line anywhere saying "ignore Strava strength".
   */
  it("carries no sets, because Strava cannot express one", () => {
    const raw = readFileSync(join(FIXTURES, "weight-training.json"))
    const { activity } = normalizeStrava(raw, REF, job("18736594047"))

    expect(activity.kind).toBe("strength")
    expect(activity.sets).toEqual([])
    // The title is "Pushups 3x20". Parsing reps out of free text is exactly the fragile
    // heuristic that writes silent wrong data into a permanent, append-only ledger.
    expect(activity.name).toBe("Pushups 3x20")
  })

  it("selects only skills whose unit count comes from sets, so the count is zero", () => {
    const raw = readFileSync(join(FIXTURES, "weight-training.json"))
    const { activity } = normalizeStrava(raw, REF, job("18736594047"))
    const selected = selectActivitySkills(activity, RULES)

    expect(selected.length).toBeGreaterThan(0)
    for (const skill of selected) {
      expect(skill.match?.measure).toMatch(/^(reps|seconds):/)
    }
    // Nothing distance-based, so no XP can be awarded off `distanceM` by accident.
    expect(selected.map((s) => s.id)).not.toContain("wayfaring")
    expect(selected.map((s) => s.id)).not.toContain("vigil")
  })

  it("an unknown sport type behaves the same way", () => {
    const raw = readFileSync(join(FIXTURES, "unknown-sport-type.json"))
    const { activity } = normalizeStrava(raw, REF, job("18736594048"))

    expect(activity.kind).toBe("other")
    for (const skill of selectActivitySkills(activity, RULES)) {
      expect(skill.match?.measure).toMatch(/^(reps|seconds):/)
    }
  })
})

describe("the adapter names no skill and branches on nothing it should not", () => {
  const sources = ["normalize.ts", "sanitize.ts", "adapter.ts"].map((f) => ({
    file: f,
    text: readFileSync(join(HERE, f), "utf8"),
  }))

  it("contains no skill id anywhere", () => {
    /**
     * THE SAME PATTERN `src/rules/no-skill-names.test.ts` USES, deliberately — a QUOTED
     * skill id, which is a hardcoded reference, rather than the bare word, which may be
     * prose. Two definitions of "names a skill" would eventually disagree, and the looser
     * one would be the one that mattered.
     *
     * Written naively first, as a substring match, and it fired on the word "roving"
     * inside a comment explaining why the ride gate exists. That is exactly the false
     * positive D-166/D-167 narrowed the Strava grep for: a gate that fires on English is
     * a gate that gets bypassed.
     *
     * The repo-wide check already covers these files. This one exists so the failure names
     * the adapter, which is where the rule is most likely to be broken.
     */
    const quoted = new RegExp(`["'\`](${RULES.skills.map((s) => s.id).join("|")})["'\`]`)

    for (const { file, text } of sources) {
      text.split("\n").forEach((line, i) => {
        expect(quoted.test(line), `${file}:${i + 1} hardcodes a skill id: ${line.trim()}`).toBe(
          false,
        )
      })
    }
  })

  it("has no `hasTrace ? … : …` skill selection", () => {
    for (const { file, text } of sources) {
      expect(/hasTrace\s*\?/.test(text), `${file} branches on hasTrace`).toBe(false)
    }
  })

  /**
   * CRITERION 1 — the mapping reads `sport_type`, never the legacy `type`.
   *
   * `type` is the 37-value deprecated enum and it is LOSSY: a `TrailRun` appears there as a
   * plain `Run`, and 19 modern sport types collapse to the single value `Workout`. A grep,
   * because the behavioural test (`trailrun-legacy-type-mismatch`) proves the right answer
   * comes out today and this proves nobody can reach for the wrong field tomorrow.
   */
  it("never reads `type` off a Strava payload", () => {
    for (const { file, text } of sources) {
      for (const line of text.split("\n")) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
        expect(
          /\bdetail\.type\b|\bactivity\.type\b|\["type"\]|\.type\s*===/.test(line),
          `${file} reads the lossy legacy \`type\` field: ${line.trim()}`,
        ).toBe(false)
      }
    }
  })
})
