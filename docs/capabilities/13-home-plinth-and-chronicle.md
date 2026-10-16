# 13-home-plinth-and-chronicle

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`13-home-plinth-and-chronicle\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0086` — The plinth over the map — Total Level, cells revealed, last run, three destinations
- `0087` — Home screen states — cold start, nothing imported, sync in progress, sync failed, offline
- `0088` — /chronicle — the run list as a sheet dragged up from the plinth
- `0089` — /settings — connect/disconnect source, sign out, account deletion entry point
- `0090` — Derived stats feed — per-run territory counts, lifetime totals, and the frontier primitive

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-16.*

**Fourteen tickets, five planned.** The five (`0086`–`0090`) shipped as designed once `0187` had
rewritten `06` §1–§2 for a desktop viewing surface. That pass is what made a 24rem left rail the
plinth (D-313) rather than the phone card the roadmap assumed. The other nine came from three
places. One was a pre-capability chore (`0215`). The operator's looks asked for two things: the skills quick-view (`0270`)
and swipe-down on sheets (`0249`). Wave smoke tests found five bugs (`0273`, `0274`, `0276`, `0277`,
`0278`). Three waves ran on 2026-10-15, plus this audit on the 16th. That is about four
sessions against the five that D-151's one-to-three-tickets-per-session pace implied. Running waves (D-312) is what made
up the difference.

**What the design got right, non-obviously.** Every home-screen state is data into `plinthModel` and
the home fog rule, and no state draws chrome of its own (`0087`). That made five states one
renderer and kept every new state (D-319's hold, D-333's pending frame) inside a pure function.
The route group that mounts the map once under `/` and `/chronicle` (D-322) meant the Chronicle
never moves the camera, at no cost. Building the counts feed off the stored columns with no cell set
(`0090`, D-328) made "three screens agree" structural rather than tested.

**What it got wrong.** The roadmap and `06` §2.4 described a phone. A "sync failed" state was
designed for a screen that, under D-013, must never show one (D-318). And D-324 put a meaning-bearing
mark in `--gold-500`, which D-291 had already forbidden. The audit caught it; the operator picked
`--gold-700` (D-335).

**Divergences: about thirty found, far over the budget of three, so a DESIGN pass ran before
recording** (`AUDIT.md` §2). Three readers re-read the eighteen cited sections in parallel. As in
`09`–`12`, nearly all were decisions taken during the capability (D-313–D-334) that never reached the
sections they changed: `06` §1.2, §2.2's wireframe and rows 3/7/11, §2.4's states table, §3.2's
Example A numbers, §8.3's token table, `09`'s capability row, `05` §8.2–§8.3, `04` §8.2's mockup,
and `08` §6.4/§6.5. The disconnect wording in `08` and the Cognito step order predate the
capability. The pass amended all of them. It recorded D-335 (gold-700 unseen mark), D-336 (the frontier
line's best-scored rule and thresholds), D-337 (reconnect caption placement), D-338 (§8.7's
durations exempt the §3.2 sequence), D-339 (scroll restore by entry key, superseding part of D-321)
and D-340 (area and frontier length built, unrendered, amending D-329). Comment-only staleness in
`app/routes.test.ts`, `lib/sheet/swipe-dismiss.ts` and `lib/plinth/connections.ts` was fixed in
place. Two were the code's fault and are filed here: `0279` (the unseen mark's colour) and `0280`
(radii, pulse and fly timing, a line-height and a glyph off §8's scales). A third finding, the Sync
action querying a failed-receipt count nobody reads, is not drift. It is filed as `0281` under `14`,
which replaces that button.

**§3.** Every ticket has a dated operator report or an agent smoke test against the deployed app,
and every perceptual check was answered before close. The previous reflection asked for that, and
it held. `0086`'s two-week D-013 test was substituted by refusal tests, which is the right reading
of D-229. The USE step is not formally owed here, but the operator looked at the plinth, the
Chronicle and the counts on real data, with a backfilled account. Fog and XP baselines held:
1352 cells and generation 135, nothing lower.

**§5 cost.** Spend is over D-083. September was $50: $28.78 of Business Support, since gone,
and $18.73 of Amplify build minutes. October to the 15th is $14.10, $12.55 of it Amplify. That is
known: `0214` added the skip token (D-311), and `0268` measures the saving on 2026-10-29. If it falls
well short, build minutes are the next capability's cost problem. No NAT gateway.

**What the next capability should do differently.** The `12` reflection's first rule ("amend the cited
section in the same commit as the D-xxx") was not followed here either. That is five capabilities
running. Rules in a reflection do not work. Make it mechanical instead: when a closing ticket's
Resolution names a new D-xxx, `tickets.mjs close` should require that the commit also touches a
`docs/NN-*.md` file, or take an explicit `--no-doc-change "<reason>"`. Worth a ticket before `14`
starts.

