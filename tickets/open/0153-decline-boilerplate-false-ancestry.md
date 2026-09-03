---
id: 153
slug: decline-boilerplate-false-ancestry
title: Declined captures are near-identical, so git log --follow finds a FALSE ancestor
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-03T01:20:57Z
---

## Description

Found immediately after `0023` shipped, by using it. Declining
`2026-09-03T0114-bearer-auth-works.md` produced `0152`, and
`git log --follow -M20%` on `0152` — **the exact command `0023` documents** — reported its ancestor
as `0150-capture-endpoint-smoke-test.md`. That is a **different capture, from a different day,
about a different thing.**

A false ancestry is worse than none. No trail makes a reader go looking; a confident wrong trail
makes them stop.

**The cause is `closedCaptureBody` in `tickets.mjs`.** A short capture is a title and a line or two
of prose. Decline wraps it in four fixed sections plus a `## Resolution`, so the generated
boilerplate dominates the file — and *every* declined capture therefore looks like every other one.
Git's rename detection is pure similarity, so lowering the threshold to `-M20%` to span the rewrite
(which `0023` recommends, correctly diagnosing the rewrite problem) is precisely what lets it match
the wrong sibling.

**A second, smaller defect from the same function.** `closedCaptureBody` tests for a
`## Description` *heading* and not for its *content*, so a capture posted with a title and no body —
the common case from the tile, since `capture.sh` omits `body` under 200 characters — lands with an
**empty Description**. `0152` has one. The title is in frontmatter and the Resolution carries the
context, so nothing is lost, but the section is dead weight and looks like a bug to a reader.

**What actually works**, and what the docs should say instead — no heuristic involved:

```sh
git log --full-history -- 'tickets/inbox/<original-capture-name>.md'
```

On `0152` that gives exactly two commits: `1927a7e` (the endpoint's own `capture:` commit) and
`89e8534` (the triage). The content is retrievable with
`git show 1927a7e:tickets/inbox/<name>.md`.

## Steps to reproduce

1. Decline two different short captures on different days, so `closed/` holds two.
2. `git log --follow -M20% -- tickets/closed/<the second one>.md`
3. It reports the *first* capture's inbox file as the ancestor of the second.

## Expected vs actual

**Expected:** the follow either reaches the capture's own inbox file, or reaches nothing.

**Actual:** it reaches a different capture's inbox file, and reads as authoritative.

## Acceptance criteria

- [ ] `git log --follow` on a declined capture either finds its true inbox ancestor or finds
      nothing — it never reports a different capture's file.
- [ ] Reproduced first as a failing test with two declined captures, so the fix is shown to fix
      the actual reported behaviour rather than a plausible-looking substitute.
- [ ] `closedCaptureBody` emits a Description with real content when the capture had a heading but
      no body — checked for content, not just for the heading.
- [ ] The `-M20%` guidance is replaced everywhere it appears with the `--full-history` form:
      `reference.md`, `docs/capabilities/03-ticket-capture-endpoint.md`, and the pointer left on
      `0023`. **Corrected in those three places already** — this criterion is to confirm nothing
      else recommends it.
- [ ] `tickets.mjs validate` stays clean, and `0152` is either left as the historical evidence it
      is or regenerated deliberately, with the choice stated.

## Notes

`0023`'s own tests assert `-M20%` finds the true ancestor, and they pass — because a temp repo in
that suite holds exactly ONE declined capture, so there is no sibling to mismatch against. **The
test was right about the mechanism and blind to the collision**, which is why the criterion above
asks for two captures specifically.

The promote path is unaffected and its test still holds: `triage-move` keeps the body
byte-identical, so a promoted ticket follows at git's default 50% threshold with no ambiguity. This
is a decline/merge problem only.

Worth considering as the fix rather than tuning thresholds: keep the capture's own text at the top
of the file and push the generated boilerplate below it, so the surviving similarity is with the
capture rather than with the other declines. A threshold that works today only works until the next
capture happens to be about the same length.

## Operator validation

> **D-181 — this is entirely the agent's.** It is a git-behaviour bug reproducible in a temp repo
> with a shell, and its fix is asserted by tests.

Recorded here at close as the reproduction and the after-state, with `--follow` shown reaching the
right file (or nothing) on a repository holding at least two declined captures.
