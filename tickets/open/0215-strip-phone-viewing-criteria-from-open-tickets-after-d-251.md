---
id: 215
slug: strip-phone-viewing-criteria-from-open-tickets-after-d-251
title: Strip phone-viewing criteria from open tickets after D-251
type: chore
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T16:53:19Z
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

- [ ] Every open ticket's phone-VIEWING criterion or validation step is removed or restated for the
      desktop browser, with an inline `*(D-251, 0215)*` note. A struck line stays visible wherever
      the old wording shaped the design.
- [ ] Phone-as-source references are unchanged: runs recorded on a watch or phone arriving through
      the adapters.
- [ ] `/log` (`0068`, `0071`, capability `10`) and ticket capture (`0107`) are left untouched until
      the operator answers D-251's open question: is either used from a phone at the gym or mid-run?
      The answer is recorded on D-251.
- [ ] `06-ui-ux.md` is not edited here. It belongs to `0187`.
- [ ] `09-roadmap.md` §3 capability `13`'s row 3 and Done-when ("Android back … behaves", lines
      ~407 and ~412) are restated for the desktop browser's back button. `0212`'s close found them
      outside its own list.
- [ ] `tickets.mjs validate` is clean, and no criterion is ticked or dropped. Only wording changes.

## Notes

Filed by the agent from D-251, alongside `0212`'s close. Placed in capability `13` next to `0187`
because both apply the same decision. It does not depend on `0187`: tickets can drop phone
criteria before `06`'s layout is rewritten.

Related: D-124, D-227, D-240, D-251, `0187`, `0212`.

## Operator validation

None: ticket text only, with nothing deployed. The check is the diff: every hit from the grep in
the Description is either changed with a D-251 note or listed in `## Resolution` with the reason
it stays.
