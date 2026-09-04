import { describe, expect, it } from "vitest"

import type { Activity, NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"

import { assertNormalizeIsPure, ImpurityError, type NormalizeArgs } from "./normalize-purity"
import type { IngestJob, SourceAdapter } from "./types"

/**
 * T4, ticket 0027. The harness has to be shown to FAIL, not merely to pass — a purity
 * check that green-lights an impure adapter is worse than none, because it is cited as
 * evidence. Same discipline as `check-boundaries.mjs --self-test`: every trap gets an
 * adapter built to trip it.
 *
 * The fixture adapters are defined inline rather than in `__fixtures__/`. They exist to
 * exercise the harness, not to model a source; a shared fixture would invite exactly the
 * "make the fixture pass" edit that hollows a self-test out.
 */

const REF: RawArchiveRef = {
  bucket: "b",
  key: "raw/u/gpslogger/17/abc.json",
  contentType: "application/json",
  bytes: 2,
  sha256: "abc",
  archivedAt: "2026-09-03T00:00:00.000Z",
}

const JOB: IngestJob = {
  ingestKey: "k",
  userId: "u",
  source: "gpslogger",
  externalId: "17",
  command: "ingest",
  meta: null,
  enqueuedAt: "2026-09-03T00:00:00.000Z",
}

const ARGS: NormalizeArgs = { raw: Buffer.from("{}"), ref: REF, job: JOB }

/** The parts of an adapter T4 does not exercise. Phases 1, 2 and 4 have their own tickets. */
const OTHER_PHASES = {
  id: "gpslogger" as const,
  accept: async () => ({ status: 200, commands: [] }),
  fetchRaw: async () => ({ body: Buffer.alloc(0), contentType: "application/json", ext: "json" }),
  listSince: async function* (): AsyncGenerator<IngestJob> {},
}

function activity(startedAt: string): Activity {
  return {
    activityId: "a",
    userId: "u",
    kind: "run",
    startedAt,
    startedAtLocal: "2026-09-03T08:00:00",
    timezone: "America/Denver",
    elapsedS: 60,
    source: { source: "gpslogger", externalId: "17", sourceTypeRaw: "run", fetchedAt: startedAt },
    raw: REF,
    traceRef: null,
    hasTrace: false,
    sets: [],
    dedupeKey: "d",
    ingestedAt: startedAt,
    revision: 1,
  }
}

/** Reads only its arguments. This is what every real adapter must look like. */
const pure: SourceAdapter = {
  ...OTHER_PHASES,
  normalize: (raw, ref, job): NormalizedIngest => ({
    // Parsing a timestamp from the INPUT is pure and must keep working — the trap is on
    // the zero-argument form only. If this line ever throws, the harness is too blunt to
    // be satisfiable and adapters will route around it.
    activity: activity(new Date(job.enqueuedAt).toISOString()),
  }),
}

/** Each of these reaches for exactly one trapped capability. */
function impure(reach: () => void): SourceAdapter {
  return {
    ...OTHER_PHASES,
    normalize: (): NormalizedIngest => {
      reach()
      return { activity: activity("2026-09-03T00:00:00.000Z") }
    },
  }
}

describe("T4 — the purity harness accepts a pure normalize()", () => {
  it("returns what normalize() returned, so the caller can keep asserting", () => {
    const out = assertNormalizeIsPure(pure, ARGS)
    expect(out.activity.startedAt).toBe("2026-09-03T00:00:00.000Z")
  })

  it("leaves parsing a timestamp alone — new Date(string) is not a clock read", () => {
    expect(() => assertNormalizeIsPure(pure, ARGS)).not.toThrow()
  })
})

describe("T4 — and rejects every impure one", () => {
  const cases: Array<[string, () => void]> = [
    ["globalThis.fetch", () => void fetch("https://example.invalid")],
    ["new Date()", () => void new Date()],
    ["Date.now()", () => void Date.now()],
    ["Math.random()", () => void Math.random()],
    ["performance.now()", () => void performance.now()],
    ["crypto.randomUUID()", () => void crypto.randomUUID()],
    ["crypto.getRandomValues()", () => void crypto.getRandomValues(new Uint8Array(1))],
  ]

  for (const [name, reach] of cases) {
    it(`catches ${name}`, () => {
      expect(() => assertNormalizeIsPure(impure(reach), ARGS)).toThrow(ImpurityError)
    })
  }

  it("names the capability on the error, so the message is not the only evidence", () => {
    try {
      assertNormalizeIsPure(impure(() => void Math.random()), ARGS)
      expect.unreachable("the harness must throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ImpurityError)
      expect((err as ImpurityError).capability).toBe("Math.random()")
    }
  })

  it("names the decision it protects, so a future reader knows why before deleting it", () => {
    // Acceptance criterion 9. A failure message that says only "not pure" invites the
    // reader to conclude the rule is pedantry.
    const message = (() => {
      try {
        assertNormalizeIsPure(impure(() => void Date.now()), ARGS)
        return ""
      } catch (err) {
        return (err as Error).message
      }
    })()
    expect(message).toContain("D-100")
    expect(message).toContain("D-121.2")
    expect(message).toContain("migration seam")
  })

  it("catches non-determinism no trap can see — a module-level counter", () => {
    // The impurity that survives every global stub: nothing is reached for, the function
    // simply remembers. Two calls, same arguments, different answers.
    let calls = 0
    const drifting: SourceAdapter = {
      ...OTHER_PHASES,
      normalize: (): NormalizedIngest => {
        calls += 1
        return { activity: activity(`2026-09-03T00:00:0${calls}.000Z`) }
      },
    }
    expect(() => assertNormalizeIsPure(drifting, ARGS)).toThrow(/not deterministic/)
  })
})

describe("T4 — the traps are removed afterwards", () => {
  it("restores every global on the success path", () => {
    assertNormalizeIsPure(pure, ARGS)
    expect(typeof Date.now()).toBe("number")
    expect(new Date()).toBeInstanceOf(Date)
    expect(typeof Math.random()).toBe("number")
    expect(typeof globalThis.fetch).toBe("function")
  })

  it("restores every global on the THROWING path, which is the one that matters", () => {
    // A harness that leaks its traps on failure poisons every test that runs after it,
    // and the resulting failures point anywhere but here.
    expect(() => assertNormalizeIsPure(impure(() => void Math.random()), ARGS)).toThrow()
    expect(typeof Date.now()).toBe("number")
    expect(typeof Math.random()).toBe("number")
    expect(typeof globalThis.fetch).toBe("function")
    expect(typeof crypto.randomUUID()).toBe("string")
  })
})
