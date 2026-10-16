---
id: 282
slug: webhook-update-and-delete-aspects-reach-reingest-and-retract
title: Webhook update and delete aspects reach reingest and retract
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T14:52:18Z
---

## Description

`0091`'s webhook classifies `aspect_type` and acts only on `create`. An `update` (a title, kind or
privacy edit, or a cropped trace) and a `delete` are answered 200 and dropped. No open ticket owns
them, so a source-side edit or deletion reaches nothing until the reconciliation sweep (`0095`)
or a manual `reingest`.

The contract already has the commands: `IngestCommand`'s `reingest` and `retract` (D-187). This
ticket turns those two aspects into them, through the same `accept()` and receipt path, and
decides what `retract` does downstream. By D-020 and D-135, a deletion can tombstone an
activity, but it can never un-reveal its cells or lower XP.

## Acceptance criteria

- [ ] An `update` event becomes a `reingest` command keyed so a redelivery is one receipt, and the
      worker re-fetches and re-archives the activity. D-278 governs XP: the first version's XP and
      award stand.
- [ ] A `delete` event becomes a `retract` command. The activity is tombstoned (`02` §4.7). Its cells
      stay revealed (D-020) and no XP is removed (D-135).
- [ ] Both stay inside the webhook's two grants (`0091` criterion 7). Any lookup happens in
      `process-activity`.
- [ ] Tests cover each aspect end to end through the webhook handler and the worker.

## Notes

Filed by `0091` (wave 1 of capability `14`, 2026-10-16). Builds on `0091`'s `accept.ts` classifier
and `0093`'s validation. Check `0093` first: if its deauthorization work already shapes the
command routing, sequence this after it.

## Operator validation

None expected. Smoke test: post a synthetic `update` and `delete` for a real activity id to the
Function URL and read the receipt, the T3 row and the logs.
