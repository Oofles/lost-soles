---
id: 175
slug: registry-ts-says-0036-0037-register-the-strava-adapter-both
title: registry.ts says 0036/0037 register the strava adapter; both closed and it is still unregistered
type: bug
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:14Z
closed: 2026-10-26T19:48:00Z
---

## Description

Found by the `05-strava-adapter` drift audit (§2, an uncounted finding).

`src/adapters/registry.ts` carries a long comment explaining why the OAuth connector is
registered on its own while the ingest adapter is not. It ends:

> *"When `0036`/`0037` register the real one, folding `oauth` onto `SourceAdapter` is a refactor
> with these tests already green."*

`0036` and `0037` are both **closed**, and `ADAPTERS` is still `{}`. The decision actually moved:
`src/adapters/strava/adapter.ts` says registration waits for `accept`, in **`0093`**, and gives
the reason — `getAdapter("strava")` must never hand back an object that throws on phase 1, and
the webhook endpoint is the only caller that would reach for it through the registry.

**Both comments are right about the reasoning and one is wrong about the date.** That is the
failure mode worth naming: `registry.ts` is the file whose entire job is to be the single place
anyone looks to answer "what is registered, and why not this", and it is the one giving the stale
answer. Someone checking whether the adapter is wired reads `registry.ts`, sees two closed ticket
numbers, and concludes the registration was missed rather than deferred.

Cosmetic in effect, not in position.

## Acceptance criteria

- [x] `registry.ts`'s comment names `0093` as the ticket that registers the ingest adapter, and
      states the reason `adapter.ts` gives — a registry entry must not resolve to an object that
      throws on `accept`.
      *Amended 2026-10-26:* `0042` registered it, not `0093` (see the note below). The comment
      names `0042`, states `adapter.ts`'s `accept` reasoning, and now adds that `0091` built
      `accept`, so the registered object has no throwing phase.
- [x] The two files no longer disagree: `adapter.ts`'s "STILL NOT IN `registry.ts`'s `ADAPTERS`"
      paragraph and `registry.ts`'s comment tell the same story.
- [x] ~~`registry.test.ts`'s "ships empty" assertion is untouched and still passes.~~
      *Overturned by `0042`* (note below): replaced by "registers exactly the adapters that
      exist". That test and the other nine in `registry.test.ts` pass (2026-10-26).

**2026-09-07 — ticket `0042` overtook this one, by operator decision.** `0042` needed the ingest
adapter registered: `process-activity` reaches its adapter only through `getAdapter(job.source)`,
so an empty `ADAPTERS` made the whole ingest path a function that throws. The operator chose to
register it there rather than leave the worker undeployable.

That settles criteria 1 and 2 — `registry.ts` and `adapter.ts` now tell the same story, and both
name `0042` as what actually forced the registration rather than guessing at a future ticket, which
was this ticket's whole complaint. **Criterion 3 is overturned:** `registry.test.ts`'s "ships
empty" assertion could not survive and was replaced by one that asserts the registry answers for
exactly the adapter directories that exist — discovered rather than named, since
`check-boundaries.mjs` forbids that file from spelling the vendor's id.

Left open rather than closed here: this ticket is in capability `18`, `0042` is in `06`, and
closing it needs its own commit and its criteria amended. It should close as already-satisfied at
capability 18, or sooner if the operator wants it off the list.

## Steps to reproduce

1. `grep -n "0036/0037" src/adapters/registry.ts`
2. `ls tickets/closed/ | grep -E "^003[67]"` — both closed.
3. `grep -n "ADAPTERS" src/adapters/registry.ts` — still `{}`.

## Expected vs actual

**Expected:** the registry names the ticket that will register the adapter.

**Actual:** it names two that already closed without doing so.

## Notes

Filed by the `05-strava-adapter` audit, 2026-09-06. Deliberately **not** counted as one of that
audit's four divergences: it is an inconsistency between two code comments, not a place the
implementation differs from a design section, so counting it would have inflated a budget that
matters.

Low priority, and it should stay low — but it is a two-line fix and the file is the one place
this kind of staleness costs the most.

## Resolution

Closed at capability 18 as already satisfied by `0042`, as that ticket's note said it should be.

- **Files touched:** `src/adapters/registry.ts`, one paragraph.
- **What was still wrong.** The comment `0042` wrote was right when it was written, but it had
  gone stale the same way this ticket complains about. It defended registering an adapter whose
  `accept` "throws a named `NotYetImplemented`" because the webhook did not exist yet. `0091`
  then built `accept`, and the webhook reaches it through `getWebhookAdapter`. The new paragraph
  says the trade is now history. The "STILL NOT IN `registry.ts`'s `ADAPTERS`" paragraph that
  `adapter.ts` used to carry is gone. Its phase-1 comment now points at `getWebhookAdapter`, so
  the two files agree.
- **Criteria 1 and 3 were amended, not met as written.** Criterion 1 named `0093`, and that guess
  was wrong. Criterion 3 pinned an assertion that could not survive registration. Both
  amendments are recorded on the criteria.
- **Decisions:** none.

## Operator validation

None — a code comment with no runtime surface. Verified by the agent by re-reading both files and
confirming they agree.

**2026-10-26, agent:** `registry.ts` lines 40–64 and `adapter.ts` phase 1 (line ~220) re-read
and agree. `npx vitest run src/adapters/registry.test.ts`: 10/10 pass. No deploy surface.
