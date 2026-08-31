---
id: 128
slug: restore-npm-ci-in-amplify-yml-once-the-amplify-gen-2-bundled
title: Restore npm ci in amplify.yml once the Amplify Gen 2 bundled-dependency defect is fixed upstream
type: chore
priority: med
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T13:22:07Z
---

## Description

`amplify.yml` installs with `npm install --no-save` instead of the `npm ci` that
`01-architecture.md` §6 specifies. That is **D-162**, and it is a temporary retreat, not a new
preference. This ticket is the way back.

`npm ci` cannot install the Amplify Gen 2 dependency set at all as of 2026-08-31:
`@aws-amplify/data-construct@1.17.7` and `@aws-amplify/graphql-api-construct@1.22.2` ship
internally inconsistent **bundled** dependency trees, and `npm ci` — unlike `npm install` —
validates a bundled subtree strictly and refuses. Full evidence, and the five things that were
tried and did not work, are in D-162.

What is lost meanwhile is real: `npm ci` is what makes a build FAIL when `package.json` and
`package-lock.json` have drifted apart. `--no-save` installs from the lock and leaves it
byte-identical, but it will not shout when they disagree.

## Acceptance criteria

- [ ] The two-line reproduction exits 0. In an empty directory, with
      `{"devDependencies": {"@aws-amplify/backend": "^1.24.0"}}` (or whatever version the project
      is on by then), `npm install && rm -rf node_modules && npm ci` succeeds.
- [ ] Both `amplify.yml` phases are restored to `npm ci --cache .npm --prefer-offline`, matching
      `01-architecture.md` §6 verbatim, and the D-162 comments are removed.
- [ ] `npm ci && npm run build` succeeds from a fresh clone — the criterion 0012 could not meet.
- [ ] A push to `main` produces a green Amplify build with the restored command.
- [ ] D-162 is marked superseded in `docs/decisions/DECISIONS.md`, with the date and the upstream
      version that fixed it. **Do not delete D-162** — the reasoning stays visible.
- [ ] If ticket `0013`'s GitHub Actions PR gate also worked around this, it is reverted in the same
      commit, so the two install paths cannot drift.

## Notes

**How to check cheaply, without doing the whole ticket.** The reproduction is two lines and takes
about a minute; it is worth running at the start of any capability-`02` session rather than waiting
for a scheduled review.

Do not attempt `overrides` again. It was tried and it cannot work in principle: an override rewrites
a dependency *specification*, and the inconsistency here is inside an already-built tarball that npm
unpacks verbatim. Pinning the constructs to their last self-consistent releases made the failure
list longer, not shorter.

Related: this is one of two places the project deviates from the letter of `01-architecture.md` §6.
The other is the branch model — §6 line 952 still describes short-lived `feat/*` branches merged by
PR, which D-150 replaced with trunk-based development. That one is a doc correction, tracked
separately by the capability `02` drift audit (D-153), not here.

## Operator validation

None — this is build configuration with no user-visible surface. The check that matters is the
Amplify console showing a green `main` build after the change, which is already criterion 4.
