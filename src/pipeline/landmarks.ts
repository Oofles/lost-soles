import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb"

import { lanternPath } from "@/lib/run-moment/lantern-path"
import type { RuleCurve } from "@/src/rules/schema"
import { FLOOR_ACTIVITY_ID } from "@/src/scoring/ledger"
import { placesCrossed, type PlaceKind } from "@/src/scoring/places"

import { amplifyMetadata } from "./persist"
import type { RouteTraceGeometry } from "./route-trace-store"
import { REPLAY_ACTIVITY_ID } from "./xp-replay"

/**
 * LANDMARKS — WHERE A PLACE-BOUND MILESTONE WAS EARNED. Ticket `0248`. `04` §4.3; D-020, D-135, D-301.
 *
 * ─── IN THE TRANSACTION THAT COMMITS THE CROSSING ───────────────────────────
 *
 * A landmark is a consequence of XP, so it commits with the XP or not at all. Written after the
 * transaction, a crash between the two would lose it for good: the redelivery finds the activity
 * already scored and awards nothing, so nothing would cross again.
 *
 * ─── WRITE-ONCE, WITHOUT A CONDITION ────────────────────────────────────────
 *
 * Every attribute is `if_not_exists`, keyed on `(userId, skillId#level)`. The first crossing is the
 * one kept, and a later write of the same key changes nothing — a redelivery, a re-ingest, a kind
 * correction that re-crosses, a ruleset replay that moves the crossing to another run. That is
 * D-020's rule for the map applied to the thing on it: a landmark never moves and never un-happens.
 * A `ConditionExpression` would say the same thing but CANCEL the whole transaction when the row
 * exists, and the XP would go with it.
 *
 * ─── THE PLACE (D-301) ──────────────────────────────────────────────────────
 *
 * The route walked by the threshold's share of this activity's XP for the skill — the arc the
 * level-up card flies to (D-297), through the same `lanternPath`, so the cairn stands where the card
 * landed. No route (a manual or strength log, a trace §2.2 left nothing of): `lng`/`lat` are null.
 * The milestone is still recorded; it is listed without `→ fly to`.
 *
 * No skill id is named here (D-031): the levels are `PLACE_LEVELS`.
 */

export const LANDMARK_TYPENAME = "Landmark"

type TransactItems = NonNullable<TransactWriteCommandInput["TransactItems"]>

export interface LandmarkRecord {
  userId: string
  skillId: string
  level: number
  place: PlaceKind
  activityId: string
  /** The crossing activity's `startedAt` (I-12). */
  earnedAt: string
  lng: number | null
  lat: number | null
}

export const landmarkKey = (skillId: string, level: number) => `${skillId}#${level}`

/**
 * The landmarks one activity's XP crosses, from each skill's XP before it and the XP it adds.
 * `route` is a thunk so a caller that must fetch it (the kind re-score) only does when something
 * was actually crossed — almost never.
 */
export async function landmarksCrossed(args: {
  userId: string
  activity: { activityId: string; startedAt: string }
  /** Per skill: what the level is computed from before this activity (`displayedXp`). */
  before: ReadonlyMap<string, number>
  gained: ReadonlyMap<string, number>
  curve: Pick<RuleCurve, "maxLevel" | "stepFormula">
  route: RouteTraceGeometry | null | (() => Promise<RouteTraceGeometry | null>)
}): Promise<LandmarkRecord[]> {
  const { userId, activity, before, gained, curve } = args
  const crossed = [...gained].flatMap(([skillId, xp]) =>
    placesCrossed(before.get(skillId) ?? 0, xp, curve).map((c) => ({ skillId, ...c })),
  )
  if (crossed.length === 0) return []
  const route = typeof args.route === "function" ? await args.route() : args.route
  const path = lanternPath(route)
  return crossed.map(({ skillId, level, place, arc }) => {
    const at = path ? path.at(arc) : null
    return {
      userId,
      skillId,
      level,
      place,
      activityId: activity.activityId,
      earnedAt: activity.startedAt,
      lng: at ? at[0] : null,
      lat: at ? at[1] : null,
    }
  })
}

/**
 * One write-once landmark, as a transaction item. See the header. `recordedAt` is the writer's
 * `ingestedAt` (or the backfill's run), for Amplify's `createdAt` — audit only.
 */
export function landmarkUpdateItem(landmark: LandmarkRecord, recordedAt: string, table: string): TransactItems[number] {
  const fields = landmarkFields(landmark, recordedAt)
  const names = Object.keys(fields)
  return {
    Update: {
      TableName: table,
      Key: landmarkItemKey(landmark),
      UpdateExpression: "SET " + names.map((_, i) => `#f${i} = if_not_exists(#f${i}, :v${i})`).join(", "),
      ExpressionAttributeNames: Object.fromEntries(names.map((n, i) => [`#f${i}`, n])),
      ExpressionAttributeValues: Object.fromEntries(names.map((n, i) => [`:v${i}`, fields[n]])),
    },
  }
}

/**
 * The same row as a CREATE CONDITIONED ON ABSENCE, for a rebuild into a new, empty table (`0302`,
 * D-408). Attribute for attribute what `landmarkUpdateItem` leaves on a fresh key, so a rebuilt
 * landmark is the live one's twin; the condition makes a target that already holds the key refuse
 * the write rather than keep an older row in silence.
 */
export function landmarkPutItem(landmark: LandmarkRecord, recordedAt: string, table: string) {
  return {
    TableName: table,
    Item: { ...landmarkItemKey(landmark), ...landmarkFields(landmark, recordedAt) },
    ConditionExpression: "attribute_not_exists(userId)",
  }
}

const landmarkItemKey = (landmark: LandmarkRecord) => ({
  userId: landmark.userId,
  skillLevel: landmarkKey(landmark.skillId, landmark.level),
})

function landmarkFields(landmark: LandmarkRecord, recordedAt: string): Record<string, unknown> {
  const meta = amplifyMetadata(landmark.userId, recordedAt, LANDMARK_TYPENAME)
  return {
    __typename: meta.__typename,
    owner: meta.owner,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    skillId: landmark.skillId,
    level: landmark.level,
    place: landmark.place,
    activityId: landmark.activityId,
    earnedAt: landmark.earnedAt,
    lng: landmark.lng,
    lat: landmark.lat,
  }
}

/** A ledger row, as much as the walk needs. */
export interface WalkRow {
  skillId: string
  activityId: string
  xpAwarded: number
  /** `<startedAt>#<activityId>#<nn>` — replay order (`ledgerSeq`). */
  seq: string
}

/** A crossing the walk found: which activity's XP carried which skill past which level, and where. */
export interface LedgerCrossing {
  skillId: string
  level: number
  place: PlaceKind
  activityId: string
  /** The activity's `startedAt`, from its `seq`. */
  earnedAt: string
  arc: number
}

/**
 * THE BACKFILL'S HALF (`0248`'s last criterion). Walks a user's whole ledger in `seq` order —
 * activity time, as the replay does — and returns every place-bound crossing with the activity
 * whose XP made it. Every row counts toward the sum, all versions, as D-290's sheet sums them.
 *
 * A crossing made by a row that belongs to no activity (a D-135 floor, a replay's audit row) is
 * NOT returned: it has no activity to name and no route to stand on. It still counts toward the
 * sum, so the levels after it are right. Pure; `tools/landmarks/backfill-landmarks.ts` does the I/O.
 */
export function landmarksFromLedger(
  rows: readonly WalkRow[],
  curve: Pick<RuleCurve, "maxLevel" | "stepFormula">,
): LedgerCrossing[] {
  const ordered = [...rows].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
  /** Per skill, the activities in order with their summed XP. */
  const bySkill = new Map<string, { activityId: string; earnedAt: string; xp: number }[]>()
  for (const r of ordered) {
    const steps = bySkill.get(r.skillId) ?? []
    const last = steps[steps.length - 1]
    if (last && last.activityId === r.activityId) last.xp += r.xpAwarded
    else steps.push({ activityId: r.activityId, earnedAt: r.seq.split("#")[0]!, xp: r.xpAwarded })
    bySkill.set(r.skillId, steps)
  }
  const nowhere = new Set([FLOOR_ACTIVITY_ID, REPLAY_ACTIVITY_ID])
  const out: LedgerCrossing[] = []
  for (const [skillId, steps] of bySkill) {
    let sum = 0
    for (const s of steps) {
      if (!nowhere.has(s.activityId)) {
        for (const c of placesCrossed(sum, s.xp, curve)) out.push({ skillId, activityId: s.activityId, earnedAt: s.earnedAt, ...c })
      }
      sum += s.xp
    }
  }
  return out
}

/**
 * THE BACKFILL, END TO END BUT FOR THE I/O (`0302`). The ledger walk, then each crossing placed on
 * its activity's stored route at the threshold's arc. `route` is asked only for an activity that
 * crossed something. One function, so `tools/landmarks/backfill-landmarks.ts` (live, or a drill
 * target) and the drill's step 6 (`rebuild-drill-back.ts`) cannot place a landmark differently.
 */
export async function backfillLandmarks(args: {
  userId: string
  rows: readonly WalkRow[]
  curve: Pick<RuleCurve, "maxLevel" | "stepFormula">
  route: (activityId: string) => Promise<RouteTraceGeometry | null>
}): Promise<LandmarkRecord[]> {
  const out: LandmarkRecord[] = []
  for (const c of landmarksFromLedger(args.rows, args.curve)) {
    const path = lanternPath(await args.route(c.activityId))
    const at = path ? path.at(c.arc) : null
    out.push({
      userId: args.userId,
      skillId: c.skillId,
      level: c.level,
      place: c.place,
      activityId: c.activityId,
      earnedAt: c.earnedAt,
      lng: at ? at[0] : null,
      lat: at ? at[1] : null,
    })
  }
  return out
}
