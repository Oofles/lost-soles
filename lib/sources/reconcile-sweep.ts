import { OWNER_USER_IDS } from "@/lib/auth/owner-ids"
import { log } from "@/lib/log"
import { oauthCredentialsFor } from "@/lib/sources/adapter-credentials"
import { NIGHTLY_OVERLAP_SECONDS } from "@/lib/sources/list-since-watermark"
import {
  advanceListSinceWatermark,
  getSourceAccountSummary,
  readListSinceWatermark,
} from "@/lib/sources/source-account-store"
import { syncSource, type SourceSyncOutcome, type SyncDeps } from "@/lib/sources/sync"
import { connectableSources, getAdapter } from "@/src/adapters/registry"
import type { SourceId } from "@/src/domain/activity"

/**
 * THE RECONCILIATION SWEEP. Ticket 0095, `03-integrations.md` §2.3,
 * `01-architecture.md` §4 ("`nightly-reconcile` is the backstop").
 *
 * Strava retries a webhook three times and then drops it, permanently and silently. Nothing
 * can ask "what did I miss", so this asks "what exists" on a schedule and enqueues whatever
 * the receipt table has never seen. Webhooks are the latency path; this is the path of record.
 *
 * ─── IT IS THE MANUAL SYNC, ON A CLOCK ─────────────────────────────────────
 *
 * Every connection goes through `syncSource` (`lib/sources/sync.ts`), the function the Sync
 * button calls: the adapter's `listSince` (the one listing implementation there is), the
 * receipt gate `needsEnqueue` (`acceptIngest` plus the accepted-but-never-delivered check),
 * the enqueue, and the watermark rule. What this file adds is only what a schedule needs and
 * a button does not: which users, which window, and a metric.
 *
 * ─── THE TWO WINDOWS ────────────────────────────────────────────────────────
 *
 * `six-hourly`: from the stored watermark. §2.3 writes it as `after=<watermark - 48h>`; the
 * stored value already IS `newest confirmed - 48h`, because `nextListSinceWatermark` applies
 * `SWEEP_OVERLAP_SECONDS` when it writes rather than when it reads. Subtracting again would
 * list four days for no reason.
 *
 * `nightly`: from 14 days ago, or the watermark if that is older. The slower net, and the
 * only thing that re-lists a fortnight. The advance after it is the same rule as six-hourly,
 * so the nightly run does not drag the watermark back 14 days for the next six-hourly run.
 *
 * ─── NOTHING THROWS OUT OF HERE FOR ONE CONNECTION ──────────────────────────
 *
 * A thrown handler would let EventBridge Scheduler's own retries re-run the sweep minutes
 * later, which on a 429 is exactly the budget-burning the ticket forbids (criterion 10). A
 * rate-limited listing reaches `syncSource` as `SourceRateLimitedError`, ends that sweep with
 * the watermark held, and the next scheduled run, six hours on, is the back-off.
 */

export type ReconcileMode = "six-hourly" | "nightly"

/** The six-hourly schedule. Asserted against `amplify/functions/reconcile-sweep/resource.ts` by the synth test. */
export const RECONCILE_INTERVAL_HOURS = 6

/** The nightly run's UTC hour: 04:00 EDT / 03:00 EST, off the six-hourly grid (00, 06, 12, 18). */
export const NIGHTLY_UTC_HOUR = 8

/** CloudWatch namespace for the per-sweep metrics, and the alarm's. */
export const RECONCILE_METRIC_NAMESPACE = "LostSoles/Reconcile"

/**
 * THE THREE NUMBERS PER SWEEP (criterion 7). `SweepEnqueued` is the one that matters: on a
 * healthy system the webhook has already put a receipt down, so the sweep finds everything
 * `AlreadyPresent` and enqueues nothing. Non-zero means a webhook did not arrive.
 */
export const RECONCILE_METRICS = {
  seen: "SweepSeen",
  enqueued: "SweepEnqueued",
  alreadyPresent: "SweepAlreadyPresent",
} as const

export interface ReconcileResult {
  mode: ReconcileMode
  seen: number
  enqueued: number
  alreadyPresent: number
  /** Connections whose sweep did not complete. Their watermark did not move. */
  failed: number
  /** Connections needing a reconnect; nothing was listed for them. */
  reconnect: number
  outcomes: SourceSyncOutcome[]
}

export interface ReconcileDeps {
  /** Who to sweep. The owner allowlist: one user today (`lib/auth/owner-ids.ts`). */
  userIds?: readonly string[]
  sources?: () => SourceId[]
  /** Status lookup, so a disconnected or broken connection is skipped before any listing. */
  accountStatus?: (userId: string, sourceId: SourceId) => Promise<string | null>
  /** The pieces of `SyncDeps` the Lambda supplies: the receipt client and the queue. */
  receipt: SyncDeps["receipt"]
  enqueue: SyncDeps["enqueue"]
  /** Test seams over the per-connection wiring. Default to the real store and adapter. */
  syncDepsFor?: (userId: string, sourceId: SourceId) => Omit<SyncDeps, "receipt" | "enqueue" | "window">
  /** Where the metric line goes. Defaults to stdout, as CloudWatch Embedded Metric Format. */
  emit?: (line: string) => void
  now?: () => Date
}

const defaultSyncDepsFor = (userId: string, sourceId: SourceId) => ({
  adapter: getAdapter(sourceId),
  credentials: oauthCredentialsFor({ userId, source: sourceId }),
  readWatermark: () => readListSinceWatermark(userId, sourceId),
  advanceWatermark: (watermark: string) => advanceListSinceWatermark({ userId, sourceId, watermark }),
})

const defaultAccountStatus = async (userId: string, sourceId: SourceId) =>
  (await getSourceAccountSummary(userId, sourceId))?.status ?? null

/** The handler's reading of its event: `{ mode: "nightly" }` from the nightly schedule, anything else six-hourly. */
export function modeOf(event: unknown): ReconcileMode {
  return (event as { mode?: unknown } | null | undefined)?.mode === "nightly" ? "nightly" : "six-hourly"
}

export async function runReconcileSweep(mode: ReconcileMode, deps: ReconcileDeps): Promise<ReconcileResult> {
  const userIds = deps.userIds ?? OWNER_USER_IDS
  const sources = deps.sources ?? connectableSources
  const accountStatus = deps.accountStatus ?? defaultAccountStatus
  const syncDepsFor = deps.syncDepsFor ?? defaultSyncDepsFor

  const result: ReconcileResult = {
    mode,
    seen: 0,
    enqueued: 0,
    alreadyPresent: 0,
    failed: 0,
    reconnect: 0,
    outcomes: [],
  }

  for (const userId of userIds) {
    for (const sourceId of sources()) {
      let outcome: SourceSyncOutcome
      try {
        const status = await accountStatus(userId, sourceId)
        if (status === null || status === "DISCONNECTED") continue
        if (status !== "ACTIVE") {
          outcome = { sourceId, kind: "reconnect" }
        } else {
          outcome = await syncSource(userId, sourceId, {
            ...syncDepsFor(userId, sourceId),
            receipt: deps.receipt,
            enqueue: deps.enqueue,
            ...(deps.now ? { now: deps.now } : {}),
            window: {
              holdWatermarkOnListFailure: true,
              ...(mode === "nightly" ? { minLookbackSeconds: NIGHTLY_OVERLAP_SECONDS } : {}),
            },
          })
        }
      } catch (error) {
        /**
         * `syncSource` returns its failures as values; what lands here is the status read or
         * the watermark read/write. Counted, not thrown, for the reason in the header.
         */
        outcome = {
          sourceId,
          kind: "failed",
          queued: 0,
          detail: error instanceof Error ? error.name : "unknown error",
        }
      }
      tally(result, outcome)
    }
  }

  ;(deps.emit ?? writeStdout)(metricLine(result, deps.now?.() ?? new Date()))
  log.info("reconcile sweep complete", {
    mode,
    seen: result.seen,
    enqueued: result.enqueued,
    alreadyPresent: result.alreadyPresent,
    failed: result.failed,
    reconnect: result.reconnect,
  })
  return result
}

function tally(result: ReconcileResult, outcome: SourceSyncOutcome): void {
  result.outcomes.push(outcome)
  switch (outcome.kind) {
    case "queued":
      result.enqueued += outcome.queued
      result.alreadyPresent += outcome.alreadyKnown
      result.seen += outcome.queued + outcome.alreadyKnown
      return
    case "failed":
      result.failed += 1
      result.enqueued += outcome.queued
      result.alreadyPresent += outcome.alreadyKnown ?? 0
      result.seen += outcome.queued + (outcome.alreadyKnown ?? 0)
      return
    case "reconnect":
      result.reconnect += 1
      return
    case "nothing-new":
    case "not-connected":
      return
  }
}

/**
 * ONE EMBEDDED-METRIC-FORMAT LINE PER SWEEP. CloudWatch Logs turns it into the three metrics
 * with no `PutMetricData` call and therefore no IAM grant and no SDK client.
 *
 * NO DIMENSIONS, deliberately: both modes write the same three metrics, so the alarm reads one
 * series rather than summing two. The mode rides along as a property, readable in the log.
 *
 * Emitted on EVERY sweep, zeros included. A daily sum then always has a datapoint, so a quiet,
 * healthy day reads as 0 rather than as missing data.
 */
export function metricLine(result: ReconcileResult, now: Date): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: RECONCILE_METRIC_NAMESPACE,
          Dimensions: [[]],
          Metrics: [
            { Name: RECONCILE_METRICS.seen, Unit: "Count" },
            { Name: RECONCILE_METRICS.enqueued, Unit: "Count" },
            { Name: RECONCILE_METRICS.alreadyPresent, Unit: "Count" },
          ],
        },
      ],
    },
    mode: result.mode,
    [RECONCILE_METRICS.seen]: result.seen,
    [RECONCILE_METRICS.enqueued]: result.enqueued,
    [RECONCILE_METRICS.alreadyPresent]: result.alreadyPresent,
  })
}

/**
 * `process.stdout.write`, not `log.info`: the line must be the EMF object and nothing else, so
 * it bypasses the logger's rendering (and its redaction, which has nothing to redact in three
 * counts and a mode). The Node runtime writes it to the log stream unprefixed.
 */
function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`)
}
