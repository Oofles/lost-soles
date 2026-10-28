---
id: 325
slug: as-built-doc-sweep-part-1-08-security-privacy-01-architectur
title: As-built doc sweep, part 1: 08 security-privacy, 01 architecture, ingestion contract
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
started: 2026-10-28T03:22:38Z
---

## Description

The capability 18 drift audit (2026-10-27) found about 25 places where the design docs describe
something the build no longer does. In each one the code is right and a later decision backs it.
That is over AUDIT.md §2's drift budget of three, so the operator chose a DESIGN sweep followed by a
re-audit instead of a forced record. Most of the drift came in during capabilities 01–16. It sat in
broad sections that no later ticket re-cited, so no per-capability audit re-read them.

This ticket covers `08-security-privacy.md`, `01-architecture.md` §2 and
`docs/contracts/ingestion-contract.md`. `0326` covers the rest. **Amend the docs to match the build.
Change no code.** Every item below was verified on 2026-10-27; re-check each against the code before
editing, since the list is a pointer and not the authority.

**`08-security-privacy.md`**
1. §2.4: C-2 (l. ~236–241) says a prerender CI check "belongs here". C-3 covers only authed
   responses. Name what 0114 actually built: `check-prerender-no-cell-data.mjs` (D-430),
   `check-route-cache-control.mjs` + `withNoStore` (D-429), `check-d123-trigger-a.mjs` reading the
   live pool (D-426), `check-d123-trigger-b.mjs` (D-427). §2.5 (l. ~291) "That is the whole
   enforcement mechanism" is now false. *Nits:* "a new decision (`D-2xx`)" (l. 151); C-1 says "the
   sign-in page" (it is `/`, the signed-out landing); C-1 omits `/_next/image`, which the middleware
   matcher exempts. Check it serves nothing derived from cells before listing it as safe.
2. §5.5 l. 728: the owner is "compared against an SSM parameter". It is the committed constant
   `OWNER_USER_IDS` in `lib/auth/owner-ids.ts`, hard-coded on purpose.
3. §5.5 l. 726–727: the owner role gates `POST /api/tickets/capture` "and nothing else". `isOwner`
   also gates `app/sync-action.ts`, `app/api/auth/[source]/shared.ts`, `app/settings/page.tsx`, the
   logWorkout and setActivityKind handlers, `lib/sources/reconcile-sweep.ts` and `lib/auth/bearer.ts`.
   The §9 row "One privileged action exists" (l. ~1267) repeats it. *Nits:* the model list omits
   `DeploySmokeTest` (`amplify/data/resource.ts:515`). l. 731 "process-activity and token-refresh"
   leaves out reconcile-sweep, log-workout and set-activity-kind.
4. §7.5 l. 1057: "`npm ci` in CI". CI runs `npm install --no-save` (D-162; `amplify.yml:11,38`,
   `gate.yml:47`). Revert is ticket `0128`, deferred.
5. §9 l. ~1263: "Customer-managed KMS keys" listed under not-doing. T7 `LostSolesSourceAccount`
   uses one (`amplify/backend.ts:347,387`; `02` T7; D-433, $1/mo). Carve T7 out.
6. §9 l. ~1281: "a budget alarm (§4.4)" among the controls the system has. None exists (D-361,
   D-464). Check §4.4 for the same claim.
- *Nits:* §3 S6/S7 say "via `secret()`"; the backend no longer uses `secret()` (0290). §8's Lambdas
  row omits logworkout and setactivitykind.

**`01-architecture.md` §2**
7. Row 5 (l. 207): models `Profile, Skill, Activity, Region, Ticket`. Real: `Activity, Profile,
   SkillState, XpLedgerEntry, Landmark, DeploySmokeTest` (`amplify/data/resource.ts`).
8. The diagram and row 4 show process-activity sending a GraphQL mutation and a browser wss
   subscription ("real-time subscriptions"). D-364 dropped that path.
9. "Every resource" omits the `LostSolesOAuthState` table, the `log-workout` and
   `set-activity-kind` Lambdas, the `SourceAccountKey` CMK, the `IngestAlarms` SNS topic and its 3
   alarms, and the `LostSolesArchiveDeletion` role (`amplify/backend.ts:347,422,549,1590,1620,2135,2251`).
10. "Only process-activity and token-refresh get IAM grants" on tokens. `computeRole`
    (`backend.ts:472`) and `reconcileLambda` (`:2188`) also do (D-362 counts four).
11. Row 2 and the diagram say "Email + passkey". Auth is email only (`amplify/auth/resource.ts:27`).
    Then check `08` §5.2, which leans on passkeys ("Passkeys are already phishing-resistant", §9 MFA row).

**`docs/contracts/ingestion-contract.md`**
12. §3 omits `OAuthConnector`, `OAuthGrant`, `OAuthRefresh`, `GrantCheck` and
    `OAuthClientCredentials`, which `src/adapters/types.ts` exports.
13. §4 puts "4. SANITIZE" after "3. DEDUPE" as its own step. Sanitation runs inside `normalize()`
    (`src/adapters/strava/normalize.ts:347`, `process-activity.ts:487`), before dedupe.

## Acceptance criteria

- [ ] Each numbered item is amended to match the build, or found already correct with the reason
      recorded in `## Resolution`. Nits are fixed in the same pass.
- [ ] One decision is recorded in `docs/decisions/DECISIONS.md` for the sweep. It names the
      decisions whose effects the docs now reflect. It edits no settled decision; superseded entries
      get a back-pointer only where a reader would otherwise take a stale line as current. D-451's
      "responses are gzipped in transit", contradicted by D-460, is the one the audit named.
- [ ] `node scripts/build-index.mjs` is re-run and `docs/INDEX.md` committed.
- [ ] No code changes in this ticket. A divergence that turns out to be a code bug is filed as a new
      ticket (`source: agent`), not fixed here.

## Notes

Read only the cited line ranges via `docs/INDEX.md`; never a whole doc. Pairs with `0326`; both
must close before `/tickets audit 18-mvp-hardening` is re-run. Code bugs from the same audit:
`0322`, `0323`, `0324` (plus `0279`, `0313` in other capabilities).

## Operator validation

None owed. Doc-only. The re-run audit's §2 is the check.

D-123 trigger checked? none. It describes existing enforcement; it proposes no feature.
