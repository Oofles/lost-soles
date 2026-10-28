---
id: 325
slug: as-built-doc-sweep-part-1-08-security-privacy-01-architectur
title: As-built doc sweep, part 1: 08 security-privacy, 01 architecture, ingestion contract
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
closed: 2026-10-28T03:55:46Z
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

- [x] Each numbered item is amended to match the build, or found already correct with the reason
      recorded in `## Resolution`. Nits are fixed in the same pass.
- [x] One decision is recorded in `docs/decisions/DECISIONS.md` for the sweep. It names the
      decisions whose effects the docs now reflect. It edits no settled decision; superseded entries
      get a back-pointer only where a reader would otherwise take a stale line as current. D-451's
      "responses are gzipped in transit", contradicted by D-460, is the one the audit named.
      *(Done by the orchestrator in `14ba0fd`: D-465, merged from both tickets' proposals; D-451's
      "Measured" bullet carries a `→ Corrected by D-460` back-pointer. No settled decision edited.)*
      *(Not done by the wave agent, which may not edit DECISIONS.md (WAVES.md §3). The half for
      this ticket and the D-451 back-pointer text are proposed in the agent's report. The
      orchestrator merges them with `0326`'s into one decision and replaces the `D-NEW-sweep`
      placeholder in the three docs.)*
- [x] `node scripts/build-index.mjs` is re-run and `docs/INDEX.md` committed.
      *(Left to the orchestrator: a wave agent leaves `docs/INDEX.md` stale (WAVES.md §3).)* *(Done in `14ba0fd`: 13 documents, 559 sections.)*
- [x] No code changes in this ticket. A divergence that turns out to be a code bug is filed as a new
      ticket (`source: agent`), not fixed here.

## Notes

Read only the cited line ranges via `docs/INDEX.md`; never a whole doc. Pairs with `0326`; both
must close before `/tickets audit 18-mvp-hardening` is re-run. Code bugs from the same audit:
`0322`, `0323`, `0324` (plus `0279`, `0313` in other capabilities).

## Operator validation

None owed. Doc-only. The re-run audit's §2 is the check.

D-123 trigger checked? none. It describes existing enforcement; it proposes no feature.

**Result (orchestrator, 2026-10-27).** Doc-only, so nothing deployed to poke. The checks: Amplify job 439's
build ran every `amplify.yml` guard on the merged docs. The facts the docs now state were read live
(`--profile devault`): the Cognito pool has `MfaConfiguration: OFF`, `UsernameAttributes: [email]`,
`AllowedFirstAuthFactors: [PASSWORD]` (no passkey). `check-d123-trigger-b.mjs` reports Trigger B not
fired on the added lines. The re-run of `/tickets audit 18-mvp-hardening` is this sweep's real check.

## Resolution

Doc-only. Every item was re-checked against the code on 2026-10-27 before editing, and each
amendment is marked in place with what the line used to say. `D-NEW-sweep` in the docs is a
placeholder for the one sweep decision the orchestrator records from this ticket's and `0326`'s
proposals.

Files touched:

- `docs/08-security-privacy.md`: items 1–6 and the nits.
- `docs/01-architecture.md`: items 7–11, §2 plus the §1 stack row for auth.
- `docs/contracts/ingestion-contract.md`: items 12–13.
- This ticket file.

Per item:

1. **§2.4/§2.5.** C-2 and C-3 now name what `0114` built: `check-prerender-no-cell-data.mjs`
   (D-430), `withNoStore` plus `check-route-cache-control.mjs` (D-429). Triggers A and B each gained
   an "Enforced" paragraph for `check-d123-trigger-a.mjs` (D-426, live pool) and
   `check-d123-trigger-b.mjs` (D-427). §2.5 no longer says three placements are the whole
   mechanism. Nits: `D-2xx` is `D-xxx` in the standing rule, A-3 and §5.4 step 3. C-1 now says `/`
   is the signed-out landing (no sign-in route exists) and lists every middleware matcher exemption.
   **`/_next/image` was checked before being listed as safe.** The app uses no `next/image` and sets
   no `images` config, so only same-origin paths are allowed. In Next 15.5.28
   `fetchInternalImage` builds its mock request with no headers from the caller
   (`node_modules/next/dist/server/image-optimizer.js`), so the internal fetch is signed out, and a
   body that does not sniff as an image is refused. It serves nothing derived from cells.
2. **§5.5 owner store.** Now `OWNER_USER_IDS` in `lib/auth/owner-ids.ts`, hard-coded on purpose,
   with the file's own reasons.
3. **§5.5 owner gates.** Listed from a grep of `isOwner`/`OWNER_USER_IDS`: capture, the
   `[source]` start/callback/disconnect routes (`shared.ts`), `sync-action.ts`, `/settings`, and the
   two mutation handlers. `reconcile-sweep` uses the list as its set of users to sweep, which is not
   a gate, and is described that way. **The ticket's pointer was wrong on `lib/auth/bearer.ts`.**
   It mentions `OWNER_USER_IDS` only in a comment and verifies a token against the production pool
   without checking the owner list, so it is not listed. §9's "one privileged action" row is
   rewritten to match. Nits: `DeploySmokeTest` added to the model list. The Lambdas bullet now names
   all five Lambdas that hold grants.
4. **§7.5.** `npm install --no-save` on both surfaces, D-162, revert under `0128`.
5. **§9 KMS row.** T7's CMK is carved out, with its reason (auditable, revocable) and cost (D-433).
6. **§9 controls list.** "a budget alarm (§4.4)" removed with a note (D-361, D-464). §4.4 item 7
   was already correct: it carries D-361's as-built note.
   Nits: §3 S6/S7 no longer say "via `secret()`" (`0290`). §8's Lambdas row adds `logworkout…` and
   `setactivitykind…`, read from the live account with `aws lambda list-functions`.
7. **01 row 5.** The six real models.
8. **01 diagram + row 4.** The mutation and wss arrows are gone. `process-activity` is shown
   writing the model tables with `TransactWrite`, and the browser reads through AppSync queries.
   Row 4 says no subscriptions (D-364). The closing line of "Why the cell store…" no longer credits
   real-time subscriptions.
9. **01 resource table.** Rows 22–27 added: `log-workout`, `set-activity-kind`,
   `LostSolesOAuthState`, `SourceAccountKey`, `IngestAlarms` with its three alarms, and
   `LostSolesArchiveDeletion`. A note covers the hand-made, imported `LostSolesAmplifyComputeRole`.
   The diagram gained the two resolvers and the alarm line. Row 17 (SSM) said `secret()` at the
   branch path, and now gives the shared path with explicit grants.
10. **01 token grants.** The four principals of D-362.
11. **Passkeys.** 01 row 2, the §1 stack row and the diagram now say email + password. In `08`:
    §5.1 has an as-built note, §5.2 an as-built box saying what still holds (the inbox is the
    boundary, break-glass is the console), §5.4 step 5 says "sets their password", and §9's MFA row
    is marked. **No decision ever dropped passkeys.** `0014` deferred them under `09` §2.3, and
    D-175/D-425 replace Cognito after the MVP. The passkey premise behind §9's "no MFA" row is
    therefore gone. The docs say "not yet decided" rather than inventing an acceptance, and the
    question is in the agent's report (D-152).
12. **Contract §3.** An as-built block lists the five OAuth exports (plus `RetractConfirmation`),
    abridged from `types.ts`, which stays the authority.
13. **Contract §4.** SANITIZE moved inside `normalize()`, ahead of dedupe, with an amendment note.
    Step numbers 5–7 are kept so existing citations still resolve.

Found but left alone (outside this ticket's sections): `01-architecture.md`'s module-layout tree
(~l. 1063) still lists `sign-in/page.tsx` "(passkey-first)". No such route exists (middleware
serves `/` signed out). It belongs to §5's layout, which neither sweep ticket covers. The agent's
report flags it.

No code changed. No code bug found: every divergence was a stale doc.

**Orchestrator, at merge (wave 18.9, 2026-10-27).** Cherry-picked onto `main` cleanly. The
two halves' proposed `D-NEW-a` were merged into one decision, **D-465**, and every `D-NEW-sweep`
placeholder in `docs/` was replaced with it in `14ba0fd` (`wave 18.9: decisions and indexes`).
The mentions of `D-NEW-sweep` above in this ticket are left as written: they record what the agent saw.

On open question (c), the stale `sign-in/page.tsx` line in `01`'s module tree: no change. The note
directly above that tree already marks it as the original plan and lists "no `/sign-in` route" among
the deliberate absences. Open question (a), the MFA basis, is put to the operator with the wave's checks.
