---
id: 326
slug: as-built-doc-sweep-part-2-02-03-04-05-06-07-and-09
title: As-built doc sweep, part 2: 02, 03, 04, 05, 06, 07 and 09
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
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

- [ ] Each numbered item is amended to match the build, or found already correct with the reason
      in `## Resolution`. Nits are fixed in the same pass.
- [ ] Item 5's question is answered: the I-20 allowlist covers `setActivityKind`, or a bug is filed.
- [ ] Item 10's example parses against the live validator.
- [ ] The sweep's decision from `0325` covers these docs too. If `0325` closed first, append to it;
      do not open a second decision for the same sweep.
- [ ] `node scripts/build-index.mjs` re-run; `docs/INDEX.md` committed.
- [ ] No code changes beyond the two comment fixes in item 12.

## Notes

Read only the cited line ranges via `docs/INDEX.md`. Both `0325` and this must close before
`/tickets audit 18-mvp-hardening` is re-run.

## Operator validation

None owed. Doc-only. The re-run audit's §2 is the check.

D-123 trigger checked? none.
