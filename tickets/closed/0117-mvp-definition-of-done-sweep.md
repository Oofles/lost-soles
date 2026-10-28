---
id: 117
slug: mvp-definition-of-done-sweep
title: MVP definition-of-done sweep — evaluate every box in roadmap §9 objectively
type: chore
priority: high
status: closed
size: m
capability: 18-mvp-hardening
depends_on: [101, 105, 106, 112, 113, 114, 115, 116, 175, 216, 259, 268, 275, 290, 297, 303, 308, 309, 310, 311, 312, 315, 316, 317, 318, 319]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-27T02:37:51Z
closed: 2026-10-28T01:35:34Z
---

## Description

**The last ticket in the MVP backlog.** Walk `09-roadmap.md` §9 and evaluate every box.

Every box there is objectively evaluable — *a command that exits zero, a file that exists, a
number that matches, or a physical act performed.* Nothing reads "feels good", and nothing may be
closed on the strength of a recollection. This ticket is the one that walks the list.

**§9.1 Scope — D-122, exactly.** A real Strava run imports and reveals territory that persists
across sessions and deploys. Both map modes exist, toggle, and render an identical revealed set.
All **seven** MVP skills exist as rows in `xp-rules-v1.yaml` and appear on `/skills`: Wayfaring,
Vigil, Might, Fortitude, Endurance, Cartography, Constitution. XP and levels computed and
displayed, Total Level and Total XP on the home screen. `/log` records pushups, situps and planks
in one tap each. ~~`/tickets` and `/dev/tickets` capture work.~~ *(D-252, 0215)* **Nothing built from the OUT list** —
no combat, no encounters, no boss quests, no route planning, no equipment, no loot — verified by
grep for the *absence* of those modules.

**§9.2 Invariants — mechanically checked.** Confirm 0116's table is complete and green, including
I-1…I-26 each having a test or a written reason.

**§9.3 Reversibility — the D-101 / D-121 proof.** Every ingested activity has a raw object at
`raw/<uid>/<source>/<externalId>/<sha256>.<ext>` written **before** normalize, object count equal
to activity count. `normalize()` passes with `fetch` and `Date.now` stubbed to throw. The CI
rebuild drill runs on every build. **The full drill has been executed once, for real, and its four
numbers are pasted into `docs/capabilities/16-rebuild-drill.md`** (0105).
`snapshots/skillstate/` is being written (D-143). The account-deletion runbook has been executed
against a throwaway account (0106).

**§9.4 Operational.** `https://soles.devaultsecurity.com` over valid TLS. A run finished on the
phone appears on the map **with no user action** (D-013) — the Sync button may remain as a manual
fallback but must not be the only path. `token-refresh` and `nightly-reconcile` have each run
successfully on schedule at least once. A poisoned message lands in the DLQ and is visible.
Cognito self-signup OFF, unauthenticated identities OFF. No secret in the client bundle. gitleaks
passes on full history; O-005 rotated and gitignored. Billing alarm at $10/month and one month of
real billing at or under the D-083 target.

**§9.5 The product, in the desktop browser** on the real deployed app (D-240, D-251). The §6.3
frame budget **measured** and met at year-one cell volume. The post-run sequence completes in
**8.4 s ± 0.3 s** and one tap from any beat lands on the end state. `prefers-reduced-motion`
renders the fog static and stops the rAF loop. The desktop-applicable §9.6 rows pass (token
expired, three weeks away, slow/no connection, 200% zoom, screen reader); the phone-physical rows
are dropped (D-251). Gold only as fill or rule, or as type at ≥24sp or on navy; all floating
chrome opaque (D-148). **Street names legible in both modes at planning zoom — atmosphere never
cost legibility (D-051, non-negotiable).**

## Acceptance criteria

- [x] Every box in §9.1–§9.5 is evaluated and recorded in
      `docs/capabilities/18-mvp-hardening.md` with its **evidence**: the command and its exit
      code, the file path, the two numbers compared, or the date the physical act was performed.
      *(2026-10-26, agent: every box has a row with evidence. Not ticked, because five rows still
      wait on the operator: the 8.4 s timing, and narration, D-148 gold and street names judged by
      eye. See the doc's "Not yet green" table.)* — verified 2026-10-27: the timing and the
      three perceptual rows passed by the operator; every row now carries evidence.
- [x] No box is recorded as passing on the basis of a memory, a screenshot from an earlier build,
      or another ticket's checkbox — each is re-evaluated against the shipping build.
- [x] The OUT-list grep is run and its empty output pasted: no combat, encounter, boss, route-plan,
      equipment or loot module exists.
- [x] The seven skills are listed with their `xp-rules-v1.yaml` row and their rendered `/skills`
      entry, side by side.
- [x] The four drill numbers are present in `docs/capabilities/16-rebuild-drill.md` and are quoted
      here — if they are absent there, this sweep **fails**, and no other evidence substitutes.
- [x] The post-run sequence is timed in the desktop browser three times; all three fall within 8.4 s ± 0.3 s
      and the three measurements are recorded.
      *(2026-10-26, agent: not done. It needs a signed-in session on the deployed app. Making one
      for a harness is a Cognito write, which a wave agent may not do. The operator's console
      method is in the Resolution.)* — verified 2026-10-27: operator, desktop browser, deployed
      app, three Relives: `sequence` 8,405 / 8,405 / 8,405 ms (`cards` 0), all within 8,100–8,700.
- [x] The frame budget is measured at year-one cell volume (not at today's volume) and the number
      recorded against the `05-fog-of-war.md` §6.3 target.
- [x] Any box that fails gets a new ticket, linked from the sweep, and this ticket stays open until
      every box is either checked or has a linked, closed ticket. **A failing box is not annotated
      into a pass.**
      *(2026-10-26, agent: three boxes fail as worded: Total XP on home, the raw object count, and
      the billing alarm. A wave agent cannot create tickets, so each is a proposal in the report.
      Each is also partly a design question (D-152). This stays open until the operator decides.)*
      — verified 2026-10-27: the operator decided all three as design questions, not code bugs, so
      no ticket was filed. Each box was amended by a recorded decision (D-462, D-463, D-464) and
      passes as amended. None was annotated into a pass as worded.
- [x] §9.6 is transcribed into the capability doc verbatim as the closing line of the MVP record.

## Notes

**The standing conditions do not close with the MVP.** Carry them forward, in `CLAUDE.md` and in
the capability doc: **any share, export or screenshot feature reopens D-123**, at proposal time,
and **adding a second user account triggers the same gate** — with the five things that must be
built first (owner-scoping tests, a fidelity field, a consent screen, a working delete, a recorded
successor decision). Post-MVP work starts with those gates already armed, not with a fresh
argument about whether they apply.

And §9.6, which is the reason this checklist must not be mistaken for success: `00-vision.md` §5
names **S1 — six-month retention** as the only test that really matters, and it cannot be
evaluated at ship. **This list defines when MVP is built. It does not define when Lost Soles has
worked.** That is settled six months later, by whether the user is still opening it.

**2026-10-26 — runs last** (operator, wave 18.3): with the greedy planner (0312), 0117 would have run in the next wave. The sweep evaluates the capability's end state, so it now depends on every other open capability-18 ticket. Add any ticket filed into 18 later to this list as well.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

Do the product half in the desktop browser. After an ordinary run (D-229 — none is made for
this), open the app: the run must already be on the map with no action from you. Time the post-run
sequence with a stopwatch, three times, and write the three times down. Toggle to atlas and read
three street names, toggle back and read the same three. Open `/skills` and count seven. Open
`/log` and record a set of pushups in one click. ~~Outdoors, on the phone, in sunlight; put the
phone away; capture a ticket on `/dev/tickets`.~~ *(D-251, D-252, 0215)* Then run every command in the checklist,
pasting real output — not "passes" — into the capability doc. When every box carries evidence rather than a tick, the MVP is built.

**Results, 2026-10-27 (operator, desktop browser, the deployed app, signed in):**

- **Post-run timing:** three ⟲ Relives of the latest run, read from `window.__sequence` in the
  console. `sequence` was 8,405 ms each time, `cards` 0, `wall` 8,405. The operator reported the
  same figure on all three; the clock is timer-driven, so identical rounded values are plausible.
  One click mid-sequence landed on the end state.
- **Street names:** the same three names read equally well at z15 in atlas and adventure (`M`).
- **D-148:** gold appears only as fill, rule or large type, and floating chrome is opaque, on `/`,
  `/skills`, `/log` and `/run`.
- **Screen reader:** NVDA reads `/`'s status line and the `/run` narration sensibly.

**Smoke tests (agent):** the evidence for every other box is in the capability doc's sweep tables,
each row with its command and exit code, or its live AWS read, against Amplify job 438.

## Resolution

*(Agent, wave 18.8, 2026-10-26. The ticket stays open: see "What keeps it open".)*

**Every §9.1–§9.5 box is evaluated and recorded, one row each, in
`docs/capabilities/18-mvp-hardening.md` § *The MVP definition-of-done sweep*.** Each was measured
against the shipping build, Amplify job 438 (`d2a5597`). The sweep ran at `5596e50`, which differs
only in `tickets/`. Nothing was copied from an earlier ticket's tick. Two rows rest on dated
physical acts recorded elsewhere, and the row names the act and its date: the full drill
(2026-10-21) and the account deletion (2026-10-20). The DLQ row rests on live CloudWatch alarm
history and SNS delivery metrics from 2026-10-22, read today.

**Result: 32 PASS, 3 FAIL as worded, 1 not measured, 3 perceptual.**

- **FAIL, §9.1:** *Total Level and Total XP on the home screen.* The plinth carries Total Level and
  lifetime cells. That is exactly what `06` §2.3 specifies, and Total XP is on `/skills`' header.
  The roadmap box and the UI design disagree. That is D-152, so the agent did not choose.
- **FAIL, §9.3:** *Object count equals activity count.* The object count is 124 and the activity
  count is 117. Every activity's `raw.key` exists (117/117), and payload prefixes map 1:1 to
  activities. The extra 7 objects are two re-archived payloads and five kind-override records.
  The wording cannot hold while either exists. D-152.
- **FAIL, §9.4:** *A billing alarm at $10/month.* None exists. D-361 removed it on purpose, but
  §9.4 was never amended. The month half passes: September 2026 runtime is at most about $1.9
  (D-433).
- **Not measured, §9.5:** *8.4 s ± 0.3 s, three times.* That needs a signed-in session on the
  deployed app. Creating a throwaway user is a Cognito write (and briefly Trigger A), which a wave
  agent may not do. The one-tap half passes (`exit.test.ts`).
- **Perceptual, §9.5:** screen-reader narration, D-148 gold by eye, and street names by eye. Each
  has its mechanical half measured and passing.

**Measured, not assumed.** The frame budget at year-one volume: R3 as corrected by D-237 puts year
one at most ~207k res-11 cells. Runs at 151k and 501k bracket it, headed on the RTX 5080 through
WSLg (`run-cold-cost.mjs`). Mask mean ≤ 0.72 ms, composite mean ≤ 1.91 ms, pan p50 16.6–16.9 ms,
dropped ≤ 0.4%. Reduced motion: 0 rAF after first paint. 200% zoom: 24/24. Mode parity: equal mask
FNV at three zooms. Street-name contrast over revealed ground: 1.00× stock in both modes. Live data:
the 2026-10-26 13:35Z run arrived by webhook with no action, and generation 270 / 5,224 cells
survived eight deploys. The blob equals the distinct cell table. 6,365/6,365 cell rows carry
`lastRunAt`. SkillState 71,749 = ledger 71,749. 150 snapshots, the latest at generation 270.
token-refresh: 61 clean sweeps. Nightly reconcile: every day at 08:00:35Z.

**Files touched**

- `docs/capabilities/18-mvp-hardening.md`: the sweep section. It has one table per §9 sub-list, the
  seven-skills side-by-side, the OUT-list grep and its empty output, the four drill numbers quoted,
  the D-123 standing conditions carried forward, the "Not yet green" table, and §9.6 verbatim as
  the closing line.
- `tickets/open/0117-mvp-definition-of-done-sweep.md`: criteria ticked or amended, and this section.

No code changed. Scratch scripts lived in the session scratchpad and in gitignored `tmp/`, which was
removed before commit.

**Decisions made:** none. Three are proposed in the wave report, one per failing box.

**`CLAUDE.md` was not edited.** Its standing rule already arms Triggers A, B and C at proposal
time. The one thing the Notes ask for that it lacks is the five build items behind Trigger A. They
are now in the capability doc, and the exact one-line addition for `CLAUDE.md` is in the wave
report for the orchestrator or operator to apply.

**Deferred `0128` and `0178`.** `0128` (`npm ci`) touches no §9 box. `0178` concerns the operator's
view of a real failed import. §9.4's DLQ box is met by the alarm and email, proven live on
2026-10-22, so `0178` does not hold it.

**The operator's timing method** (desktop browser, the deployed app, signed in). Open the latest run,
`/run/<activityId>`, from RUNS, and click **⟲ Relive**. When the end state shows, run this in the
DevTools console:

```js
(s => ({ wall: Math.round(s.end - s.t0), cards: Math.round(s.pausedMs ?? 0), sequence: Math.round(s.end - s.t0 - (s.pausedMs ?? 0)) }))(window.__sequence)
```

`sequence` is the figure to judge against 8,400 ± 300 ms. `cards` is level-up card time, which §3.2
adds on top. Repeat three times and record all three.

## What keeps it open

The doc's *"Not yet green"* table holds five rows. Three need an operator decision (one per failing
box). One needs three console timings. One needs the perceptual checks.

**Orchestrator, 2026-10-27.** The three failing boxes were put to the operator, who chose to amend
each one: D-462 (§9.1 Total XP lives on `/skills`, per `06` §2.3), D-463 (§9.3 is a mapping, not
an equal count) and D-464 (§9.4's alarm half is superseded by D-361). The roadmap boxes carry the
amendments, and the doc's table marks them resolved by decision, not annotated into passes. The
operator also approved the CLAUDE.md sentence carrying Trigger A's five build-first items forward;
the orchestrator applied it. Still open: the three console timings and the perceptual checks.

**Closed 2026-10-27.** The operator's timings and perceptual checks are recorded above and in the
capability doc. Nothing keeps it open.
