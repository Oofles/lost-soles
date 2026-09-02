---
id: 117
slug: mvp-definition-of-done-sweep
title: MVP definition-of-done sweep — evaluate every box in roadmap §9 objectively
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [101, 105, 106, 111, 112, 113, 114, 115, 116]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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
in one tap each. `/tickets` and `/dev/tickets` capture work. **Nothing built from the OUT list** —
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

**§9.5 The product, on the actual device** — the operator's own Android phone (D-124), not a
simulator. The §6.3 frame budget **measured** and met at year-one cell volume. The post-run
sequence completes in **8.4 s ± 0.3 s** and one tap from any beat lands on the end state.
`prefers-reduced-motion` renders the fog static and stops the rAF loop. The §9.6 reality-check
table passes. Gold only as fill or rule, or as type at ≥24sp or on navy; all floating chrome
opaque (D-148). **Street names legible in both modes at planning zoom — atmosphere never cost
legibility (D-051, non-negotiable).**

## Acceptance criteria

- [ ] Every box in §9.1–§9.5 is evaluated and recorded in
      `docs/capabilities/18-mvp-hardening.md` with its **evidence**: the command and its exit
      code, the file path, the two numbers compared, or the date the physical act was performed.
- [ ] No box is recorded as passing on the basis of a memory, a screenshot from an earlier build,
      or another ticket's checkbox — each is re-evaluated against the shipping build.
- [ ] The OUT-list grep is run and its empty output pasted: no combat, encounter, boss, route-plan,
      equipment or loot module exists.
- [ ] The seven skills are listed with their `xp-rules-v1.yaml` row and their rendered `/skills`
      entry, side by side.
- [ ] The four drill numbers are present in `docs/capabilities/16-rebuild-drill.md` and are quoted
      here — if they are absent there, this sweep **fails**, and no other evidence substitutes.
- [ ] The post-run sequence is timed on the device three times; all three fall within 8.4 s ± 0.3 s
      and the three measurements are recorded.
- [ ] The frame budget is measured at year-one cell volume (not at today's volume) and the number
      recorded against the `05-fog-of-war.md` §6.3 target.
- [ ] Any box that fails gets a new ticket, linked from the sweep, and this ticket stays open until
      every box is either checked or has a linked, closed ticket. **A failing box is not annotated
      into a pass.**
- [ ] §9.6 is transcribed into the capability doc verbatim as the closing line of the MVP record.

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

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

Do the device half in one sitting, outdoors, on the operator's own Android phone, on a day you
actually ran. Finish a run, put the phone away, and take it out cold: the run must already be on
the map with no action from you. Watch the post-run sequence with a stopwatch, three times, and
write the three times down. Long-press to atlas and read three street names in sunlight, then long-
press back and read the same three. Open `/skills` and count seven. Open `/log` and record a set
of pushups in one tap. Open `/dev/tickets` and capture a ticket in under fifteen seconds. Then sit
down at the laptop and run every command in the checklist, pasting real output — not "passes" —
into the capability doc. When every box carries evidence rather than a tick, the MVP is built.
