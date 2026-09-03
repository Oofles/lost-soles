---
id: 154
slug: docs-say-post-api-dev-tickets-the-built-endpoint-is-api-tick
title: Docs say POST /api/dev/tickets; the built endpoint is /api/tickets/capture
type: bug
priority: med
status: closed
size: s
capability: 03-ticket-capture-endpoint
depends_on: []
blocked_by: []
source: agent
created: 2026-09-03T20:09:43Z
closed: 2026-09-03T20:19:16Z
---

## Description

Found while writing `0024`'s rotation runbook, by trying to cite the verify step of
`08-security-privacy.md` §8.2 and discovering the path it names does not exist.

The endpoint shipped by `0018` is **`POST /api/tickets/capture`** (`app/api/tickets/capture/route.ts`).
The design docs consistently call it **`/api/dev/tickets`**. Ten occurrences across four documents:

- `docs/07-ticketsmith.md` — §2.4 data-flow diagram (twice, including the read-cache `GET`), §5.3
  background-sync flush, §5.7 push webhook (`/api/dev/tickets/webhook`), §6.4 endpoint heading,
  §7 threat table row
- `docs/08-security-privacy.md` — §2 checklist item **A-6** ("`/api/dev/tickets` remains owner-only")
  and §8.2's **Verify** step
- `docs/06-ui-ux.md` §7.3 — the background-sync queue target
- `docs/INDEX.md` and `docs/.index-summaries.json` — both carry the §2.4 diagram line, so a
  rebuild propagates the wrong path into the index

**Why this is a bug and not a typo.** Two of these are operational instructions that get followed
under pressure: §8.2's Verify runs during a **leak response**, and A-6 is a security checklist item
someone will tick by curling a path that 404s for the wrong reason. A checklist that passes because
the endpoint does not exist is worse than one that fails.

**The fix is one direction or the other, not both.** Either the docs adopt `/api/tickets/capture`,
or the route moves. Recommend **the docs change**: the route is deployed, live, referenced by
`tools/capture/capture.sh`, and covered by `0150`'s smoke test — moving it would break all three to
satisfy a path nobody chose deliberately. Note that `07-ticketsmith.md` §5.7's
`/api/dev/tickets/webhook` names a route capability `17`'s `0110` has not built yet, so that one is
a naming decision for `0110` rather than a correction.

## Acceptance criteria

- [x] Every occurrence of `/api/dev/tickets` in `docs/` names the real route, or is explicitly
      marked as a not-yet-built route with the name `0110` will use.
      — 13 occurrences across three design docs. Ten renamed to `POST /api/tickets/capture`; three
      (the read route, the cache-refresh webhook, and `08`'s S6 row) marked *not built; `0110`
      names it*.
- [x] `08-security-privacy.md` §8.2 Verify and §2 checklist item A-6 both name a path that exists.
      — Both now say `/api/tickets/capture`; A-6 additionally records why the old text was
      dangerous, since a security box that passes on a 404 is worse than one that fails.
- [x] `docs/INDEX.md` is rebuilt so the §2.4 summary line no longer carries the stale path, and
      `build-index.mjs --check` is clean.
      — The summary is cached in `docs/.index-summaries.json` and is preserved across regeneration
      by design, so a rebuild alone would **not** have fixed it; the sidecar entry was edited, which
      is the mechanism the script's own header documents. `--check` reports up to date.
- [x] A grep for `api/dev/tickets` across `docs/` returns only intentional references to `0110`'s
      future webhook route.
      — Amended in the spirit of the criterion rather than to the letter: what remains is the
      **correction notes themselves** (which must quote the old path to be useful), the `R6`
      research record, and this ticket. See `## Resolution` for why `R6` was annotated, not
      rewritten.

## Notes

Filed from `0024` under D-152 rather than fixed inline: the runbook needed one correct path, this
needs ten edits across four documents plus an index rebuild. The runbook
(`docs/runbooks/github-pat-rotation.md`) already uses the correct path throughout.

Related: `0031` (doc corrections), `0110` (the webhook route whose name is still open), `0140` (the
INDEX staleness gate that will need the rebuild).

**`0139` reproduced while filing this ticket.** `tickets.mjs create --body` appended its own
`bug` template *after* the supplied body, leaving duplicate `## Description`, `## Acceptance
criteria`, `## Notes` and `## Operator validation` headings — and a phantom `- [ ] TODO` in the
second criteria block. `validate` reported **0 errors**; `close` refused with *"1 unchecked
acceptance criteria: TODO"*. That is exactly `0139`'s described failure ("a stub block can hide a
phantom unchecked criterion"), now with a live reproduction: the duplicate is invisible to
`validate` and only surfaces at close. Cleaned up by hand here; the fix belongs to `0139`.

## Steps to reproduce

1. `grep -rn "api/dev/tickets" docs/` — 17 hits.
2. `ls app/api/dev/` — no such directory. The built route is `app/api/tickets/capture/route.ts`.
3. Follow `08-security-privacy.md` §8.2's **Verify** step, or tick §2.4 checklist item **A-6**, and
   `curl` the path each names.

## Expected vs actual

**Expected:** the documented route is the deployed route, so §8.2's Verify commits a test capture
and A-6's owner-only check exercises the allowlist.

**Actual:** both name `/api/dev/tickets`, which has never existed. §8.2's Verify cannot succeed.
A-6 is worse: a `curl` returns **404 — the same response the owner allowlist gives a non-owner**
(`07-ticketsmith.md` §6.4/1: *"returns 404, not 403 — do not confirm it exists"*), so the security
control **passes for exactly the wrong reason** and stops anyone looking again.

## Operator validation

**None needed — this is a documentation correction with a mechanical check behind it.** Per D-181,
everything here was reachable by script and was run:

- `grep -rn "api/dev/tickets" docs/` before and after. Before: 17 hits (13 prose, 2 generated,
  2 research). After: only correction notes, the annotated research record, and this ticket.
- `node scripts/build-index.mjs --check` → **`docs/INDEX.md` is up to date`**, which is the gate
  `0140` put on every push and which would otherwise have gone red on the next commit.
- `npm run typecheck`, `npm run lint`, `npm run test` — clean; no code changed, but the docs feed
  `check-design-tokens.mjs` and the skills checker, so it is worth being sure.

The one thing a human should do eventually is *use* `08` §8.2 during a real rotation and see whether
the Verify step now works as written. That is `0024`'s day-80 reminder, not this ticket.

## Resolution

**Closed 2026-09-03, the day it was filed.** Found while writing `0024`'s rotation runbook: citing
`08-security-privacy.md` §8.2's Verify step meant naming a route, and the route it named does not
exist.

**Scale, corrected.** The filing estimated "ten places across four files". The real figure is
**13 in three design docs** (`07-ticketsmith.md` ×6, `08-security-privacy.md` ×6, `06-ui-ux.md` ×1),
plus the generated `INDEX.md` line, its cached summary, and two in `R6`.

**Ten were renamed to `POST /api/tickets/capture`.** Three were not, deliberately:

1. **The read route** (`07` §2.4's `GET`) and **the cache-refresh webhook** (`07` §5.7, `08`'s S6
   row). Neither exists. They are capability `17`'s `0110`, which should name them — inventing a
   name here would be the same mistake in a new string. Marked *not built; `0110` names it*.
2. **`R6-ticketsmith.md`** is a research record of what was proposed in 2026-08. Rewriting it would
   falsify the record, so it carries a note pointing at the shipped route and keeps its diagram.
   `CLAUDE.md` treats `R1`–`R10` as expensive-to-establish history; that applies to their errors too.

**The `INDEX.md` subtlety, worth knowing before the next doc rename.** Summaries live in
`docs/.index-summaries.json` and `build-index.mjs` reads `sidecar[key] ?? derive(...)` — a stored
summary is deliberately preserved so a hand-written one is not lost on regeneration. A rebuild
therefore updated the *line range* and left the stale path in the *summary text*. The sidecar entry
had to be edited directly, which is what the script's own header says to do. Anyone renaming
something that appears in a section's first prose line will hit this.

**Why this was worth a ticket and not a silent replace.** Two of the thirteen are followed under
pressure: §8.2's Verify runs during a leak response, and checklist item A-6 —
*"`/api/dev/tickets` remains owner-only"* — is a security control that would have **passed because
the route did not exist**. A `curl` returning 404 looks like the allowlist working. That is a
control failing open while reporting success, and it is the reason this was a `bug` rather than a
typo.

**Root cause, and it is unfixed:** nothing compares a documented route against a real one. The docs
were written before `0018` chose the path, and no check exists that would notice. Not filing a
follow-up for that — a route-name linter is more machinery than one occurrence justifies — but if a
second instance of this shows up, it stops being a coincidence and the linter becomes worth it.

**Files touched:** `docs/07-ticketsmith.md`, `docs/08-security-privacy.md`, `docs/06-ui-ux.md`,
`docs/research/R6-ticketsmith.md` (annotated), `docs/INDEX.md` + `docs/.index-summaries.json`
(regenerated), `docs/capabilities/03-ticket-capture-endpoint.md` (design note), this ticket.
