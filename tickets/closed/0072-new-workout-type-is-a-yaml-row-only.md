---
id: 72
slug: new-workout-type-is-a-yaml-row-only
title: A new workout type arrives as a YAML row only — proven by a zero-diff test
type: feature
priority: high
status: closed
size: m
capability: 10-add-workout
depends_on: [68, 71]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-06T19:47:50Z
closed: 2026-10-06T19:56:28Z
---

## Description

The promise of D-031, D-061 and D-132, made mechanical. **Adding a workout type must be:**

1. a row in `rules/xp-rules-v1.yaml` (`id`, `name`, `kind: activity`, `logMode`, `unit`,
   `match`, `xpPerUnit`, step, `feeds: constitution`),
2. one sigil added to the icon set,
3. ship.

`/log` gains a row at the bottom. `/skills` gains a tile in `ACTIVITY`. **The home screen
changes by zero pixels.** No component is written, no layout is revisited, no screen is
redesigned, no ticket is filed.

This ticket is the **permanent CI proof** of that, not a manual promise. Following
`02-data-model.md` §3.8 check 5 and invariant **I-24**, it adds a regression test that seeds the
registry, adds **only** a new row — a **Pull-ups** row, chosen because nothing in the codebase
has ever heard of it — and asserts the TypeScript diff is empty while the row appears everywhere
it should.

**I-24 is the property most likely to rot quietly, one convenient `if` at a time.** That is why
the test is wired into CI permanently rather than run once at acceptance.

## Acceptance criteria

- [x] A CI test seeds ~~`xp-rules-v1.yaml`~~ **the newest bundled ruleset**, appends **only** a
      `pullup` skill row plus its sigil, ~~re-seeds T5~~ **as the next bundled version**, and
      asserts: *(Amended 2026-10-06, under the operator's authorization to adjust 0072 after
      0073. Rule versions are immutable once shipped (D-282), so a new row ships as a new
      version. T5 was never built (D-217): the bundled registry is what the browser and the
      worker both read. `app/new-workout-type.test.tsx`.)*
  - [x] the `src/` TypeScript diff required is **empty** — no file under `src/` was modified;
        *(Made structural. The two worlds differ only in the two data modules under `rules/`,
        and every page, scorer and pipeline step is the real module, re-imported fresh. The
        I-25 grep is fed the fixture's ids, so no source file may name the skill either.)*
  - [x] `/log` renders a new Pull-ups row, in `displayOrder` position, with the registry's step
        and plain-English unit label;
  - [x] `/skills` renders a new tile in the `ACTIVITY` section with no layout change and no new
        section;
  - [x] the home screen renders **byte-identically** (snapshot comparison) before and after;
  - [x] logging that row scores into the new skill at the registry's rate and feeds
        Constitution;
  - [x] `selectActivitySkills` returns the new skill for its measure and does not disturb any
        existing skill's selection.
- [x] The same test also runs the **D-132 Vigil clauses** (I-24's (b)/(c)/(d)): a
      `hasTrace: false` run scores into the traceless distance skill at full rate; the same run
      with a trace scores into the traced one; the traceless case writes no `ExploredCell`.
- [x] The test fails loudly if any `src/` file must change, and the failure message names D-031
      and I-24 so the next person understands what was broken.
- [x] `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution|pullup)"'
      src/` returns nothing outside `rules/`, fixtures and tests, and fails the build otherwise
      (I-25).
- [x] The Pull-ups fixture is scoped to the test and is **not** shipped in the production
      ruleset.
- [x] The test's registry order assertion proves rows never reorder by frequency, recency or
      level (`06-ui-ux.md` §6.5) — a row that moves is a row you mis-click.

## Notes

Pull-ups rather than Vigil for the added row: Vigil ships in v1, so it can no longer prove
anything about *adding*. The test needs a skill the codebase has never seen.

If this test ever needs "just one" exception, the exception is the finding — file a ticket, do
not weaken the assertion. The whole reason `match` exists (D-141) is that a schema can look
complete, be internally consistent, and still be missing an entire job; a green zero-diff test is
the only durable evidence that it is not missing another one.

The icon set is the one place a new skill legitimately touches a source file. Keep sigils in a
data-keyed map (`skillId → sigil`) with a documented fallback glyph, so a missing sigil degrades
to a placeholder rather than failing the row — otherwise step 2 becomes a code change in
disguise.

## Resolution

**Built after `0073`, as the operator directed (2026-10-06).** `0073` built the two things this
ticket's `/skills` and sigil criteria needed (the panel and a data-keyed sigil map, D-283). With
those in place no criterion had to be split off, and the ticket ships whole.

- **`app/new-workout-type.test.tsx`** (14 tests) builds two worlds from one tree:
  - **BEFORE** is the shipped bundle and sigils.
  - **AFTER** is the same plus `withNewWorkoutType(newest)`: Pull-ups as the next ruleset
    version, plus one sigil.
  - `vi.doMock` swaps **only** `@/rules/xp-rules.bundled` and `@/rules/sigils.json`. Everything
    else is the real module, re-imported fresh per world after `vi.resetModules()`: `LogPage`,
    `SkillsPanel`, `skillsPanel`, `/`, `logWorkout` → manual adapter → `processActivity`,
    `selectActivitySkills`.
  - The environment mocks (auth, `next/headers`, MapLibre's shell, `/log`'s transport) are
    identical in both worlds, so they cannot explain a difference.
  - It asserts:
    - `/log` gains `Ascent: pull-ups` as the last row, with every existing row's markup
      unchanged, and the step and label come from the registry.
    - `/skills`, with Pull-ups untrained: ACTIVITY is byte-identical, Pull-ups sits in
      Untrained, and Total Level rises by exactly the minted point (D-146).
    - `/skills`, with Pull-ups trained: it is the next ACTIVITY tile with its sigil, the
      existing tiles are byte-identical, and no section appears.
    - `/` is byte-identical.
    - A real `logWorkout` scores `reps × xpPerUnit` into the new skill and writes a
      Constitution feed row, with no cell writes. The browser's optimistic award agrees with
      the server skill for skill.
    - `selectActivitySkills` over all 6 kinds × trace × 3 sources: the new skill appears
      exactly where its `match` covers, and every other selection is unchanged.
    - The D-132 Vigil clauses, under the AFTER ruleset: a traceless run pays the traceless
      skill at full rate, a traced run pays the traced skill, and the traceless run writes no
      `ExploredCell`.
    - Registry order holds across rising, falling and scrambled levels.
    - The fixture validates (`assertValidRuleSet`) and is in no shipped ruleset or sigil set.
  - Every I-24 assertion carries one message naming I-24 and D-031 and saying not to weaken
    the test.
- **`src/rules/__fixtures__/new-workout-type.ts`**: the row (skill "Ascent", exercise
  "Pull-ups", so the tile's name and the row's label are provably two fields), its sigil, and
  `withNewWorkoutType`, which appends at `max(displayOrder) + 10`.
- **`src/rules/no-skill-names.test.ts`**: the I-25 grep now includes the fixture's ids. It is
  the ticket's grep, run over `src/`, `app/`, `lib/` and `components/` with `rules/`, fixtures
  and tests exempt.

**Mutation check.** I added `&& s.introducedIn <= 2` to `logRows`' filter, the kind of
"convenient `if`" this ticket exists to catch. Two tests failed with the I-24/D-031 message.
Reverted.

**What went wrong.** The first run had two failures, both in the test: the last `<li>` carried
`</ul></main>`, and the order check compared across sections instead of within each one. Fixed
in the test. No production code changed for this ticket. That is the point.

**Finding, not acted on.** The home screen does not read the registry at all, so "byte-identical"
holds trivially today. It stays in the test as a tripwire for the plinth (capability 13), which
will read Total Level.

## Operator validation

*Planned at ticket-write:* In the desktop browser: with a hand-edited ruleset containing a Pull-ups row deployed
to a test stack, open `/` and confirm the home screen looks **exactly** as it did — no new
button, no shifted plinth, no reflow. Then open `/log`: Pull-ups must be the last row, with the
same controls in the same place as every other row, usable without a second glance. Then open `/skills` and confirm Pull-ups is simply the next tile in
`ACTIVITY` and no existing tile has moved position.

**Not run, and replaced (D-229).** The plan asks the operator to deploy a hand-edited ruleset to
a test stack. That is constructing a scenario, which D-229 forbids. It also re-verifies what the
suite proves byte for byte:
- `/` is identical.
- The new `/log` row is the same component as every other row.
- The new tile is the next one in ACTIVITY and no existing tile moves.

No perceptual question remains that two people could disagree on. The panel itself is judged
under `0073`'s operator check.

**Automated (agent, 2026-10-06, WSL host, Node 22).**
- Full suite: 154 files, 2,756 tests, green.
- `tsc` and `eslint --max-warnings 0` are clean.
- The test runs in CI on every push through `gate.yml`'s `vitest run`. The push of this commit
  is its first CI run.

