---
id: 110
slug: ticket-read-cache-and-push-webhook
title: Ticket read cache + GitHub push webhook — explicitly a cache, never authoritative
type: feature
priority: high
status: open
size: m
capability: 17-tickets-ui
depends_on: [107]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The read model behind browse and detail (`07-ticketsmith.md` §5.7): a DynamoDB table with one row
per ticket — parsed frontmatter, `path`, and the raw markdown for the detail view — keyed by path.

**Refresh path:**

1. A GitHub **push webhook** on the repo hits `POST /api/dev/tickets/webhook`.
2. The handler verifies the `X-Hub-Signature-256` HMAC and returns **202 immediately**.
3. Asynchronously it walks the repo's `tickets/` subtree via the **Git Trees API**
   (`?recursive=1` on the pushed commit sha), fetches changed blobs, parses frontmatter, and
   **replaces the table wholesale**. A full walk of a few hundred small files is cheap enough that
   incremental diffing is not worth the bug surface.
4. A **cron backstop** (daily) does the same walk unconditionally, so a missed or failed webhook
   delivery self-heals within 24 hours.

The webhook fires for **both** writers — a phone capture's commit and the agent's `git push` after
a session refresh the same cache through the same path. There is no second mechanism.

**Cache invariants. These are the whole reason this design is not a database-of-record:**

- **Never written by the UI.** Captures go to GitHub; the cache learns about them from the webhook
  like everything else. The optimistic local row (0107) lives in the phone's IndexedDB, not here.
- **Never read by the agent.** The agent reads files on disk. Always.
- **Always rebuildable** from the repo. If it is wrong, drop the table.

Read-after-write latency on the phone is one webhook round trip — a few seconds — and the
optimistic local insertion covers it, so the user never perceives it.

Verification is security-relevant: the webhook endpoint is public and must reject anything without
a valid HMAC over the raw body, using a constant-time compare, before parsing. It never does the
work inline; a 202 goes back first and the walk happens after.

## Acceptance criteria

- [ ] `POST /api/dev/tickets/webhook` with a valid `X-Hub-Signature-256` returns 202 in under
      100 ms and performs the tree walk asynchronously.
- [ ] An invalid or missing signature returns 401 and performs **no** GitHub call; the compare is
      constant-time over the raw request body.
- [ ] The walk uses the Git Trees API with `?recursive=1` at the pushed sha and replaces the table
      wholesale; a ticket deleted in the repo disappears from the cache after one push.
- [ ] The daily cron backstop performs the same walk and is proven to heal a deliberately
      corrupted table within one run.
- [ ] Dropping the table entirely and triggering the cron restores the full cache — asserted as a
      test, because "always rebuildable" is a property that decays if never exercised.
- [ ] **No write path from the UI to the cache exists**: `grep` for the cache table's client in
      the Next.js app finds read operations only, and that grep fails the build on a write.
- [ ] No agent-facing code path reads the cache — the agent's ticket tooling touches the
      filesystem only, asserted by a grep over the agent tooling package.
- [ ] Frontmatter parse failures on a malformed ticket file are logged and skip that file; they do
      not abort the walk or blank the table.

## Notes

Replacing the table wholesale rather than diffing is a deliberate trade of a few write units for
the absence of a class of bugs. At a few hundred tickets it is not worth being clever, and the
cheapness is what makes "if it is wrong, drop the table" a real remedy rather than a slogan.

The cache being unreadable by the agent is what keeps the write sets disjoint: the phone writes
`inbox/` in GitHub, the agent writes files on disk, and the cache observes both. Introduce one
agent read of this table and the merge-conflict-free property becomes a coincidence rather than a
structure.

## Operator validation

On the laptop, `git push` a hand-edited ticket (change its title). Within a few seconds, on the
Android phone, pull-to-refresh `/dev/tickets` and see the new title. Then in the GitHub repo
settings open the webhook's Recent Deliveries and confirm a 202 with a sub-100 ms response time.
Finally, delete the DynamoDB table from the console, run the cron manually, and reload the phone:
the full list must come back. If it does not, the cache has become authoritative somewhere.
