---
id: 215
slug: strip-phone-viewing-criteria-from-open-tickets-after-d-251
title: Strip phone-viewing criteria from open tickets after D-251
type: chore
priority: med
status: closed
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T16:53:19Z
closed: 2026-09-28T17:44:45Z
---

## Description

**D-251 (2026-09-28): the phone is not a viewing surface, and no design or test effort goes into
it.** The operator's words: *"I don't want to spend extra effort and cycles designing and testing
for a phone use case since my computer will be what I use 99% of the time."*

The open backlog was written phone-first, before D-227 and D-251. A grep for `thumb|one-handed|
56dp|sunlight|gloves|android phone|6.8in|touch target|TalkBack` hits about 40 open tickets. Most of
those hits are a stray reference, but a handful are built around the phone:

- `0071` row anatomy
- `0112` accessibility and reality checks
- `0086` the plinth
- `0107` ticket capture sheet
- `0068` the `/log` route

Left in place, each will cost a session an amendment when it is picked up. That happened three
times in a row with `0118`, `0055` and `0056` after D-227. **One sweep now is cheaper than forty
amendments later.**

## Acceptance criteria

- [x] Every open ticket's phone-VIEWING criterion or validation step is removed or restated for the
      desktop browser, ~~with an inline `*(D-251, 0215)*` note~~. A struck line stays visible wherever
      the old wording shaped the design. **Amended:** the note marks only struck, design-shaping
      text. Plain respellings such as "on the Pixel 8 Pro" → "in the desktop browser" carry none,
      because a note on each of roughly 150 one-word swaps would bury the ones that matter. The
      commit `918b12d` is the full record.
- [x] Phone-as-source references are unchanged: runs recorded on a watch or phone arriving through
      the adapters.
- [x] ~~`/log` (`0068`, `0071`, capability `10`) and ticket capture (`0107`) are left untouched until
      the operator answers D-251's open question~~: is either used from a phone at the gym or mid-run?
      The answer is recorded on D-251. **Answered before the sweep ran:** *"No, I don't use /log or
      capture from my phone."* `/log` was therefore swept like everything else, and ticket capture
      went further, to D-252.
- [x] `06-ui-ux.md`'s layout is not edited here; it belongs to `0187`. **Amended:** §7 did get a
      one-paragraph *SUPERSEDED BY D-252* banner. That records a withdrawn feature, not a redesign,
      and a withdrawn section left unmarked is the exact drift the `08` audit spent a session on.
- [x] `09-roadmap.md` §3 capability `13`'s row 3 and Done-when ("Android back … behaves", lines
      ~407 and ~412) are restated for the desktop browser's back button. `0212`'s close found them
      outside its own list.
- [x] `tickets.mjs validate` is clean, and no criterion is ticked or dropped. Only wording changes.
      A phone-only criterion with nothing left to build is struck and marked **"Withdrawn by D-251
      (0215) — tick when closing; nothing to build"**, and left unchecked for its worker. The
      declines of `0107`–`0111` replaced their criteria under D-252. Those are separate closes, with
      the originals kept verbatim in each ticket's Resolution.

## Notes

Filed by the agent from D-251, alongside `0212`'s close. Placed in capability `13` next to `0187`
because both apply the same decision. It does not depend on `0187`: tickets can drop phone
criteria before `06`'s layout is rewritten.

Related: D-124, D-227, D-240, D-251, `0187`, `0212`.

## Resolution

**The open backlog is swept. The operator's answers widened it into three decisions.**

- **D-251, answered.** The operator does not use `/log` or ticket capture from the phone either.
  The phone's only role now is recording runs, which arrive through the adapters.
- **D-252.** There is no in-app ticket UI. Capability `17` is withdrawn, and `0107`–`0111` are
  declined in their own commits, following `0020` and `0021`'s D-184 precedent. Its withdrawal
  audit is recorded. D-092 is struck, D-093's phone half retired, and `06` §7, `07` §5, `09` §3
  and §9.1, and ROADMAP are all marked.
- **D-253.** The map's input model is mouse and keyboard:
  - the mode toggle is a visible control plus a shortcut, replacing `0098`'s long-press and haptic;
  - fit-to-territory is its own control, replacing `0101`'s long-press `⌖`;
  - `0101`'s gesture table is restated for mouse and keyboard;
  - no push notification fires when a run lands (`0078`).

**The sweep (`918b12d`).** A read-only classifier went through all 87 open tickets. It found none
phone-only beyond doubt: 60 needed edits and 25 were unaffected or only incidental. Four agents
then applied the line lists by partition, each owning disjoint files:
- Phone validation surfaces became the desktop browser.
- Phone-shaped rationale is struck with a note: thumb arc, 56dp targets, 16dp slop, wet screen,
  left-handed mirroring, sunlight.
- Touch wording became click and keyboard, and Android back became the browser back button.
- Each ticket's "go for a run" validation step became an imported, replayed or synthetic activity
  (D-229). The classifier found about fifteen of these, all breaking a rule that already stood.
- Frontmatter was hand-edited only where the script has no command for it. `0068`, `0071`, `0088`
  and `0112` were retitled, and dependencies on capability `17` were dropped from `0113`, `0114`
  and `0117`.

**Judgement calls worth knowing about:**
- `0070`'s post-MVP sets editor was a "long-press on the row". An agent restated it as a small
  visible control, by D-253's reasoning. It is a design restatement in a Notes paragraph, not a
  criterion.
- The on-screen copy `1 new run — tap to open` in `0078` and `0087` was left alone. It quotes
  `06`, so the wording is `0187`'s call.
- `0114`'s "`/dev/tickets` is owner-only" criterion stays, because the stub routes exist. `0216`
  removes them and amends that criterion.
- The D-181 boilerplate line *"a human eye, a phone, or a real run"* in ~29 tickets is a dated
  quote from `0147`'s sweep and was left as written.

**Filed:** `0216` (remove the `/dev/tickets` stub routes; that is code, so outside this sweep).

## Operator validation

None: ticket text only, with nothing deployed. The check is the diff: every hit from the grep in
the Description is either changed with a D-251 note or listed in `## Resolution` with the reason
it stays.

Verified by the agent, 2026-09-28. `tickets.mjs validate` reports 0 errors and 0 warnings after
every commit in the sweep. I spot-read the `0098` diff: toggle restated, long-press and haptic
struck under D-253, validation moved to the desktop. Each agent's closing grep over its partition
left only phone-as-recorder lines, struck text and the D-181 boilerplate. `build-index.mjs` was
regenerated. Capability `17`'s audit is recorded as a pass, with one divergence
(`design-was-wrong|D-252`).
