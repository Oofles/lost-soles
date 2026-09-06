---
id: 175
slug: registry-ts-says-0036-0037-register-the-strava-adapter-both
title: registry.ts says 0036/0037 register the strava adapter; both closed and it is still unregistered
type: bug
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:14Z
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

- [ ] `registry.ts`'s comment names `0093` as the ticket that registers the ingest adapter, and
      states the reason `adapter.ts` gives — a registry entry must not resolve to an object that
      throws on `accept`.
- [ ] The two files no longer disagree: `adapter.ts`'s "STILL NOT IN `registry.ts`'s `ADAPTERS`"
      paragraph and `registry.ts`'s comment tell the same story.
- [ ] `registry.test.ts`'s "ships empty" assertion is untouched and still passes.

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

## Operator validation

None — a code comment with no runtime surface. Verified by the agent by re-reading both files and
confirming they agree.
