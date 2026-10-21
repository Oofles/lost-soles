import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

import { getAdapter, registeredSources } from "../../../src/adapters/registry"
import type { SourceAdapter } from "../../../src/adapters/types"
import type { SourceId } from "../../../src/domain/activity"
import { computeActivityId } from "../../../src/domain/activity-id"
import { objectKeys } from "../../../src/pipeline/explored-blob-store"
import { runDrillFrontHalf, type DrillFailure, type DrillS3, type FrontHalf } from "../../../src/pipeline/rebuild-drill"
import {
  liveNamesFromOutputs,
  runDrillBackHalf,
  type BackHalfSummary,
  type DrillTarget,
  type SpotCheck,
} from "../../../src/pipeline/rebuild-drill-back"
import { buildSnapshot, snapshotKey } from "../../../src/pipeline/skillstate-snapshot"
import { loadRuleSet } from "../../../src/rules/load"

import { MemoryDrillStore } from "./memory-store"

/**
 * THE REBUILD DRILL IN CI. Ticket `0104`. `02-data-model.md` §8.4: *"In CI, every build: the drill
 * runs end to end against a checked-in fixture of ~20 raw objects spanning every SourceId in use,
 * asserting steps 8.1–8.6. It is the same code path."*
 *
 * SAME CODE PATH means `runDrillFrontHalf` and `runDrillBackHalf` — the two functions
 * `tools/drill/rebuild-drill.ts` (`npm run drill`) calls — with the shipped adapter registry. This
 * file supplies only what the AWS CLI supplies there: a bucket to read (`fixtureBucket`, the
 * committed bytes) and a target to write (`MemoryDrillStore`, D-406). There is no second drill.
 *
 * ─── THE FIXTURE ────────────────────────────────────────────────────────────
 *
 * `tools/drill/__fixtures__/ci/` holds `raw/<uid>/…` exactly as the bucket lays it out, plus
 * `objects.json`: every key, its `LastModified` (the archive instant, D-398) and content type. The
 * bytes are real archive shapes — Strava envelopes (`sealRawEnvelope`) and manual `WorkoutEntry`
 * JSON — over synthetic geometry beside Point Nemo (D-199; `check-fixture-geography.mjs` covers the
 * directory because it is named `__fixtures__`). `__fixtures__/ci-corrupt/` is the one object only
 * the negative test lists.
 *
 * Adding a source means adding a payload for it under `ci/` in the same change: `drill:ci` exits 21,
 * and `drill-ci.test.ts` fails, while any registered `SourceId` has no fixture object. The fixture
 * only grows (§8.1 keeps raw objects forever).
 *
 * ─── THE EXPECTED FILE IS STEP 0 ────────────────────────────────────────────
 *
 * `expected.json` is the reviewed record of what the fixture rebuilds to, and the drill's own
 * assertions are made against it, not beside it: the fake bucket serves step 0's `manifest.json`
 * from its `step0.generation` and `cellCount` (check 3), the precondition-4 snapshot from its
 * `xpBySkill` (check 4's waterline), precondition 1's `--expect-objects` from its `objectCount`,
 * and check 6's pre-drill rows from its `spotCheck`. On top of the six, `expectations()` compares
 * what check 4's `≥` and the D-135 floors would otherwise absorb: exact per-skill XP, the ledger,
 * no floor rows, and the per-source normalize counts.
 *
 * Regenerating it is `npm run drill:ci -- --write-expected`, refused in CI, and it prints a warning
 * that the diff must be reviewed — a file that rewrites itself records whatever the code does.
 */

export const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
export const FIXTURE_DIR = join(ROOT, "tools/drill/__fixtures__/ci")
export const CORRUPT_FIXTURE_DIR = join(ROOT, "tools/drill/__fixtures__/ci-corrupt")
export const EXPECTED_PATH = join(FIXTURE_DIR, "expected.json")

/** The bucket the fixture pretends to live in, and a live stack the target must not name. */
const FIXTURE_BUCKET = "drill-ci-fixture-bucket"
const LIVE = liveNamesFromOutputs({
  storage: { bucket_name: FIXTURE_BUCKET },
  custom: { activityTableName: "Activity-drillcilive0104-NONE" },
})
export const CI_TARGET: DrillTarget = {
  tables: {
    activity: "Activity-drillcitarget-NONE",
    ledger: "XpLedgerEntry-drillcitarget-NONE",
    skillState: "SkillState-drillcitarget-NONE",
    profile: "Profile-drillcitarget-NONE",
    exploredCell: "DrillCiExploredCell",
    landmark: "Landmark-drillcitarget-NONE",
  },
  bucket: "drill-ci-target-bucket",
  prefix: "",
}

/** Step 0 when regenerating: an arbitrary generation, so step 7's `+ 1` is visibly not 1. */
const DEFAULT_STEP0_GENERATION = 41
/** The snapshot's instant. After every fixture activity; only its ordering matters. */
const SNAPSHOT_TAKEN_AT = "2025-10-01T00:00:00.000Z"
/** The drill's clock (`BackHalfOptions.now`), fixed so two runs write the same bytes. */
const DRILL_CLOCK = new Date("2025-10-02T00:00:00.000Z")
/** Check 6's activity: a run over half-known ground, so new AND recent rows are itemised. */
const SPOT_CHECK = { source: "strava", externalId: "17000000002" } as const

// ─── The fixture, as a bucket ───────────────────────────────────────────────

export interface FixtureObject {
  key: string
  lastModified: string
  contentType: string
}

export interface Fixture {
  userId: string
  objects: Array<FixtureObject & { body: Buffer }>
}

export function loadFixture(dir: string): Fixture {
  const listing = JSON.parse(readFileSync(join(dir, "objects.json"), "utf8")) as { userId: string; objects: FixtureObject[] }
  return {
    userId: listing.userId,
    objects: listing.objects.map((o) => ({ ...o, body: readFileSync(join(dir, o.key)) })),
  }
}

/** `ListObjectsV2` and `GetObject` over objects in memory — the only two calls the front half makes. */
export function fixtureBucket(objects: ReadonlyArray<FixtureObject & { body: Buffer }>): DrillS3 {
  const byKey = new Map(objects.map((o) => [o.key, o] as const))
  const send = async (command: ListObjectsV2Command | GetObjectCommand) => {
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? ""
      const keys = [...byKey.keys()].filter((k) => k.startsWith(prefix)).sort()
      return { Contents: keys.map((Key) => ({ Key, LastModified: new Date(byKey.get(Key)!.lastModified) })), IsTruncated: false }
    }
    const o = byKey.get(command.input.Key ?? "")
    if (!o) throw Object.assign(new Error(`NoSuchKey: ${command.input.Key}`), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })
    const bytes = Uint8Array.from(o.body)
    return { Body: { transformToByteArray: async () => bytes }, ContentType: o.contentType }
  }
  return { send } as unknown as DrillS3
}

// ─── The expected file ──────────────────────────────────────────────────────

export interface DrillCiExpected {
  warning: string
  userId: string
  rulesVersion: number
  step0: { generation: number }
  objectCount: number
  payloadCount: number
  supersededObjects: number
  duplicatePointerCount: number
  kindOverridesApplied: number
  activityCount: number
  normalizedBySource: Record<string, number>
  cellCount: number
  xpBySkill: Record<string, number>
  ledgerRows: number
  ledgerSum: number
  spotCheck: { source: string; externalId: string; activityId: string; rows: SpotCheck["expected"] }
}

export function readExpected(path = EXPECTED_PATH): DrillCiExpected {
  return JSON.parse(readFileSync(path, "utf8")) as DrillCiExpected
}

/** Precondition 2 reads git, as `npm run drill` does. A checkout with no git falls back to the tree. */
export function trackedRulesFiles(root = ROOT): { files: string[]; from: "git" | "tree" } {
  try {
    const files = execFileSync("git", ["ls-files", "rules/"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean)
    if (files.length > 0) return { files, from: "git" }
  } catch {
    // fall through
  }
  return { files: readdirSync(join(root, "rules")).map((f) => `rules/${f}`), from: "tree" }
}

const newestRulesVersion = (rulesFiles: readonly string[]) =>
  Math.max(...rulesFiles.map((f) => /^rules\/xp-rules-v(\d+)\.yaml$/.exec(f)?.[1]).filter(Boolean).map(Number))

// ─── The run ────────────────────────────────────────────────────────────────

export interface Expectation {
  name: string
  ok: boolean
  detail: string
}

export interface DrillCiOptions {
  /** `null` regenerates: no step-0 target, no waterline, no spot-check — and nothing is asserted. */
  expected: DrillCiExpected | null
  /** Default: the committed fixture. The negative test adds `CORRUPT_FIXTURE_DIR`. */
  fixtureDirs?: readonly string[]
  /** Default: the shipped registry. The mutation test wraps it. */
  adapterFor?: (source: SourceId) => SourceAdapter
  rulesFiles?: readonly string[]
  onFailure?: (f: DrillFailure) => void
  log?: (line: string) => void
}

export interface DrillCiResult {
  front: FrontHalf
  back: BackHalfSummary | null
  store: MemoryDrillStore
  spotActivityId: string
  /** Registered `SourceId`s with no payload object in the fixture. Must be empty. */
  uncoveredSources: SourceId[]
  normalizedBySource: Record<string, number>
  failuresBySource: Record<string, number>
  expectations: Expectation[]
  /** The first failure: a precondition, an abort, one of the six, coverage, or an expectation. */
  failed: { reason: string; detail: string; exitCode: number } | null
  wallClockMs: number
}

export const EXIT_EXPECTATION = 20
export const EXIT_UNCOVERED_SOURCE = 21

const countBy = <T>(items: readonly T[], key: (t: T) => string) => {
  const out: Record<string, number> = {}
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export async function runDrillCi(o: DrillCiOptions): Promise<DrillCiResult> {
  const started = Date.now()
  const dirs = o.fixtureDirs ?? [FIXTURE_DIR]
  const fixtures = dirs.map(loadFixture)
  const userId = fixtures[0]!.userId
  if (fixtures.some((f) => f.userId !== userId)) throw new Error("fixture directories name different users")
  const rawObjects = fixtures.flatMap((f) => f.objects)
  const rulesFiles = o.rulesFiles ?? trackedRulesFiles().files
  const exp = o.expected
  const rulesVersion = exp?.rulesVersion ?? newestRulesVersion(rulesFiles)
  const rules = loadRuleSet(rulesVersion)
  const generation = exp?.step0.generation ?? DEFAULT_STEP0_GENERATION

  // Step 0's verification target and precondition 4's snapshot, from the expected file.
  const snapshot = buildSnapshot({
    userId,
    takenAt: SNAPSHOT_TAKEN_AT,
    generation,
    trigger: "ingest",
    rules,
    rows: Object.entries(exp?.xpBySkill ?? {}).map(([skillId, xp]) => ({ skillId, displayedXp: xp, xpLedgerSum: xp })),
  })
  const step0Objects = [
    { key: objectKeys.manifest(userId), body: Buffer.from(JSON.stringify({ generation, cellCount: exp?.cellCount ?? 0 })) },
    { key: snapshotKey(snapshot), body: Buffer.from(JSON.stringify(snapshot)) },
  ].map((x) => ({ ...x, lastModified: SNAPSHOT_TAKEN_AT, contentType: "application/json" }))

  const extraObjects = rawObjects.length - fixtures[0]!.objects.length
  const front = await runDrillFrontHalf({
    phase: "normalize",
    userId,
    dryRun: false,
    expectObjects: exp ? exp.objectCount + extraObjects : undefined,
    bucket: FIXTURE_BUCKET,
    s3: fixtureBucket([...rawObjects, ...step0Objects]),
    rulesFiles,
    registeredSources: registeredSources(),
    adapterFor: o.adapterFor ?? getAdapter,
    saveSnapshot: (key) => `memory:${key}`,
    onFailure: o.onFailure,
  })

  const store = new MemoryDrillStore()
  const spotActivityId = exp?.spotCheck.activityId ?? computeActivityId(userId, SPOT_CHECK.source, SPOT_CHECK.externalId)
  const uncoveredSources = registeredSources().filter((s) => !front.summary.sourceIds.includes(s))
  const normalizedBySource = countBy(front.sorted, (e) => e.activity.source.source)
  const failuresBySource = countBy(front.summary.failures ?? [], (f) => f.source)
  const result: DrillCiResult = {
    front,
    back: null,
    store,
    spotActivityId,
    uncoveredSources,
    normalizedBySource,
    failuresBySource,
    expectations: [],
    failed: null,
    wallClockMs: 0,
  }
  const done = () => ({ ...result, wallClockMs: Date.now() - started })

  if (front.summary.refused) {
    const p = front.summary.preconditions.find((x) => !x.ok)!
    result.failed = { reason: `PRECONDITION_${p.n}`, detail: `${p.name}: ${p.detail}`, exitCode: 3 }
    return done()
  }

  const back = await runDrillBackHalf(front, {
    target: CI_TARGET,
    live: LIVE,
    store,
    rules,
    // Regenerating has no step-0 count to equal, so check 3 is `≥ 0` there and `==` otherwise.
    fogAlgoChanged: exp === null,
    spotCheck: exp ? { activityId: exp.spotCheck.activityId, expected: exp.spotCheck.rows } : undefined,
    now: () => DRILL_CLOCK,
    log: o.log,
  })
  result.back = back
  if (back.failed && exp) {
    result.failed = back.failed
    return done()
  }

  if (uncoveredSources.length > 0) {
    result.failed = {
      reason: "FIXTURE_SOURCE_UNCOVERED",
      detail: `registered with no fixture payload: ${uncoveredSources.join(", ")}`,
      exitCode: EXIT_UNCOVERED_SOURCE,
    }
    return done()
  }

  if (exp) {
    result.expectations = expectations(exp, result)
    const miss = result.expectations.find((e) => !e.ok)
    if (miss) result.failed = { reason: `EXPECT_${miss.name}`, detail: miss.detail, exitCode: EXIT_EXPECTATION }
  }
  return done()
}

/** Rule-derived XP per skill, and what the target's T2 rows say. */
function stored(store: MemoryDrillStore) {
  const ledger = [...store.ledger.values()]
  const xpBySkill = Object.fromEntries(
    [...store.skillStates.values()].map((w) => [w.skillId, w.xp] as const).sort(([a], [b]) => (a < b ? -1 : 1)),
  )
  return {
    xpBySkill,
    ledgerRows: ledger.length,
    ledgerSum: ledger.reduce((s, e) => s + e.xpAwarded, 0),
    floors: ledger.filter((e) => e.isFloor),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What the six cannot see: exact values where they assert `≥`, and the floors that absorb a drop. */
export function expectations(exp: DrillCiExpected, r: DrillCiResult): Expectation[] {
  const s = stored(r.store)
  const back = r.back!
  const check = (name: string, ok: boolean, detail: string): Expectation => ({ name, ok, detail })
  return [
    check("ACTIVITY_COUNT", back.activitiesWritten === exp.activityCount, `${back.activitiesWritten} written, expected ${exp.activityCount}`),
    check(
      "NORMALIZED_BY_SOURCE",
      same(r.normalizedBySource, exp.normalizedBySource),
      `${JSON.stringify(r.normalizedBySource)}, expected ${JSON.stringify(exp.normalizedBySource)}`,
    ),
    check("CELL_COUNT", back.cellCount === exp.cellCount, `${back.cellCount} cells, expected ${exp.cellCount}`),
    check("NO_FLOORS", s.floors.length === 0, s.floors.length === 0 ? "no retained_floor rows" : s.floors.map((f) => `${f.skillId} +${f.xpAwarded}`).join("; ")),
    check("XP_BY_SKILL", same(s.xpBySkill, exp.xpBySkill), `${JSON.stringify(s.xpBySkill)}, expected ${JSON.stringify(exp.xpBySkill)}`),
    check(
      "LEDGER",
      s.ledgerRows === exp.ledgerRows && s.ledgerSum === exp.ledgerSum,
      `${s.ledgerRows} rows summing to ${s.ledgerSum}, expected ${exp.ledgerRows} summing to ${exp.ledgerSum}`,
    ),
  ]
}

/** `--write-expected`: the record a reviewer diffs. Refuses unless steps 1–5 of the six passed. */
export function expectedFromRun(r: DrillCiResult): DrillCiExpected {
  const back = r.back
  if (!back) throw new Error(`cannot record expectations: ${r.failed?.reason ?? "the back half did not run"}`)
  const broken = back.step8.filter((c) => c.n !== 6 && c.status === "fail")
  if (broken.length > 0 || (back.failed && back.failed.reason !== "ASSERT_6_SPOT_CHECK")) {
    throw new Error(`cannot record expectations over a failing drill: ${broken.map((c) => c.reason).join(", ") || back.failed?.reason}`)
  }
  if (r.uncoveredSources.length > 0) throw new Error(`no fixture payload for: ${r.uncoveredSources.join(", ")}`)
  const s = stored(r.store)
  const f = r.front.summary
  const rows = [...r.store.ledger.values()]
    .filter((e) => e.activityId === r.spotActivityId && !e.isFloor)
    .map((e) => ({ id: e.id, reason: e.reason, units: e.units, xpAwarded: e.xpAwarded, xpRulesVersion: e.xpRulesVersion }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    warning:
      "Generated by `npm run drill:ci -- --write-expected`. Every change to this file is a reviewed " +
      "commit: a diff here means the drill rebuilds the fixture differently than it did.",
    userId: f.userId,
    rulesVersion: back.rulesVersion,
    step0: { generation: DEFAULT_STEP0_GENERATION },
    objectCount: f.objectCount,
    payloadCount: f.payloadCount,
    supersededObjects: f.supersededObjects ?? 0,
    duplicatePointerCount: f.duplicatePointerCount,
    kindOverridesApplied: f.kindOverridesApplied ?? 0,
    activityCount: back.activitiesWritten,
    normalizedBySource: r.normalizedBySource,
    cellCount: back.cellCount ?? 0,
    xpBySkill: s.xpBySkill,
    ledgerRows: s.ledgerRows,
    ledgerSum: s.ledgerSum,
    spotCheck: { ...SPOT_CHECK, activityId: r.spotActivityId, rows },
  }
}
