# 10-add-workout

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`10-add-workout\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (11)

Planned at ticket-write (5):

- `0068` — /log route — one row per workout type, one click to log
- `0069` — The manual adapter — src/adapters/manual/ behind the ingestion contract
- `0070` — WorkoutEntry shape that accommodates sets from day one
- `0071` — /log row anatomy and interaction rules
- `0072` — A new workout type arrives as a YAML row only — proven by a zero-diff test

Filed while building (5):

- `0171` — The activity kind is derived and unchangeable *(split into `0243` + `0244`, D-284)*
- `0243` — A kind override is stored as a correction and honoured by ingest, rebuild and scoring
- `0244` — The operator can change an activity's kind from the run page
- `0240` — Manual distance logging on /log (treadmill / track) *(filed from `0068`, D-282 → D-286)*
- `0241` — App-shell service worker so a cold reload renders offline *(filed from `0068`; declined, D-287)*

Filed by the audit (1):

- `0245` — The /log row draws its skill's sigil, as 06 §6.3–6.4 require

## Design notes

_No separate DESIGN step was run; `06` §6 was the design. Its corrections are D-282, D-286, D-287
and D-288._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-07.*

**The first §2 pass found four divergences against a budget of three, and three of them were the
docs, not the code.** D-251 (no phone), D-282 (immutable rule versions; no `step` field) and D-286
(a hand-logged distance) were each recorded and each applied to *part* of what it changed. `06`
§6.2 and §9.2 kept describing a phone in a hallway, §6.5 kept naming `xp-rules-v1.yaml`, and `01`
§3 kept saying the manual adapter emits only `strength`. The operator chose to run the DESIGN pass
inside the audit, as for capability `09`. Every amendment cites **D-288**. This is the second
capability in a row where the budget was blown by unapplied decisions rather than by code. The
fix is upstream of the audit: a decision is not done until a grep of the docs for what it changed
comes back clean.

### What the design got wrong

- **The physical brief.** `06` §6.2 was written for a sweaty phone held in one hand, and three
  of `0071`'s criteria (56dp targets, touch slop, the thumb arc) plus a `/settings` flag existed
  only for that. The operator never logs from a phone (D-251). That was cheap to withdraw because
  it was withdrawn before it was built.
- **It specified UI numbers the registry could not hold.** §6.5 listed a `step` field no rule row
  has, and the §6.3 wireframe drew a Vigil `trace-manual` row the schema had no shape for. D-282
  derived the step from `entry`. D-286 gave distance a `WorkoutSet.distanceM` and a v3 ruleset.
  Wireframes drawn ahead of the schema promise things the schema then has to be bent to keep.
- **"Background sync" assumed a service worker.** None was ever planned in the architecture.
  D-282 made the queue an in-page runner, and D-287 declined the worker outright. A cold reload
  with no signal shows the browser's offline page, and nobody has missed it.
- **The kind of an activity was assumed to be a pure derivation.** `0171` showed a wrong Strava
  label is permanent without an override, and an override kept only on the row is reverted by
  every re-derivation path. D-284's answer, an immutable fact under `raw/` applied after
  `normalize()`, cost two tickets and is the right shape.

### What it got right that was non-obvious

- **`/log` as rows generated from the registry.** `0072`'s two-world test proves a new workout
  type is a YAML version plus one JSON sigil, with `/` byte-identical. Its mutation check (a
  "convenient `if`" in `logRows`) failed two tests under the I-24 message. `0240` then added a
  whole new entry kind and touched exactly one `.tsx` branch, keyed on the entry kind, never on an
  exercise.
- **Undo as a hold, not a compensation** (D-282). Holding the entry in IndexedDB for its 8 seconds
  and never sending it before then is the only undo compatible with D-135. It also made the
  operator's real log land 9.4 s after the click, exactly as designed.
- **Manual entry as just another adapter.** The pipeline cannot tell a pushup from a Strava run,
  so dedupe, archive-before-normalize, kind overrides and replay all applied to hand logs for free.

### Divergences and how each was resolved

| # | Where | Resolution |
|---|---|---|
| 1 | `06` §6.2, §6.3, §9.2: the phone brief, 56dp, thumb arc, left-handed flag | design-was-wrong → amended, D-288 (applies D-251) |
| 2 | `06` §6.5 step 1: new type goes into `xp-rules-v1.yaml` | design-was-wrong → amended, D-288 (applies D-282) |
| 3 | `01` §3: manual adapter emits only `strength`; `sets` only on strength | design-was-wrong → amended, D-288 (applies D-286) |
| 4 | `/log` row draws no sigil (§6.3–6.4) | code-was-wrong → `0245` |

**Handoffs repaired, not counted as divergences:** §6.4's "level-ups still interrupt" `/log` was
handed by `0068` to `0082`, whose body never mentioned `/log`; a dated note now carries it. `0159`
got a note that `0072` built a second registry-delta harness, so it does not grow a third.

**Recorded as two divergences:** D-288, for the three design amendments made in the session (as
D-276 was for `09`), and `0245`.

## Audit — 2026-10-07 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 12 passed, 0 failed, 0 n/a. See AUDIT.md §1, §4, §5.

**Filed by this audit, and therefore excluded from `capability-tickets-closed`:** `0245` The /log row draws its skill's sigil, as 06 §6.3–6.4 require. This capability passed with work outstanding — its own code-was-wrong findings, filed as AUDIT.md §2 directs and listed under Divergences below, not forgotten.

**Divergences (2 of a budget of 3):**

1. **design-was-wrong** — `D-288` — 06 §6.2/§6.3/§9.2 kept D-251's withdrawn phone brief; §6.5 named xp-rules-v1.yaml against immutable versions (D-282); 01 §3 said manual emits only strength (D-286) — amended in session
2. **code-was-wrong** — `0245` — the /log row draws no sigil; 06 §6.3–6.4 require one, and the 0068/0071 → 0072 handoff dropped it

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 18/30 invariants cited by a test name, none lost, 1 new since the last recorded audit (I-27). Ratchet only: the remaining 12 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1141 → 1141, gen 129 → 134 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **pass** — 1 baselined user(s), 10 skill(s): cartography 15985/L23, constitution 1584/L11, might 80/L4, wayfaring 4675/L15 — none lower (docs/capabilities/regression-baseline.json)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 10 closed; 1 filed by this audit (0245)

<!-- audit-record {"capability":"10-add-workout","audited":"2026-10-07T16:23:26Z","verdict":"pass","mechanical":{"pass":12,"fail":0,"na":0},"divergences":2,"filed":["0245"]} -->
