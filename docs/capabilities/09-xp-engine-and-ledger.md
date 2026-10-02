# 09-xp-engine-and-ledger

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`09-xp-engine-and-ledger\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (8)

- `0060` — The scorer — activity to per-skill unit counts via selectActivitySkills
- `0061` — Ground multipliers — new, re-armed and recent ground (D-120)
- `0062` — XpLedgerEntry (T4) — append-only, one row per (activity, skill, reason)
- `0063` — Level maths — 4L^2, C(L), Total Level and the 693 ceiling (D-130, D-145)
- `0064` — Meta-skill propagation — Cartography and Constitution via feeds
- `0065` — D-146 — a new skill mints a free Total Level point that must never celebrate
- `0066` — Replay job — clear non-floor rows, write retained_floor, ReplayRun audit, levelHighWater
- `0067` — snapshots/skillstate/ writer — the one documented exception to D-101

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-02.*

**The first §2 pass failed the drift budget badly.** It found about twenty places where a design
doc said something the code does not do, against a budget of three. Almost none of them were
code drifting from a correct doc. They were decisions made *during* the build (D-144, D-217,
D-254, D-257, D-260, D-270, D-273–D-275) that went into `DECISIONS.md` but were never written
back into the section they changed. Two examples:

- `02` §4.3 still put cell writes inside the XP transaction, long after D-144 forbade it.
- `05` §3.5 still un-awarded a revision by subtracting XP, which violates D-135.

The operator chose to run the DESIGN session inside the audit. Every one of them was amended in
place, citing **D-276**. Stale decisions D-120, D-130, D-264, D-273 and D-274 were annotated in
place.

### What the design got wrong

- **It never re-checked a rate after a unit changed.** D-237 moved the fog to res 11 and wrote
  down that this capability had to retune XP-per-cell to about ⅐ — and it never did.
  Cartography pays roughly 7× its intended rate. Live state is Cartography 14,807 against
  Wayfaring 4,661 (`0236`). Every test passed, because the §8.2 fixture feeds res-10-shaped
  counts. The rule this teaches: a decision that hands a parameter to a later capability must
  become a ticket in that capability, not a sentence.
- **It assumed a seeder and a T5 table** that were never built. Bundled JSON (D-217) won, and
  `02` §3.8/§4.4 kept describing the seeder for weeks.
- **Concurrency between replay and ingest was under-designed.** `0223`, `0234` and `0235` were
  all discovered, not planned. They produced D-273–D-275, and they are why 8 planned tickets
  became 20.

### What it got right that was non-obvious

- An append-only ledger with `retained_floor` rows (D-142). It made "XP never decreases" (D-135)
  mechanical rather than a promise, and it is what lets `0236` fix the Cartography rate without
  taking XP away.
- Selecting skills by `measure` with no skill-id branch. The Vigil test held through the whole
  capability.

### Divergences and how each was resolved

- **Code was wrong, filed:**
  - `0236`: the Cartography rate was not retuned for res 11. **High**. The operator chose to
    measure live density first, then ship v2 with a replay.
  - `0237`: the `retained_floor` id collides across two replays over the same version pair, and
    the failure leaves ingest blocked.
  - `0238`: `logMode` is never checked against `measure`.
- **Design was wrong:** about twenty doc amendments under D-276. The revision-rescore gap was
  accepted as manual-replay-only (**D-278**).
- **Tooling:** `0239`. `tmp/` scratch scripts fail the audit's typecheck and lint rows locally.
- **USE step:** this capability owns no screen. The XP screen (`0073`) is in capability `11`,
  behind this gate. **D-277** accepts real data through the deployed path for `09`, which
  happened in `0066`, `0067`, `0220` and `0226`. It moves the desktop look to `11`'s audit.

### Cost (§5)

- September spend was **$50.29**: Business Support+ $29.00, Amplify build minutes $18.41
  (1,841 min, driven by about 355 pushes, one per ticket close), KMS $1.85, the rest under $1.
  No NAT gateway.
- Excluding the support plan, that is about $21/mo against D-083's $1–5. It is already tracked
  as high-priority `0214` (capability `18`), and the actuals are now in its Notes. This
  capability did not cause it, but its ticket-heavy cadence fed it.

### Estimate vs actual

- 8 planned tickets became 20 closed, over 2026-09-28 → 2026-10-02 at about one session per
  ticket (D-151).
- The 12 extra tickets were bugs and gaps found while building, not scope creep: replay/ingest
  races, stale denormalised fields, and the T3/ledger disagreement.

### What the next capability should do differently

1. **Amend the design section in the same commit as the decision that changes it.** Do not save
   it for the audit. That single habit would have kept this audit inside budget.
2. **When a decision defers a parameter to a later capability, file the ticket in that
   capability then.** A sentence in `DECISIONS.md` is not a work item.
3. **Capability `11`'s audit owes the desktop look at XP and levels (D-277).** It should
   specifically check that Cartography does not dominate the panel once `0236` lands, and run
   the flicker check moved from `0066`.

## Audit — 2026-10-02 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 11 passed, 0 failed, 1 n/a. See AUDIT.md §1, §4, §5.

**Filed by this audit, and therefore excluded from `capability-tickets-closed`:** `0236` Cartography pays ~7x its intended rate at res 11 — measure live cells/km and ship xp-rules-v2; `0237` A second replay over the same version pair collides on the retained_floor id and wedges ingest; `0238` Validator does not check that a skill row's logMode agrees with its measure. This capability passed with work outstanding — its own code-was-wrong findings, filed as AUDIT.md §2 directs and listed under Divergences below, not forgotten.

**Divergences (3 of a budget of 3):**

1. **code-was-wrong** — `0236` — Cartography xpPerUnit 13 tuned for res 10, never retuned after D-237 moved fog to res 11 (~7x overpay)
2. **code-was-wrong** — `0237` — retained_floor id collides across two replays over the same version pair; FAILED run leaves replayInProgress up
3. **code-was-wrong** — `0238` — validator never checks logMode agrees with measure

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 17/30 invariants cited by a test name, none lost, 8 new since the last recorded audit (I-15, I-16, I-17, I-18, I-19, I-22, I-25, I-26). Ratchet only: the remaining 13 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1035 → 1141, gen 61 → 129 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **na** — no recorded baseline yet — the next 'audit --record' sets it (1 user(s): cartography 14807/L22, constitution 1553/L11, wayfaring 4661/L15)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 20 closed; 3 filed by this audit (0236, 0237, 0238)

<!-- audit-record {"capability":"09-xp-engine-and-ledger","audited":"2026-10-02T15:24:24Z","verdict":"pass","mechanical":{"pass":11,"fail":0,"na":1},"divergences":3,"filed":["0236","0237","0238"]} -->
