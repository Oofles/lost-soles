# 14-webhook-and-automatic-sync

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`14-webhook-and-automatic-sync\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0091` — strava-webhook Lambda behind a Function URL, added via the CDK escape hatch, acking in 2 s
- `0092` — The hub.challenge handshake (the key has a dot) and subscription lifecycle management
- `0093` — Event validation, replay idempotency, deauthorization, and cost-DoS defence
- `0094` — token-refresh scheduled Lambda — refresh before expiry, every 4 hours, never on failure
- `0095` — The reconciliation sweep — listSince backstop for silently dropped webhooks
- `0096` — "Your run is on the map" — the one notification, deep-linking to /run/:id

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-19.*

**Fourteen tickets against six planned.** `0096` (push) was declined before work began (D-185).
The other five shipped. The rest came from three sources:

- **Two pulled in by scope.** `0177`, the paced historical backfill, came from capability 06's
  30-day boundary. `0257` is its aggregate reveal.
- **Smoke tests and an agent's own findings (five).** `0282` showed the webhook dropped `update`
  and `delete` on the floor. `0286` showed `secret()` cost every cold POST an SSM round trip.
  `0287` and `0288` followed from `0282`'s tombstone. `0281` came from capability 13's audit.
- **The operator's call on cost (one).** `0289` removed a Budget that measured the whole account
  (D-361).

Work ran 2026-10-16 to 2026-10-19 in waves (D-312): about four sessions, against the five to six
that D-151's pace implies for six tickets. The extra tickets were absorbed because each was small
and arrived with its decision already taken.

**What the design got right, non-obviously.**
- The sweep as the path of record, with the webhook as a latency optimisation (`03` §2.3). It made
  every webhook failure mode cheap to reason about: a dropped `create` costs at most six hours.
  The same property gave `0095` its drill. D-351's 2-of-3-days alarm is the honest version of
  "is the webhook alive" at 3–5 runs a week.
- `08` §4's layered cost-DoS defence, reserved concurrency first. The 1,000-request flood cost
  about $0.002 (`0093`). That made a project-owned Budget unnecessary (D-361).
- "Never trust a destructive event; confirm it with the provider." D-348 settled this for
  deauthorization, and it carried straight over to deletes (D-355) and to forged deletes (D-360).

**What it got wrong.**
- `03` §2.3 said "update: re-fetch only if the title changed" and "delete: remove". `0282`
  replaced both with a full re-fetch (D-356) and a confirmed tombstone (D-355).
- The 2-second deadline was planned as "a few kilobytes, no SDK". The real bundle is ~582 KB, and
  a cold call was 1.56 s until the clients were warmed during init (D-346).
- `secret()` was planned as the secrets mechanism and ended with no production user (D-357, D-362).
- The live AppSync notify path (`01` §4 step 17) was designed and never built. Nobody missed it
  (D-364).

**§2 divergences.** Three readers re-read the 22 cited sections in parallel. As in `09`–`13`,
nearly everything was a decision taken during the capability (D-343–D-361) that had not reached the
sections it changed. The DESIGN pass amended them:
- `01` §2, §4 and §7
- `02` §4.7: the source-edit row still promised a rescore that D-278 removed
- `03` §1.3, §2.3, §2.5, §2.6 and §6.3: §2.6's type table was three rows stale against the rules
  file
- `06` §3.4
- `08` §3, §4.3–§4.5 and §6, including the receipt TTL row that D-349 had corrected only in §4.3
- `09`'s capability section

Five findings were not covered by any decision:
- **design-was-wrong:** the Strava credentials reach four principals and none of them through
  `secret()` (D-362); `accept()` gained an `AcceptContext` that the contract never recorded
  (D-363); the live subscription path was never built (D-364, operator); the dead `byExternalOwner`
  index is kept in reserve (D-365, operator); `tools/` sits outside the adapter-deletion boundary
  (D-366, operator).
- **code-was-wrong**, filed under this capability: `0291`, every Lambda log group has retention
  `None` against §3.1's 30 days; `0292`, a failed SQS send strands an update or delete receipt that
  nothing reopens, because the handler's "the sweep fills the hole" comment was written for
  `create` only and `0282` never revisited it.

Two hygiene items also came up. `0290` deletes `secret-smoke-test`, whose deletion condition has
passed. `0178`'s Sync criterion was false by design since D-318 and is amended.

**§3.** Every ticket has a dated smoke test against the deployed stack, or the operator's report
(`0257`: "It lands."). `0096` is honestly *none*, because it was declined. **No organic Strava
delivery has reached the webhook yet.** Every `webhook-event` in seven days of logs is a smoke test.
The path has been exercised end to end with synthetic events through the real Function URL and
worker, which D-229 accepts. The sweep's metrics are clean: it enqueued once in eight runs, and
that was `0095`'s drill. The first real run after this audit is the first organic proof, and the
D-351 alarm is what will say if it never arrives. Fog and XP baselines held, and only rose: cells
1352 → 5211 and Total XP up, after the backfill.

**§5 cost.** Lambda, SQS and DynamoDB are effectively $0 (DynamoDB $0.06 for October to date). KMS is
$1.13, the T7 customer-managed key that `02` T7 specifies and `0033` built. It predates this
capability; `01` §7 still said "do not build it" and is amended. The $14.65 of Amplify is account-wide, and D-361 puts account cost outside this project.
No NAT gateway.

**What the next capability should do differently.** Two things.
- **When a ticket adds a new path through an existing mechanism, re-read that mechanism's comments.**
  `0282` added two new receipt key shapes and left a comment promising that the sweep reopens them,
  which it does not. That is `0292`. The design pass catches doc drift. A stale *code comment* about
  a guarantee is the drift it does not catch.
- **Name a decision's exceptions in the decision.** D-349's "every rejected POST gets a 200" was
  false for routing 404s and infrastructure 500s. Both were deliberate, but the decision did not
  say so.

## Audit — 2026-10-19 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 12 passed, 0 failed, 0 n/a. See AUDIT.md §1, §4, §5.

**Filed by this audit, and therefore excluded from `capability-tickets-closed`:** `0291` Lambda log groups never expire; 08 §3.1 requires 30-day retention; `0292` A failed SQS send strands an update or delete receipt that no retry or sweep reopens. This capability passed with work outstanding — its own code-was-wrong findings, filed as AUDIT.md §2 directs and listed under Divergences below, not forgotten.

**Divergences (2 of a budget of 3):**

1. **code-was-wrong** — `0291` — every Lambda log group has retention None; 08 §3.1 requires 30 days
2. **code-was-wrong** — `0292` — a failed SQS send strands an update or delete receipt that no retry or sweep reopens

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 18/30 invariants cited by a test name, none lost. Ratchet only: the remaining 12 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts, app/skills/vigil-peer.test.tsx
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1352 → 5211, gen 135 → 269 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **pass** — 1 baselined user(s), 10 skill(s): cartography 26678/L27, constitution 11077/L20, might 80/L4, roving 1017/L9, vigil 660/L8, wayfaring 31482/L29 — none lower (docs/capabilities/regression-baseline.json)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 14 closed; 2 filed by this audit (0291, 0292)

<!-- audit-record {"capability":"14-webhook-and-automatic-sync","audited":"2026-10-19T05:26:02Z","verdict":"pass","mechanical":{"pass":12,"fail":0,"na":0},"divergences":2,"filed":["0291","0292"]} -->
