/**
 * THE BROWSER'S READS FOR `/skills`. Ticket 0073; same-origin since `0331` (D-472).
 *
 * `SkillState` comes through `/log`'s `fetchSkills` — one call, one cache key, so the two pages
 * can never show different standings. What is added here is what only the panel needs:
 *
 * - **Recent sessions** for the `NEXT` line: the newest ledger rows across every skill, from
 *   `XpLedgerEntry`'s `byUserAndSeq` index (GSI2), newest activity first and bounded
 *   (`LEDGER_ROWS`). Never the whole ledger.
 *
 *   Not `bySkill` (GSI3): NEXT wants the newest sessions across every skill, and GSI3 is one
 *   skill's history.
 * - **`Profile.replayInProgress`**, `0066`'s read-side gate (`02` §4.4 step 1).
 * - **One skill's ledger and landmarks**, for its sheet, and every landmark for the home map.
 *
 * Every call is a `GET` to this app's own `/api/skills/*` routes, which run as the SSR compute and
 * key each read by the session (`lib/skills/server.ts`). The `uid` parameters are kept so no caller
 * changed, and are NOT sent: the server never takes a user id from the browser (`08` §5.3).
 */

import { sameOriginJson } from "@/lib/http/same-origin-json"

import type { DetailLedgerRow, LandmarkRow } from "./detail"
import type { SkillLedgerRow } from "./next"
import {
  SKILL_PARAM,
  SKILLS_LANDMARKS_PATH,
  SKILLS_LEDGER_PATH,
  SKILLS_PROFILE_PATH,
  type ProfileFlags,
} from "./wire"

export { LEDGER_ROWS } from "./wire"

const forSkill = (path: string, skillId: string) => `${path}?${new URLSearchParams({ [SKILL_PARAM]: skillId })}`

/** The user's newest ledger rows, newest activity first, at most `LEDGER_ROWS`. */
export async function fetchRecentLedger(uid: string): Promise<SkillLedgerRow[]> {
  void uid // never sent: the route reads the session (see the header)
  return sameOriginJson<SkillLedgerRow[]>(SKILLS_LEDGER_PATH)
}

/** `Profile.replayInProgress`. `false` for a user with no Profile row yet. */
export async function fetchReplayInProgress(uid: string): Promise<boolean> {
  void uid // never sent
  return (await sameOriginJson<ProfileFlags>(SKILLS_PROFILE_PATH)).replayInProgress === true
}

/**
 * ONE SKILL'S WHOLE LEDGER, for its detail sheet (0074): `bySkill` (GSI3), every ruleset version,
 * unordered — `skillDetail` sorts by `seq`, which is activity time; GSI3's sort key is ingest time.
 *
 * Whole rather than ten rows because the sheet COUNTS what it does not list (`… n more`) and its
 * total must equal the bar (I-15).
 */
export async function fetchSkillLedger(_uid: string, skillId: string): Promise<DetailLedgerRow[]> {
  return sameOriginJson<DetailLedgerRow[]>(forSkill(SKILLS_LEDGER_PATH, skillId))
}

/** ONE SKILL'S LANDMARKS (`0248`, D-301). Two rows at most, ever. */
export async function fetchLandmarks(_uid: string, skillId: string): Promise<LandmarkRow[]> {
  return sameOriginJson<LandmarkRow[]>(forSkill(SKILLS_LANDMARKS_PATH, skillId))
}

/** EVERY `Landmark` the user has, for the home map (`0260`). Two per skill at most; all pages. */
export async function fetchAllLandmarks(uid: string): Promise<LandmarkRow[]> {
  void uid // never sent
  return sameOriginJson<LandmarkRow[]>(SKILLS_LANDMARKS_PATH)
}
