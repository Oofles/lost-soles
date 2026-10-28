---
id: 326
slug: as-built-doc-sweep-part-2-02-03-04-05-06-07-and-09
title: As-built doc sweep, part 2: 02, 03, 04, 05, 06, 07 and 09
type: chore
priority: high
status: closed
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
started: 2026-10-28T03:22:38Z
closed: 2026-10-28T03:55:47Z
---

## Description

The second half of the capability 18 DESIGN sweep (see `0325` for why it exists). It covers `02`,
`03`, `04`, `05`, `06`, `07` and `09`. **Amend the docs to match the build. Change no code.** Every
item was verified on 2026-10-27; re-check each against the code before editing.

**`02-data-model.md`**
1. §1.2 l. 98: "eight tables, five AppSync, three CDK". There are six AppSync models and five CDK
   tables; the doc misses `CaptureGuard` and `OAuthState` (D-456 says five CDK tables).
2. §1.2 l. 100: pmtiles on Cloudflare R2. They are in `lost-soles-tiles` on S3 behind CloudFront
   (D-226; `amplify/backend.ts:1693`).
3. §1.2 l. 56: bucket named `lost-soles-storage`. It is `defineStorage` `lostSolesUserData`
   (`amplify/storage/resource.ts:42`). *Nit:* "IndexedDB is pure cache" omits the offline log queue
   (`lib/log/queue.ts`).
4. §3.2 l. ~761–766, ~795–798: a `RuleSkill` table "seeded verbatim into T5" and a `__curve__`
   item. No T5, no seeder; rules ship bundled (D-274, D-276). *Nits:* I-6 "partition in T5", I-24
   "plus one seeded T5 item".
5. §9 I-20 (l. 2209): client writes only "through the `logWorkout` mutation". `setActivityKind`
   also re-scores XP, writes cells and puts and deletes non-floor ledger rows
   (`amplify/backend.ts:1957–1968`, `kind-rescore.ts:352`). I-18's "only a replay deletes
   `isFloor:false` rows" misses the same path. **Check whether `setActivityKind` is in the I-20 test's
   mutation allowlist. If the code is fine and only the statement is stale, amend the doc. If the
   test's allowlist is missing it, file a bug.**
6. §9 I-28 (l. ~2232): CI asserts "the webhook role's policy names only the index ARN". The webhook
   holds no grant on SourceAccount at all (D-343, D-365; `ingest-webhook-stack.test.ts`).

**`03-integrations.md`**
7. §2.6 amendment: the speed-gate table "lives in `src/adapters/strava/sanitize.ts`", shared by
   D-112/D-113. It moved to `src/domain/geo.ts` (0045); the anchor rule stays Strava-private
   (D-100). *Nits:* step 3 of "Handling" says a traceless run "still awards Wayfaring XP" (it is
   Vigil, as the table note above it says); §2.2 "Connection row" is `SourceAccount`.

**`04-game-design.md`**
8. §1.2 l. ~118: "TotalXP is displayed underneath" Total Level on home. D-462: `/skills` only.
9. §1.3 l. 161/165: registry "currently v2". v3 is live (D-286, Vigil `treadmill`).
10. §1.3's "Adding a workout type is exactly this diff" example would fail the validator. It lacks
    `enabled`, `introducedIn` and `revealsGround` (all required) and uses a top-level `skill:`
    back-reference the excerpt above forbids. Make it pass: `check-doc-ruleset.mjs` should parse
    it, or a test should. *Nits:* "seeded VERBATIM into T5", "one seeded registry item".

**`05-fog-of-war.md`**
11. §6.3: the budget table has no row for the atlas cold pass (wash + full-frame copy, D-147),
    measured by `0298` at 0.13–0.15 ms on the RTX 5080.
12. §6.3 l. 1505: column headed "Mid-range phone". D-251 removed the phone; budgets are desktop
    (D-241). *Nits:* §8.3 "`explored-r10.bin`" is `explored-r11.<gen>.bin` (D-237); the §2.2 D-212
    note refers to "the 12.0 written above", which the constants block no longer shows; a code
    comment in `src/domain/fog.ts` `segmentsToCells` step 5 says "a vertex every 30 m" (it is 12 m),
    and `lib/run-moment/seen.ts:14` says `explored-r10.bin`. Those two are comment-only, so fix them
    here.

**`06-ui-ux.md`**
13. §9.4 l. 1796–1797 and the §9.6 "200% browser zoom" row (l. ~1849): the skills grid drops to two
    columns at ≥1.3× and one at ≥1.8×. It is three, or five at ≥1024px, and nothing between (D-289).
    `run-zoom.mjs` passes 24/24 without the steps.
14. §9.4 l. 1795: cold ground "gets a one-time three-swatch legend". D-394 withdrew it; §4.6 was
    amended, §9.4 was not. *Nits:* §9.4's map-summary example and §9.5's "Last: Thu · 8.4 km" differ
    from the shipped format (D-316). The tile-announcement example waits on `0324`, so leave it.

**`07-ticketsmith.md`**
15. §2.4: the read route and webhook "are capability 17's 0110". 0110 was declined (D-252) and `17`
    withdrawn. The diagram still shows a read cache, a GitHub push webhook and a phone IndexedDB
    capture queue. What exists is capture writing to `tickets/inbox/` and `tickets.mjs` triage.

**`09-roadmap.md`**
16. §9.1: "seven MVP skills". v1 ships nine enabled (D-189; `04` §1.1). *Nits:* §9.2 "I-1…I-26"
    (I-1…I-30), the intro's "`18`/6 is the ticket" (`0117`), §9.4 `nightly-reconcile`
    (`reconcile-sweep`, D-350), §2.3's "the only alarm this app needs" (three, D-351) and the
    "parchment fork later" (D-373 keeps stock colours). §2.3 is a dated milestone snapshot, so
    annotate it rather than rewrite it.

## Acceptance criteria

- [x] Each numbered item is amended to match the build, or found already correct with the reason
      in `## Resolution`. Nits are fixed in the same pass. *(All sixteen amended. One nit left by
      instruction: `06` §9.4's tile-announcement sentence belongs to `0324`; see Resolution.)*
- [x] Item 5's question is answered: the I-20 allowlist covers `setActivityKind`, or a bug is filed.
      *(It covers it: `amplify/log-workout-mutation.test.ts` pins `type Mutation` to exactly
      `["logWorkout", "setActivityKind"]`. No bug; the doc was stale.)*
- [x] Item 10's example parses against the live validator. *(Checked by hand: the block, appended
      to v3 as a v4, gives `validateRuleSet` → `[]`, and dropping `enabled` gives one error. No
      CI check parses this block: `check-doc-ruleset.mjs` does not read it and
      `src/rules/doc-schema.test.ts` reads only §1.3's first `yaml` block. Wiring it in is test
      code, which the last criterion forbids here, so it is proposed as a follow-up.)*
- [x] The sweep's decision from `0325` covers these docs too. If `0325` closed first, append to it;
      do not open a second decision for the same sweep. *(Both run in parallel in wave 18.9. This
      half is proposed as `D-NEW-a` and the docs cite it as `D-NEW-sweep`; the orchestrator merges
      it with `0325`'s into one `D-xxx` and replaces the placeholder.)*
- [x] `node scripts/build-index.mjs` re-run; `docs/INDEX.md` committed. *(Not done by this agent:
      WAVES.md §3 gives `docs/INDEX.md` to the orchestrator, who regenerates it at merge.)* *(Done in `14ba0fd`.)*
- [x] No code changes beyond the two comment fixes in item 12.

## Notes

Read only the cited line ranges via `docs/INDEX.md`. Both `0325` and this must close before
`/tickets audit 18-mvp-hardening` is re-run.

## Resolution

Docs amended in place to match the build. I re-checked every item against the code before editing.
Each change keeps the old text visible: it is struck through, or quoted in an "Amended" or "As
built" note that cites the decision behind it and `D-NEW-sweep`. The orchestrator swaps that
placeholder for the merged sweep decision when it lands with `0325`'s half.

### Item by item

**`docs/02-data-model.md`**
1. §1.2: "eight tables" is now **eleven**, named one by one. Six are `defineData`: `Activity`,
   `Profile`, `SkillState`, `XpLedgerEntry`, `Landmark` and `DeploySmokeTest`, checked against
   `amplify/data/resource.ts`. Five are CDK: `ExploredCell`, `SourceAccount`, `IngestReceipt`,
   `OAuthState` and `CaptureGuard`, checked against the `new Table(` calls in `amplify/backend.ts`.
   §2.2 gains a note under the table index: T5 was never built, and three tables have no number.
2. §1.2: pmtiles now sit on the S3 bucket `lost-soles-tiles` behind our own CloudFront (D-226),
   not on Cloudflare R2.
3. §1.2: the bucket is `defineStorage({ name: "lostSolesUserData" })`, and Amplify generates its
   physical name, so `lost-soles-storage` is only a label for the tree. *Nit:* IndexedDB also
   holds the `/log` write queue (`lib/log/queue.ts`, D-282). That queue is not a cache.
4. §3.2: the "seeded verbatim into T5" paragraph is struck through. The new text says the attribute
   table describes a row in the bundled ruleset file, and `check-doc-ruleset.mjs` still holds it to
   that file. The `__curve__` item is now the top-level `curve:` block. Annotated where they assert
   T5 as current: the T5 section, §3.3, the Vigil test (§3.5 "As a T5 item", "iterate T5", "one
   seeded item" twice), AP-8, the §7.1 version table, §7.3 and I-6 and I-24 (the nits). Left alone:
   prose that only names T5 as the original plan, e.g. §3.8 and §4.4, which D-276 already amended.
5. I-20 now names both custom mutations and the tests that pin them. **The allowlist was already
   right:** `amplify/log-workout-mutation.test.ts` asserts `type Mutation` is exactly `logWorkout`
   and `setActivityKind`, so there is no bug. I-18 now says a kind correction also deletes
   non-floor rows, under `isFloor = false` (`src/pipeline/kind-rescore.ts:352`), and that it
   floors any shortfall (D-142).
6. I-28: the "names only the index ARN" clause is struck through. The webhook holds no grant on T7
   (D-343, D-365), and `amplify/ingest-webhook-stack.test.ts` asserts that. The token-field
   assertion is pinned to `lib/sources/source-account-store.test.ts`.

**`docs/03-integrations.md`**
7. §2.6 trace sanitation: both claims that the code "lives in / is shared from `sanitize.ts`" are
   amended. The speed-gate table is `MAX_IMPLIED_SPEED_MS` in `src/domain/geo.ts` (`0045`). The
   anchor rule stays Strava-private in `sanitize.ts` (D-100). *Nits:* the traceless step 3 now
   says "activity XP", with a note that this is Vigil. In §2.2, the "`Connection` row" is now
   `LostSolesSourceAccount` (T7).

**`docs/04-game-design.md`**
8. §1.2: Total XP is shown in the `/skills` header, not under Total Level on home (D-462).
9. §1.3: "currently v2" is now "currently v3", which adds `treadmill` and changes no number (D-286).
   The excerpt stays v2's, because `src/rules/doc-schema.test.ts` compares it with
   `loadRuleSet(2)`. v3's scoring fields equal v2's byte for byte, so it is still accurate.
10. The "exactly this diff" example is rewritten as a single `grip` row for a new `v4`. It adds
    `enabled`, `introducedIn: 4`, `groundMultipliers: null` and `revealsGround: false`, and nests
    its `exercises`, which drops the top-level `skill:` back-reference. The row id was `pullups`,
    while the old exercise row said `skill: grip`; it is now `grip`. **Which validator:** nothing in
    CI parses this block. I checked it by hand with `validateRuleSet` (`src/rules/validate.ts`) on
    v3 plus this row as v4: zero errors. With `enabled` removed: one error. The doc now says that
    CI does not cover it. *Nits:* "seeded VERBATIM into T5" (in the Might exercise comment) and
    "one seeded registry item" (the Vigil verdict) fixed.

**`docs/05-fog-of-war.md`**
11. §6.3: new row for the atlas cold pass (D-147, atlas only per D-391): 0.13–0.15 ms mean,
    1.4 ms max. Measured by `0298` on the RTX 5080 at 1919×1023 with 150k cells.
12. §6.3: the "Mid-range phone" column is now "Desktop GPU budget" (D-251, D-241), with a note
    that `lib/fog/perf/report.ts` enforces the mask and composite figures. *Nits:* §8.3's
    `explored-r10.bin` is now `explored-r11.<gen>.bin`. §2.2's D-212 note no longer points at "the
    12.0 written above"; it records that the literal used to be there. **Code comments, the only
    code change:** `src/domain/fog.ts` step 5 said "a vertex every 30 m … ~1.7 m". It now says
    12 m and ~0.3 m. The 1.7 was √(65²+15²)−65; at the 12 m step it is √(65²+6²)−65. In
    `lib/run-moment/seen.ts`, `explored-r10.bin` is now `explored-r11.<gen>.bin`. That comment
    no longer quotes `06` §3.4, which does not contain the phrase any more.

**`docs/06-ui-ux.md`**
13. §9.4 zoom bullet: three columns below 1024px, five at or above, nothing between (D-289; the CSS
    is in `app/skills/skills-panel.tsx`). §9.6's 200% row says the same.
14. §9.4: the three-swatch legend is struck through, citing D-394. *Nits:* §9.5's "Last: Thu ·
    8.4 km" is now D-316's `Last: Fri 28 Aug · 8.40 km · 21 new`. The shipped map summary
    (`mapSummary`, `lib/plinth/model.ts`) is in an "As built" paragraph at the end of §9.4, not in
    the screen-reader bullet. That bullet's line also holds "Skill tiles announce …", which
    `0324` owns, so I left both untouched to avoid a merge conflict.

**`docs/07-ticketsmith.md`**
15. §2.4: a new "AS BUILT" block at the top draws what exists: capture goes to `tickets/inbox/`,
    then `tickets.mjs triage-move`. It says the read route, read cache, push webhook and phone
    IndexedDB queue were `0110`'s and were declined with `17` (D-252, D-251). The old diagram
    stays as the record. The `0154` note now says "declined", not "are capability 17's".

**`docs/09-roadmap.md`**
16. §9.1: the "seven skills" box is struck through and replaced with "every enabled row". `v1`
    ships nine (D-189), which I counted in both `v1` and `v3`. *Nits:* I-1…I-30; `0117` in
    place of "`18`/6"; `reconcile-sweep` (D-350); §2.3 gets a "dated snapshot" note plus two
    "later" annotations (three alarms per D-349/D-351; stock colours kept per D-373), and is
    not rewritten.

### Decisions
No new decision of my own. The orchestrator merges this half of the sweep decision (`D-NEW-a` in
the report) with `0325`'s.

### Found, not fixed (out of scope here)
- `amplify/data/resource.ts`'s header comment still says "five `defineData` models … plus three raw
  CDK" tables. Fixing it is a code change beyond item 12, so it is proposed as a follow-up.
- `src/rules/doc-schema.test.ts` compares with `loadRuleSet(2)`, though its comment says "the
  newest version". The result is the same today, because v3's scoring fields equal v2's. It also
  never parses §1.3's second block (item 10). Both go in the same follow-up.

### Files touched
`docs/02-data-model.md`, `docs/03-integrations.md`, `docs/04-game-design.md`,
`docs/05-fog-of-war.md`, `docs/06-ui-ux.md`, `docs/07-ticketsmith.md`, `docs/09-roadmap.md`,
`src/domain/fog.ts` (comment), `lib/run-moment/seen.ts` (comment), this ticket.

**Orchestrator, at merge (wave 18.9, 2026-10-27).** Cherry-picked onto `main` cleanly. The
two halves' proposed `D-NEW-a` were merged into one decision, **D-465**, and every `D-NEW-sweep`
placeholder in `docs/` was replaced with it in `14ba0fd` (`wave 18.9: decisions and indexes`).
The mentions of `D-NEW-sweep` above are left as written: they record what the agent saw. The proposed
ticket was filed as `0328` (doc-check gaps: the add-a-skill example is not parsed by CI, the doc-schema
test is pinned to v2, the `resource.ts` header is stale). On open question 1: the shipped map-summary
wording stays as its own "As built" paragraph, since `0324` changed only the tile sentence.

## Operator validation

None owed. Doc-only. The re-run audit's §2 is the check.

D-123 trigger checked? none.

**Result (orchestrator, 2026-10-27).** Doc-only plus two comments, so nothing deployed to poke. The
checks: Amplify job 439's build ran every `amplify.yml` guard on the merged tree, including
`check-doc-ruleset.mjs`, which confirms `04` §1.1/§1.2/§3.2 and `02` §3.2 agree with ruleset v3. The
I-20 claim was confirmed in code: `amplify/log-workout-mutation.test.ts:60` pins the mutations to
`["logWorkout","setActivityKind"]`. The re-run audit is the sweep's real check.
