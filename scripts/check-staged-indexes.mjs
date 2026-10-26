#!/usr/bin/env node
// Are the two DERIVED indexes current in the STAGED tree? Ticket 0231.
//
//   node scripts/check-staged-indexes.mjs --docs      docs/INDEX.md
//   node scripts/check-staged-indexes.mjs --tickets   tickets/index.json
//
// Both files are committed, both are generated, and CI rejects a stale one
// (gate.yml `build-index.mjs --check`, tickets.yml `tickets.mjs index` + `git
// diff`). For two days in 2026-09 every push to main failed that way, reported
// only by email. This is the same check, moved to .githooks/pre-commit, so the
// refusal arrives in the terminal of whoever made the edit.
//
// THE STAGED TREE, NOT THE WORKTREE — layer 4's rule. The index is what becomes
// history, so the inputs are exported from it (`git checkout-index`) into a
// scratch directory and the generators run THERE. A file regenerated on disk but
// never `git add`ed is still stale in the commit, and still blocks.
//
// THE STAGED GENERATORS, NOT THE WORKTREE'S. CI runs the committed
// build-index.mjs / tickets.mjs, which is the staged copy. Running the worktree's
// would let an unstaged edit to a generator make the two checks disagree, and the
// acceptance criterion is that they never do.
//
// Exit 0: current. Exit 1: stale (the fix is printed). Exit 2: could not check —
// a broken guard, not a pass (D-176), and the hook blocks on it.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const want = { docs: process.argv.includes("--docs"), tickets: process.argv.includes("--tickets") };
if (!want.docs && !want.tickets) {
  console.error("check-staged-indexes: pass --docs and/or --tickets.");
  process.exit(2);
}

const BUILD_INDEX = "scripts/build-index.mjs";
const TICKETS_MJS = ".claude/skills/tickets/scripts/tickets.mjs";

const cantCheck = (what, detail) => {
  console.error(`  ${what} was never checked: ${detail}`);
  return 2;
};

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts });

/** Copy the STAGED content of `paths` (files or directories) into `dir`. */
function exportStaged(dir, paths) {
  const list = git(["ls-files", "-z", "--", ...paths]);
  if (!list) return;
  // --prefix needs the trailing slash, or it is a filename prefix, not a directory.
  git(["checkout-index", "-z", "--stdin", `--prefix=${dir}/`], { input: list });
}

function checkDocs(dir) {
  exportStaged(dir, ["docs", BUILD_INDEX]);
  if (!existsSync(join(dir, BUILD_INDEX))) {
    return cantCheck("docs/INDEX.md", `${BUILD_INDEX} is not in the staged tree.`);
  }
  const r = spawnSync(process.execPath, [join(dir, BUILD_INDEX), "--root", dir, "--check"], {
    encoding: "utf8",
  });
  if (r.status === 0) return 0;
  if (r.status === 1 && /out of date/.test(r.stderr)) {
    console.error(`  docs/INDEX.md is stale in the staged tree — CI's gate would fail on it.
  Fix:  node scripts/build-index.mjs
        git add docs/INDEX.md docs/.index-summaries.json`);
    return 1;
  }
  // Anything else — a crash, a missing docs/contracts — is the generator failing
  // to answer, not a verdict on the index.
  return cantCheck("docs/INDEX.md", `build-index.mjs exited ${r.status}.\n${r.stderr}`);
}

function checkTickets(dir) {
  exportStaged(dir, ["tickets", TICKETS_MJS]);
  if (!existsSync(join(dir, TICKETS_MJS))) {
    return cantCheck("tickets/index.json", `${TICKETS_MJS} is not in the staged tree.`);
  }
  // The staged index.json, read BEFORE regeneration overwrites the exported copy.
  //
  // ABSENT FROM THE STAGE PASSES, because it passes CI, and the acceptance
  // criterion is that the two never disagree. tickets.yml runs `git diff
  // --exit-code tickets/index.json`, which says nothing about an UNTRACKED file —
  // so a commit that deletes index.json is green there. That is a gap in CI, not
  // something to paper over here with a stricter local rule (reported with 0231).
  if (!existsSync(join(dir, "tickets/index.json"))) return 0;
  const staged = readFileSync(join(dir, "tickets/index.json"), "utf8");
  const r = spawnSync(process.execPath, [join(dir, TICKETS_MJS), "index"], {
    encoding: "utf8",
    env: { ...process.env, TICKETS_ROOT: dir },
  });
  if (r.status !== 0) {
    return cantCheck("tickets/index.json", `tickets.mjs index exited ${r.status}.\n${r.stderr}`);
  }
  const fresh = readFileSync(join(dir, "tickets/index.json"), "utf8");
  if (fresh === staged) return 0;
  console.error(`  tickets/index.json is stale in the staged tree — CI's tickets workflow would fail on it.
  Fix:  node ${TICKETS_MJS} index
        git add tickets/index.json`);
  return 1;
}

let worst = 0;
for (const [name, fn] of [["docs", checkDocs], ["tickets", checkTickets]]) {
  if (!want[name]) continue;
  const dir = mkdtempSync(join(tmpdir(), `staged-${name}-`));
  try {
    worst = Math.max(worst, fn(dir));
  } catch (e) {
    worst = Math.max(worst, cantCheck(name === "docs" ? "docs/INDEX.md" : "tickets/index.json", e.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(worst);
