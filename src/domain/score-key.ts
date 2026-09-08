import { createHash } from "node:crypto"

import type { Trace } from "./activity"
import { FOG_ALGO_VERSION } from "./discovery"

/**
 * THE SCORE-TIME IDEMPOTENCY KEY. Ticket `0050`. `05-fog-of-war.md` §3.5;
 * `02-data-model.md` T8 (*"two key shapes coexist"*), §5 layer 2.
 *
 * ─── TWO KEYS, TWO MOMENTS, AND THEY ANSWER DIFFERENT QUESTIONS ─────────────
 *
 * The ACCEPT-time key (`01` §4 step 3, `src/adapters/*`) is
 * `sha256("<source>:<owner>:<object>:create")`. It is computed before anything has been
 * fetched, which is the whole point: it kills a redelivery inside the webhook's 2-second budget.
 * It can only ask *"have I seen this activity id?"*
 *
 * This one is computed after `normalize()` and asks a second question the first cannot:
 * *"have I seen this activity id **with this content**?"* `05` §3.5 names the case — the user
 * cropped the activity in the source app, or corrected its start time. Same id, different
 * geometry. The accept gate says duplicate; it is not.
 *
 * ```
 * <source>#<externalId>#<sha256(canonicalJson({points, startedAt})).slice(0,16)>#v<FOG_ALGO_VERSION>
 * ```
 *
 * ─── WHY `FOG_ALGO_VERSION` IS IN IT ────────────────────────────────────────
 *
 * §3.5, verbatim: *"so that a deliberate algorithm change invalidates every key and forces a
 * full, auditable rescore rather than a silent mix of old and new scoring."* Without it, a
 * projection change would leave every already-scored activity looking like a duplicate, and the
 * map would be half computed under each algorithm with nothing recording which cell was which.
 *
 * ─── WHY 16 HEX CHARACTERS IS ENOUGH ────────────────────────────────────────
 *
 * 64 bits, and the collision it would take is not a birthday problem: the hash is scoped by
 * `<source>#<externalId>`, so two payloads only collide if they are two revisions **of the same
 * activity**. A user edits a run a handful of times in its life. At that population a 2^-64
 * per-pair probability is not a risk anyone needs to think about, and §3.5 fixes the length.
 *
 * ─── CANONICAL MEANS BYTE-STABLE, NOT MERELY EQUAL ──────────────────────────
 *
 * `JSON.stringify` preserves insertion order, so two normalizers producing the same points in
 * different key orders would hash differently and every re-import would look like a revision.
 * `canonicalJson` sorts keys at every level and drops `undefined`, so the hash is a function of
 * the VALUES.
 */

/**
 * Deterministic JSON: keys sorted at every depth, `undefined` omitted, no whitespace.
 *
 * Arrays keep their order — that is data here, not presentation: a trace reversed is a
 * different trace, and two traces that differ only in point order must not share a key.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

/** The 16-hex-character content digest §3.5 specifies. */
export function traceDigest(startedAt: string, trace: Trace | undefined): string {
  return createHash("sha256")
    .update(canonicalJson({ points: trace?.points ?? [], startedAt }))
    .digest("hex")
    .slice(0, 16)
}

/** Everything the key reads. A narrow shape so nothing else can drift into it. */
export interface ScoreKeyInput {
  source: string
  externalId: string
  startedAt: string
  trace?: Trace
}

/**
 * `<source>#<externalId>#<digest>#v<FOG_ALGO_VERSION>`, exactly as §3.5 writes it.
 *
 * A NO-GPS ACTIVITY STILL GETS A KEY, and that is §3.6's requirement rather than an accident:
 * *"a ledger entry is still written (with `cellCount: 0`), so the idempotency gate covers no-GPS
 * activities too and re-import stays a no-op."* An absent trace hashes as an empty point list,
 * so two imports of the same treadmill session collide exactly as two imports of a run do.
 */
export function scoreTimeKey(input: ScoreKeyInput): string {
  const digest = traceDigest(input.startedAt, input.trace)
  return `${input.source}#${input.externalId}#${digest}#v${FOG_ALGO_VERSION}`
}

/**
 * Do these two keys name the same activity? True for a REVISION, false for two different runs.
 *
 * §3.5's revision branch turns on exactly this: *"same source id, different content → key
 * misses. This is a revision, not a new activity."* Comparing the first two segments is what
 * tells those apart, and it is a function rather than an inline `split` so the key's shape is
 * only parsed in the file that builds it.
 */
export function sameActivity(a: string, b: string): boolean {
  const head = (key: string): string => key.split("#").slice(0, 2).join("#")
  return head(a) === head(b)
}
