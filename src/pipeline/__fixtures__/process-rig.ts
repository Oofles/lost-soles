import { readFileSync } from "node:fs"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { expect } from "vitest"

import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { NormalizedIngest, Trace } from "@/src/domain/activity"
import type { ProcessDeps } from "@/src/pipeline/process-activity"
import { loadRuleSet } from "@/src/rules/load"

/**
 * THE PIPELINE RIG, shared. Moved out of `process-activity.test.ts` by `0179`, whose
 * cross-source fixture has to drive the same pipeline from `src/adapters/strava/` — a file that
 * names the adapter must live in its directory (D-188), and duplicating 450 lines of fakes there
 * would be two rigs drifting apart. Nothing here changed in the move except the exports and the
 * `adapter` option; the reasoning for each fake is where it always was, beside it.
 *
 * SOURCE-AGNOSTIC, like everything else in this directory (D-100).
 */

export const SOURCE = "gpslogger"
export const BUCKET = "test-bucket"
export const ACTIVITY_TABLE = "Activity-testapi-NONE"
export const CELL_TABLE = "TestExploredCell"
export const LEDGER_TABLE = "XpLedgerEntry-testapi-NONE"
export const SKILL_STATE_TABLE = "SkillState-testapi-NONE"
export const PROFILE_TABLE = "Profile-testapi-NONE"
export const FIXTURE = readFileSync(new URL("./verbatim-payload.json", import.meta.url))

export const JOB: IngestJob = {
  ingestKey: "k-1",
  userId: "u-1",
  source: SOURCE,
  externalId: "9001",
  command: "ingest",
  startedAt: "2026-06-01T02:53:48.000Z",
  meta: null,
  enqueuedAt: "2026-09-06T09:00:00.000Z",
}

/**
 * Enough of an `Activity` for `persistActivity` to build a real item from. Not a full
 * fixture — `persist.test.ts` owns the row's shape, and duplicating it here would mean
 * two places to edit every time T3 gains a field.
 */
export function ingestOf(over: Options["ingest"] = {}): NormalizedIngest {
  return {
    activity: {
      activityId: "a-1",
      userId: "u-1",
      kind: over.kind ?? "run",
      hasTrace: over.hasTrace ?? false,
      distanceM: over.distanceM,
      /**
       * `0195`. What `normalize()` actually produces — the contract says the pipeline fills it
       * in, so the value arriving here is always null and never absent. The fixture omitted it
       * entirely, which made `traceRef: undefined` reach the row and hid the difference between
       * "no geometry" and "this column did not exist yet".
       */
      traceRef: null,
      source: { source: SOURCE },
      startedAt: "2026-09-06T03:00:00.000Z",
      /** `0179`. Required on a real `Activity`; step 3 compares it. */
      elapsedS: 1800,
      startedAtLocal: "2026-09-05T21:00:00",
      timezone: "America/Denver",
      ingestedAt: "2026-09-06T09:00:02.000Z",
      sets: [],
    },
    trace: over.trace,
  } as unknown as NormalizedIngest
}

export const INGEST = ingestOf()

export interface Options {
  /** `0067`. Makes the post-commit snapshot PUT throw. */
  snapshotFails?: Error
  /** `0067`. What T2 holds when the snapshot reads it back. Empty by default. */
  skillStates?: Record<string, unknown>[]
  /** What the score gate answers. `claimed` by default. */
  claim?: { kind: "claimed" } | { kind: "duplicate"; attributes: Record<string, unknown> }
  fetchRaw?: () => Promise<never>
  archiveFails?: boolean
  /** No receipt row — `recordDelivery`'s condition fails. */
  noReceipt?: boolean
  /**
   * Ticket `0047`. Overrides on the normalized ingest, so one rig can produce a traceless
   * strength log, a run that reveals ground and a ride that must not.
   */
  ingest?: { kind?: string; hasTrace?: boolean; trace?: Trace; distanceM?: number }
  /** Ticket `0047`. Every cell write throws this, to prove the ordering holds under failure. */
  cellsFail?: Error
  /** `0049`. A failed blob PUT, to prove it happens above the transaction. */
  blobsFail?: Error
  /** `0051`. T1's table name, when a test wants the mirror to actually write. */
  profileTable?: string
  /** `0050`. Called with the `startedAt` a replay was marked from. */
  onReplayMark?: (at: string) => void
  /**
   * `0195`. Omitted by default, which is the rebuild drill's configuration — no `traces` dep,
   * no geometry written, `traceRef` left as `normalize()` produced it. Every test that predates
   * this ticket therefore exercises exactly the behaviour it exercised before.
   */
  traces?: boolean
  /** `0195`. A failed geometry PUT, to prove it happens above the transaction. */
  tracesFail?: Error
  /**
   * Ticket `0048`. What T6 already holds, as `cell -> lastRunAt`. A cell absent from this
   * map classifies `new`. Given as a function of the run's cells so a test can seed "every
   * cell is already known" without knowing which cells the fixture trace produces.
   */
  known?: (cells: string[]) => Record<string, string>
  /** `0062`. Rows T4's `byActivity` already holds for this activity (layer 1). */
  ledgerExisting?: Array<Record<string, unknown>>
  /** `0062`. The n-th (1-based) transaction throws what this returns, if anything. */
  persistFails?: (n: number) => Error | undefined
  /** `0220`. The T3 row a previous delivery committed, if any. Absent: a first delivery. */
  storedActivity?: Record<string, unknown>
  /**
   * `0179`. What GSI2 `byUserAndDedupe` holds for this user, as T3 rows: `id` plus the three
   * fields `isSameActivity` compares. Every query answers every row — the rig does not hash
   * keys, so a test that wants a row unreachable leaves it out rather than mis-keying it.
   */
  dedupeRows?: Array<{ id: string; startedAt: string; elapsedS: number; distanceM?: number }>
  /** `0179`. The `duplicate-of.json` pointer PUT throws this. */
  pointerFails?: Error
  /**
   * `0179`. A real adapter in place of the stub — the cross-source fixture drives the pipeline
   * through two. Its `fetchRaw` and `normalize` are wrapped so `calls` still records the phases.
   */
  adapter?: SourceAdapter<{ token: string }>
}

/** The real v1 ruleset, because D-189's answer must be the shipped one, not a stub's. */
export const REGISTRY = loadRuleSet(1)

/**
 * A two-point trace near Point Nemo (D-199), long enough to qualify a handful of cells
 * and short enough that the assertions stay countable.
 */
export const TRACE: Trace = {
  points: [
    { lat: -48.876, lng: -123.393, t: 0 },
    { lat: -48.8735, lng: -123.393, t: 90_000 },
  ],
  gaps: [],
  simplified: false,
  bbox: [-123.393, -48.876, -123.393, -48.8735],
  pointCount: 2,
}

/**
 * One rig, one `calls` array. Everything the pipeline is allowed to touch is here, and
 * anything it is NOT allowed to touch throws rather than returning undefined — a step
 * run out of turn should announce itself, not be inferred later from a missing entry.
 */
export function rig(options: Options = {}) {
  const calls: string[] = []
  const tracePuts: PutObjectCommand["input"][] = []
  const cellWrites: UpdateCommand["input"][] = []
  const aggWrites: UpdateCommand["input"][] = []
  const blobPuts: string[] = []
  /** `0062`. Every transaction sent, and every T4/T2 read, in order. */
  const transacts: TransactWriteCommand["input"][] = []
  const ledgerReads: string[] = []
  const activityReads: GetCommand["input"][] = []
  /** `0067`. Every `snapshots/skillstate/` PUT. Kept out of `calls`: it is not a phase. */
  const snapshotPuts: PutObjectCommand["input"][] = []
  /** `0179`. Step 3's reads, kept out of `calls` like the ledger's; and every receipt write. */
  const dedupeReads: Array<QueryCommand["input"] | GetCommand["input"]> = []
  const pointerPuts: PutObjectCommand["input"][] = []
  const receiptWrites: UpdateCommand["input"][] = []
  let ticks = 0
  const clock = () => {
    ticks += 1
    return 1_000 + ticks * 10
  }

  const real = options.adapter
  const adapter = real ? ({
    ...real,
    async fetchRaw(job: IngestJob, creds: { token: string }) {
      calls.push("fetch")
      return real.fetchRaw(job, creds)
    },
    normalize(...args: Parameters<SourceAdapter<{ token: string }>["normalize"]>) {
      calls.push("normalize")
      return real.normalize(...args)
    },
  } as SourceAdapter<{ token: string }>) : ({
    id: SOURCE,
    accept: () => Promise.reject(new Error("accept is the webhook's phase, not the worker's")),
    async fetchRaw() {
      calls.push("fetch")
      if (options.fetchRaw) return options.fetchRaw()
      return { body: FIXTURE, contentType: "application/json", ext: "json", schemaHint: "x@1" }
    },
    normalize() {
      calls.push("normalize")
      return options.ingest ? ingestOf(options.ingest) : INGEST
    },
    listSince: () => {
      throw new Error("listSince belongs to the Sync action, not the worker")
    },
  } as unknown as SourceAdapter<{ token: string }>)

  const conditionalFailure = Object.assign(new Error("conditional"), {
    name: "ConditionalCheckFailedException",
  })

  const deps: ProcessDeps<{ token: string }> = {
    adapter,
    clock,
    async credentials(job) {
      calls.push("credentials")
      // Identity, not equality — the pipeline must pass the job through untouched. `0192`'s
      // reingest tests pass a variant of it, so the assertion is on the key rather than the object.
      expect(job.ingestKey).toBe(JOB.ingestKey)
      return { token: "t" }
    },
    archive: {
      bucket: BUCKET,
      now: () => new Date("2026-09-06T09:00:01.000Z"),
      s3: {
        async send(command: unknown) {
          if (command instanceof PutObjectCommand && String(command.input.Key).endsWith(".duplicate-of.json")) {
            calls.push("pointer")
            pointerPuts.push(command.input)
            if (options.pointerFails) throw options.pointerFails
            return {}
          }
          if (command instanceof PutObjectCommand) {
            calls.push("archive")
            if (options.archiveFails) throw new Error("s3 is down")
            return { ETag: '"e"' }
          }
          // A HeadObject only happens on the already-archived path; not exercised here.
          return {}
        },
      } as never,
    },
    receipt: {
      async send(): Promise<never> {
        throw new Error("unreachable")
      },
    } as never,
    /**
     * Ticket `0047`. Every conditional `UpdateItem` is captured, and the FIRST one pushes
     * `cells` — one entry, not 130, so the ordering assertion stays about the sequence of
     * phases rather than about how much ground the fixture happens to cover.
     */
    cells: {
      table: CELL_TABLE,
      concurrency: 1,
      sleep: async () => {},
      ddb: {
        async send(command: UpdateCommand | BatchGetCommand) {
          /**
           * `0048`. The read comes first and is announced separately, so the ordering
           * assertions can say READ-then-WRITE — which is §3.3's classify-then-write rule
           * at the level this file can see it.
           */
          if (command instanceof BatchGetCommand) {
            calls.push("cellsRead")
            const keys = (command.input.RequestItems?.[CELL_TABLE]?.Keys ?? []) as Array<{
              sk: string
            }>
            const known = options.known?.(keys.map((k) => k.sk)) ?? {}
            return {
              Responses: {
                [CELL_TABLE]: keys
                  .filter((k) => known[k.sk])
                  .map((k) => ({ sk: k.sk, lastRunAt: known[k.sk] })),
              },
            }
          }
          /**
           * `0049`. T6's item type B rides on the same client, and it must not be counted
           * as a cell write — the assertions below are about the 40-130 conditional cell
           * updates, and folding three aggregate rows into them would make every count
           * off by a number that varies with the fixture's geography.
           */
          if (String(command.input.Key?.pk).endsWith("#GEN")) {
            calls.push("replayMark")
            options.onReplayMark?.(
              String(
                (command.input.ExpressionAttributeValues as Record<string, string>)[":at"],
              ),
            )
            return {}
          }
          if (String(command.input.Key?.pk).includes("#AGG#")) {
            if (!aggWrites.length) calls.push("cellsAgg")
            aggWrites.push(command.input)
            if (options.cellsFail) throw options.cellsFail
            return {}
          }
          if (!cellWrites.length) calls.push("cells")
          cellWrites.push(command.input)
          if (options.cellsFail) throw options.cellsFail
          return {}
        },
      },
    },
    /**
     * `0049`. §2.10's regeneration, faked at the two seams it actually uses: a counter on
     * T6 and object storage. The GET always misses, so every test in this file publishes
     * generation 1 from an empty base — which is the bootstrap case and keeps the
     * assertions about ORDER rather than about merge arithmetic (that is
     * `explored-blob-store.test.ts`'s job).
     */
    blobs: {
      bucket: BUCKET,
      table: CELL_TABLE,
      /** `0051`. No T1 yet, so the mirror is a no-op — see `explored-mirror.ts`. */
      mirror: options.profileTable === undefined ? undefined : {
        table: options.profileTable,
        ddb: {
          async send() {
            calls.push("mirror")
            return {}
          },
        } as never,
      },
      now: () => new Date("2026-09-06T09:00:02.000Z"),
      ddb: {
        async send() {
          calls.push("generation")
          return { Attributes: { generation: 1 } }
        },
      } as never,
      s3: {
        async send(command: unknown) {
          if (command instanceof GetObjectCommand) {
            const e = new Error("no such key") as Error & { name: string }
            e.name = "NoSuchKey"
            throw e
          }
          if (!blobPuts.length) calls.push("blobs")
          blobPuts.push(String((command as PutObjectCommand).input.Key))
          if (options.blobsFail) throw options.blobsFail
          return { ETag: '"b"' }
        },
      } as never,
    },
    /**
     * `0195`. The per-activity route geometry (`02` §5.1, S-7). Present only when a test asks
     * for it, so the default rig keeps the pre-`0195` shape.
     */
    traces: options.traces
      ? {
          bucket: BUCKET,
          s3: {
            async send(command: PutObjectCommand) {
              calls.push("traces")
              tracePuts.push(command.input)
              if (options.tracesFail) throw options.tracesFail
              return { ETag: '"t"' }
            },
          } as never,
        }
      : undefined,
    registry: REGISTRY,
    persist: {
      activityTable: ACTIVITY_TABLE,
      ddb: {
        async send(command: TransactWriteCommand | GetCommand) {
          /**
           * `0220`. `readStoredAward`'s consistent read of T3. Answers with `storedActivity`,
           * or nothing — a first delivery. Kept out of `calls`, like the ledger reads.
           */
          if (command instanceof GetCommand) {
            activityReads.push(command.input)
            return options.storedActivity ? { Item: options.storedActivity } : {}
          }
          calls.push("persist")
          expect(command).toBeInstanceOf(TransactWriteCommand)
          transacts.push(command.input)
          const failure = options.persistFails?.(transacts.length)
          if (failure) throw failure
          return {}
        },
      },
    },
    /**
     * `0062`. T4's `byActivity` answers `ledgerExisting`; T2 answers empty, so every ADD is a
     * first write. Kept out of `calls` so the phase-order assertions above stay about phases.
     */
    ledger: {
      ledgerTable: LEDGER_TABLE,
      skillStateTable: SKILL_STATE_TABLE,
      profileTable: PROFILE_TABLE,
      ddb: {
        async send(command: QueryCommand) {
          expect(command).toBeInstanceOf(QueryCommand)
          const table = String(command.input.TableName)
          ledgerReads.push(table)
          if (table === LEDGER_TABLE) return { Items: options.ledgerExisting ?? [] }
          return { Items: command.input.ConsistentRead && options.skillStates ? options.skillStates : [] }
        },
      },
    },
    dedupe: {
      activityTable: ACTIVITY_TABLE,
      ddb: {
        async send(command: QueryCommand | GetCommand) {
          dedupeReads.push(command.input)
          const rows = options.dedupeRows ?? []
          if (command instanceof QueryCommand) return { Items: rows.map((r) => ({ id: r.id })) }
          return { Item: rows.find((r) => r.id === command.input.Key?.id) }
        },
      },
    },
    snapshots: {
      bucket: BUCKET,
      s3: {
        async send(command: PutObjectCommand) {
          expect(command).toBeInstanceOf(PutObjectCommand)
          if (options.snapshotFails) throw options.snapshotFails
          snapshotPuts.push(command.input)
          return {}
        },
      } as never,
    },
  }

  /**
   * The receipt client sees TWO different `UpdateCommand`s and they must not be
   * conflated: `recordDelivery`'s `ADD attempts` and the score gate's `SET #status`.
   * Told apart by their update expression, which is the only thing that distinguishes
   * them at the wire level.
   */
  deps.receipt = {
    ddb: {
      async send(command: UpdateCommand) {
        const expression = String(command.input.UpdateExpression)
        receiptWrites.push(command.input)
        if (expression.startsWith("ADD attempts")) {
          calls.push("recordDelivery")
          if (options.noReceipt) throw conditionalFailure
          return { Attributes: { attempts: 1 } }
        }
        if (expression.includes("duplicateOf")) {
          calls.push("recordDuplicate")
          return {}
        }
        calls.push("gate")
        const claim = options.claim ?? { kind: "claimed" }
        if (claim.kind === "claimed") return { Attributes: { attempts: 1 } }
        throw conditionalFailure
      },
    },
  } as never

  // The losing claim path READS the receipt after its condition fails. Layered on
  // afterwards so the happy path's client stays a single method.
  if (options.claim?.kind === "duplicate") {
    const attributes = options.claim.attributes
    deps.receipt = {
      ddb: {
        async send(command: { input: { UpdateExpression?: string } }) {
          const expression = command.input.UpdateExpression
          if (expression === undefined) {
            calls.push("readReceipt")
            return { Item: attributes }
          }
          if (expression.startsWith("ADD attempts")) {
            calls.push("recordDelivery")
            return { Attributes: { attempts: 2 } }
          }
          calls.push("gate")
          throw conditionalFailure
        },
      },
    } as never
  }

  return {
    deps,
    calls,
    cellWrites,
    aggWrites,
    blobPuts,
    tracePuts,
    transacts,
    ledgerReads,
    activityReads,
    snapshotPuts,
    dedupeReads,
    pointerPuts,
    receiptWrites,
  }
}
