/**
 * Ticket 0230. vitest `globalSetup`: runs once in the main process, around the whole run.
 *
 * Setup and teardown both sweep per-file temp dirs whose worker pid is gone: at setup, what a
 * killed run left; at teardown, what a file that threw at module scope left (it never runs its
 * afterAll). Setup also counts the `cdk.out*` directories in the real temp dir; teardown counts
 * again and FAILS the run if any new one appeared, naming them, so the 0230 leak cannot quietly
 * return. The why is in vitest-tmpdir.mjs.
 */
import { REAL_TMPDIR, cdkOutDirs, sweepStale } from "./vitest-tmpdir.mjs"

export default function setup() {
  // Workers inherit this, so a reused worker still finds the real temp dir after a setup
  // file has rewritten its TMPDIR.
  process.env.LOST_SOLES_REAL_TMPDIR = REAL_TMPDIR
  sweepStale(REAL_TMPDIR)
  const before = new Set(cdkOutDirs(REAL_TMPDIR))

  return function teardown() {
    // A file that threw at module scope skipped its afterAll; its worker is dead by now.
    sweepStale(REAL_TMPDIR)
    const added = cdkOutDirs(REAL_TMPDIR).filter((n) => !before.has(n))
    if (added.length > 0) {
      throw new Error(
        `ticket 0230: this run left ${added.length} new cdk.out* director${added.length === 1 ? "y" : "ies"} ` +
          `in ${REAL_TMPDIR}: ${added.join(", ")}. A synth wrote outside the per-file TMPDIR ` +
          `that scripts/vitest-setup-tmpdir.mjs sets. (Or another checkout running an older ` +
          `suite wrote them concurrently.)`,
      )
    }
  }
}
