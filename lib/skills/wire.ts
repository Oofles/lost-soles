/**
 * THE SKILLS ROUTES' PATHS AND BOUNDS, shared by the browser and the server. Ticket `0331`, D-472.
 *
 * Browser-safe: no AWS import. `lib/skills/transport.ts` fetches these paths and
 * `lib/skills/server.ts` answers them; both read the bound from here so they cannot disagree.
 */

/**
 * How many of the newest ledger rows are read. A session is one to five rows (one per skill and
 * reason), so this covers the last ~100 activities: every skill trained in that window gets its
 * trailing median, and one not trained in it gets no estimate, which is honest.
 */
export const LEDGER_ROWS = 500

/** `fetchSkills`: the user's `SkillState` rows. */
export const SKILLS_STATE_PATH = "/api/skills/state"
/** The newest `LEDGER_ROWS` ledger rows; with `?skill=<id>`, that one skill's whole ledger. */
export const SKILLS_LEDGER_PATH = "/api/skills/ledger"
/** `Profile.replayInProgress`. */
export const SKILLS_PROFILE_PATH = "/api/skills/profile"
/** Every landmark; with `?skill=<id>`, that skill's. */
export const SKILLS_LANDMARKS_PATH = "/api/skills/landmarks"
/** The query parameter naming one skill. A skill id, never a user id. */
export const SKILL_PARAM = "skill"

/** `GET /api/skills/profile`'s body. */
export interface ProfileFlags {
  replayInProgress: boolean
}
