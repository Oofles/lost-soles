---
id: 178
slug: end-to-end-proof-that-a-real-failed-import-surfaces-on-the-n
title: End-to-end proof that a real failed import surfaces, on the next real failure
type: chore
priority: low
status: open
size: s
capability: 06-ingest-pipeline
depends_on: []
blocked_by: []
source: agent
created: 2026-09-07T22:10:00Z
---

## Description

`0044` built the failure surface and closed with three of its seven criteria proven only at the
unit level. That was the operator's call and it was a reasonable one: manufacturing a failed
import costs either two deploys of deliberately-broken code or revoking and re-authorizing the
Strava connection, and neither is worth 10+ minutes of manual work against a path that is
covered by tests and has never yet fired in anger.

**This ticket is not more testing. It is a note to look, once, when the real thing happens.**

The next time an activity genuinely fails to import — and on a source that redelivers, over
years, one will — walk the runbook in `docs/capabilities/06-ingest-pipeline.md` rather than
fixing it by hand. That is the only occasion on which the end-to-end path can be checked at
zero cost, because the failure has already happened.

What `0044` proved and what it did not is recorded in full in that ticket's `## Resolution`.
The short version: the alarm is proven live, the receipt write and the sparse index are proven
against the deployed table, and everything the *operator sees* is proven only by tests.

## Acceptance criteria

- [ ] (operator) On the next real failed import: the alarm email arrives, and its subject alone
      identifies the app when read on the phone.
- [ ] (operator) Pressing Sync afterwards reports the failure, rather than "nothing new".
- [ ] (operator) The runbook's steps work as written, in order, without needing a step nobody
      wrote down. Any step that was wrong is corrected in the doc as part of closing this.
- [ ] A redrive clears the `FAILED` state and the activity lands on the map exactly once —
      verifiable afterwards from the receipt (`status: DONE`, no `errorClass`) and the cell count.

## Notes

**Do not manufacture a failure to close this ticket.** That is precisely the cost the operator
declined in `0044`, and paying it later for a tidier checkbox would be worse — it would mean
revoking a working credential to test a code path that tests already cover.

If a year passes with no failure, that is a real result and this closes as "the path never fired;
the tests are what stood behind it". Say so honestly rather than staging one.

The one thing worth watching for in the meantime: an alarm email that arrives and is *ignored*.
`09-roadmap.md` §8.6 is the Habitica risk turned inward, and a DLQ alarm that gets filtered is
strictly worse than no alarm. If that happens, the wording is the bug.

## Operator validation

This ticket IS an operator validation. There is nothing for the agent to run — that is the whole
point of it, and why it is `low` and unscheduled rather than a task with a date on it.
