---
id: 153
slug: decline-boilerplate-false-ancestry
title: Declined captures are near-identical, so git log --follow finds a FALSE ancestor
type: bug
priority: med
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-03T01:20:57Z
started: 2026-10-01T00:53:43Z
closed: 2026-10-01T00:55:40Z
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

- [x] `git log --follow` on a declined capture either finds its true inbox ancestor or finds
      nothing — it never reports a different capture's file.
- [x] Reproduced first as a failing test with two declined captures, so the fix is shown to fix
      the actual reported behaviour rather than a plausible-looking substitute.
- [x] `closedCaptureBody` emits a Description with real content when the capture had a heading but
      no body — checked for content, not just for the heading.
- [x] The `-M20%` guidance is replaced everywhere it appears with the `--full-history` form:
      `reference.md`, `docs/capabilities/03-ticket-capture-endpoint.md`, and the pointer left on
      `0023`. **Corrected in those three places already** — this criterion is to confirm nothing
      else recommends it.
- [x] `tickets.mjs validate` stays clean, and `0152` is either left as the historical evidence it
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

**Before**, on this repo (2026-09-30): `git log --follow -M20% --name-status` on `0152` printed
`C033 tickets/closed/0150-capture-endpoint-smoke-test.md → tickets/closed/0152-…` in `89e8534`, then
walked on into 0150's own inbox file. The new test failed the same way at the **default** threshold
before the fix.

**After**, replayed in a scratch git repo with `TICKETS_ROOT` pointed at it: two title-only
captures (`capture endpoint smoke test`, `bearer auth works`) declined in separate commits through
the real `triage-decline`. On `closed/0002-bearer-auth-works.md`:
- `git log --follow` → only `A tickets/closed/0002-…` (nothing, which is allowed).
- `git log --follow -M20%` → `R020 tickets/inbox/b.md → tickets/closed/0002-…`, then the capture
  commit: its **own** inbox file. No sibling anywhere in the output.
- The file's `## Description` reads `bearer auth works`, not empty.

Suite: `node --test tickets.test.mjs` → 183/183. `tickets.mjs validate` → 0 errors, 0 warnings.

## Resolution

**The ticket's diagnosis was half right, and the suggested fix would not have worked.** Replaying
`git log --follow -M20% --name-status` on `0152` showed `C033 closed/0150 → closed/0152` in
`89e8534`, which was a one-item triage commit. So this was never two renames paired wrongly inside a
batch. It was a **copy** from a sibling's closed file that already existed, scoring 33% against
`0152`'s own 6-line inbox stub, which scored lower. And git similarity ignores line order, so the
Notes' suggestion (capture text on top, boilerplate below) changes nothing. Only *unshared*
generated text helps.

**Fix — `closedCaptureBody` in `tickets.mjs`:**
- Every generated filler line now names its own capture: the Acceptance criteria and Operator
  validation lines quote the title, and Notes already carried `created`. Two declined captures now
  share only their bare `##` headings and the `**Declined at triage, <date>.**` prefix.
- The Description is checked for **content**, not just for the heading. When the heading is there
  with nothing under it (the tile's common case), it is filled with the title in place. If the
  heading is missing entirely, it is appended as before.

**Tests (`tickets.test.mjs`):** new `--follow on a declined capture never reaches a SIBLING capture
(0153)` models 0150/0152 exactly: title-only captures declined in separate commits. It asserts no
sibling in the output at the default threshold or at `-M20%`, and that Description is non-empty. It
**failed before the fix** at the default threshold and passes after. I rewrote the comment on the
older single-decline test so it points to `--full-history` instead of implying `-M20%` is the way
back.

**Docs:** `reference.md` now records the real mechanism (copy, not rename) and the fix. It still
says to use `--full-history` and not `--follow`, because the fix makes a correct match likely, not
guaranteed: the true ancestor clears `-M20%` at only `R020`. A grep of every `.md`/`.mjs`/`.sh`
outside `tickets/` found no other `-M20%` advice. The ones inside `tickets/` are `0023` (already
marked superseded) and this ticket. `docs/capabilities/03-ticket-capture-endpoint.md` no longer
mentions it.

**`0152` is left as is**, deliberately. It is the historical evidence for this bug, and its own
Resolution already says to use `--full-history` and why. Regenerating it would destroy the
reproduction. `0150` is left alone for the same reason.

**Not separately tested:** the merge path also uses `closedCaptureBody`, so it gets the same fix,
but only decline has a two-capture test. No D-xxx: the decline format's structure (D-170) is
unchanged; only the filler wording is.
