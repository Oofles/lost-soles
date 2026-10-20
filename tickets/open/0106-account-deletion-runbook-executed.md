---
id: 106
slug: account-deletion-runbook-executed
title: Account-deletion runbook, executed once against a throwaway account
type: chore
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [17, 44]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-20T17:10:35Z
---

## Description

Write the account-deletion script (`02-data-model.md` §8.5, `08-security-privacy.md` §6.4) and
**execute it once against a throwaway account**. Gate item A-5 of the D-123 Trigger A checklist
requires it to have been executed once against a test account — *that is not paperwork, it is the
only way to know the S3 prefix delete actually works.*

Order matters, and the two steps most often missed are 5 and 6:

1. **Revoke upstream first** — `POST https://www.strava.com/oauth/deauthorize` with the user's
   access token, so the third party stops being able to send data mid-deletion.
2. **Delete the `SourceAccount` row** (T7 — tokens gone; stop the inflow before the outflow).
3. **Disable, then delete, the Cognito user.** Disable first: it stops sessions immediately while
   the slower deletes run. `globalSignOut` to kill outstanding refresh tokens.
4. **Delete DynamoDB rows by `uid`** — every item under `pk` prefix `U#<uid>#` in T6, the T2/T4
   rows, T3 via GSI1, the T1 row, and any un-TTL'd T8 rows. Partition-key scoping makes this a
   query, not a scan.
5. **Delete `raw/<uid>/` and the user's `entity('identity')` prefix — under the break-glass
   role.** Bucket policy denies `DeleteObject` on `raw/*` to every principal except an explicit
   break-glass role (`01-architecture.md` §3), so this is the one step that requires deliberately
   assuming a role. **That friction is intentional: it is the difference between a bug deleting
   the archive and a person deleting it.** A runbook that quietly grants the deletion Lambda
   `raw/*` delete rights has removed the only protection the archive has.
6. **Purge noncurrent versions.** Versioning is on, so an object "deleted" in step 5 is a delete
   marker over live bytes. **A deletion that leaves the previous versions in place is not a
   deletion.** Enumerate and remove noncurrent versions for that prefix explicitly, and set a
   lifecycle rule to abort incomplete multipart uploads while you are there.
7. **Let the logs age out** under the 30-day CloudWatch retention. Do not hand-scrub log groups;
   the retention *is* the answer and is one of the reasons it is set.
8. **Confirm in writing** what was deleted and what could not be (nothing should be in that second
   category).

**And say the true thing about backups.** There are none beyond S3 versioning and DynamoDB PITR.
PITR holds deleted rows for up to **35 days**, so **a deletion is complete at the end of the PITR
window, not the moment the script exits.** State that to the requester rather than overstating it;
the same window is what would let a wrong-user deletion be undone, which is the correct trade at
this scale.

This is the one operation permitted to delete `ExploredCell` items and `raw/` objects. It must be
gated behind an **explicit typed confirmation**, and it must **never** be a side effect of
disconnecting a source — disconnecting Strava deletes `SourceAccount` and stops ingest and **does
not touch the map** (§6.5), because the explored set came from traces archived in `raw/` that
belong to the user, not to Strava (D-101).

## Acceptance criteria

- [x] The script exists in the repo, takes a `uid`, and requires the operator to type the uid to
      confirm; a non-matching confirmation aborts with zero side effects.
- [x] Steps run in the documented order; a test with each step stubbed asserts the ordering,
      including revoke-before-delete and disable-before-delete.
- [x] Step 5 assumes the break-glass role explicitly. A test asserts the **default** execution
      role cannot delete under `raw/*` (expect AccessDenied) — proving the bucket policy is real.
      *(Amended, agent 2026-10-20: proven three ways. The unit test enforces the policy's shape in
      a fake bucket; the LIVE proof is non-mutating — IAM `SimulatePrincipalPolicy` with the
      deployed bucket policy as the resource policy, run by the script's preflight on every run and
      by hand at build: `cli-user` and the process-activity role get `explicitDeny` for both
      actions, the break-glass role `allowed`, and `cli-user` without the resource policy `allowed`
      (so the deny is the bucket policy's). The script then asks S3 itself with a delete of a
      nonexistent version under a nonexistent key, which must return AccessDenied; that probe runs
      in the live execution.)*
- [ ] Step 6 enumerates and deletes noncurrent versions and delete markers; after a real run,
      `aws s3api list-object-versions --prefix raw/<uid>/` returns **zero** versions and zero
      delete markers. *(Agent 2026-10-20: the enumeration and purge are built and tested; the
      after-check is the live run's. That CLI command is broken in this environment — the SDK's
      `ListObjectVersions` is the equivalent, and the script's own after-inventory is exactly that.)*
- [ ] The lifecycle rule aborting incomplete multipart uploads exists on the bucket. *(Agent
      2026-10-20: it did NOT exist live — `NoSuchLifecycleConfiguration`. Added as infrastructure in
      `amplify/backend.ts`, synth-tested; it exists once this deploys, and the script checks it.)*
- [ ] **Executed once against a throwaway Cognito account** that had at least one real ingested
      activity — so raw objects, cells, ledger rows and explored cells all existed before the run
      — and the before/after object and item counts are pasted into
      `docs/capabilities/16-rebuild-drill.md`.
- [x] The written confirmation produced by the run states explicitly that PITR holds rows for up
      to 35 days and the deletion completes at the end of that window. *(It reads each table's PITR
      status live: as deployed only `LostSolesExploredCell` has PITR on, and the confirmation says
      which tables hold rows for the window and which were gone at once.)*
- [x] Disconnecting a source is proven **not** to trigger deletion: a test disconnects Strava and
      asserts `ExploredCell` count, `raw/` object count and `Activity` count are unchanged.

## Notes

The throwaway account must be a genuine second Cognito user with genuine ingested data. Deleting
an empty account proves the script runs; it proves nothing about whether the prefix delete, the
break-glass assumption, or the version purge work.

Note the ordering trap in the D-123 gate: creating that second Cognito account is itself **Trigger
A** (`08-security-privacy.md` §2.4). Create it, run the deletion, delete it, and record the whole
sequence — do not leave it standing. If it is going to stand for more than the length of this
test, the Trigger A gate opens and 0114 applies.

- **2026-09-29 (agent, `0067`):** account deletion must also remove
  `snapshots/skillstate/<uid>/`, the D-143 skill-state snapshots (D-259). The prefix is keyed by
  Cognito `sub`, sits outside `users/*` and `raw/*`, and is versioned like the rest of the bucket,
  so the step 6 noncurrent-version purge has to cover it too. The worker role has no delete there.

- **2026-10-15, from `0089` (D-325):** `/settings`' deletion entry already links to `docs/runbooks/account-deletion.md` on GitHub, a stub citing `08` §6.4. This ticket owns turning that file into the executed runbook and **must keep the path**; a test in `app/settings/` fails if it moves.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the laptop with the AWS console open: before the run, note the throwaway account's raw object
count and `ExploredCell` item count. Run the script. Afterwards check, in the console, that (a)
`raw/<uid>/` shows nothing with "Show versions" **enabled** — not just with it off, which is where
the missed step hides; (b) the Cognito user is gone from the pool; (c) the Strava app's authorised
applications list no longer shows the connection. Then sign in as the owner in the desktop browser and
confirm your own map is completely untouched.

## Resolution

*Build half, agent, 2026-10-20. The live execution against a throwaway account is the
orchestrator's, after deploy: criteria 4–6 stay open until it has run and
`docs/capabilities/16-rebuild-drill.md` has its counts.*

**Files touched**

- `tools/account-deletion/deletion.ts` *(new)*: the ordered run (`runAccountDeletion`), the
  read-only inventory, the archive-guard preflight (`verifyArchiveGuard`: IAM simulation against the
  live bucket policy; `probeArchiveGuard`: S3's own AccessDenied), version enumeration and purge,
  and the step-8 written confirmation (`renderConfirmation`). Every AWS seam is injected.
- `tools/account-deletion/revoke.ts` *(new)*: step 1, through each connector's own `revoke` (the
  same call as `/settings`' disconnect). No token means a recorded `no-connection`, not a failure
  (D-348).
- `tools/account-deletion/delete-account.ts` *(new)*: the operator entry point (vite-node, like
  every tool here). It wires the real clients: SDK for S3/DynamoDB, the `aws` CLI for Cognito, STS
  and IAM (no Cognito/STS/IAM SDK client is a declared dependency, and `scripts/check-auth-posture.mjs`
  already shells out the same way). It saves the confirmation to `tmp/account-deletion/`.
- `tools/account-deletion/seed-throwaway.ts` *(new)*: gives a throwaway account one genuinely
  ingested run without a real run or a Strava connection (D-229). It archives the synthetic
  `run-continuous.json` fixture (Point Nemo, D-199) with `archiveRaw`, writes the accept receipt with
  `acceptIngest`, and enqueues one `reingest` job, so the deployed worker does the rest. It refuses the
  owner, a sub that is not in the pool, and an account that already has data.
- `tools/account-deletion/deletion.test.ts` *(new)*, 17 tests, including the owner gate both ways. A fake versioned bucket enforces the
  bucket policy's shape: `raw/*` deletes are refused to all but the break-glass role, which can do
  nothing else, not even list. Alongside it sit fake tables and a fake CLI, with two users in the world.
  The tests cover: mismatch → zero events; order; every row, version and marker gone while the
  other user is untouched; D-284 counts; raw deletes only via the role; guard broken → refuses
  before the prompt; probe permitted → refuses; PITR wording; and the D-348 no-op.
- `app/api/auth/[source]/disconnect/disconnect-is-not-deletion.test.ts` *(new)*: the real
  disconnect route against a table-aware fake. `ExploredCell`, `raw/` and `Activity` counts are
  unchanged, the only change is that the tokens are gone, and there are zero S3 calls (criterion 8).
- `amplify/backend.ts`: the `AbortIncompleteMultipartUploads` lifecycle rule (7 days) on the
  user-data bucket. It is the only lifecycle rule and it expires nothing.
- `amplify/raw-archive-immutability.test.ts`: holds the lifecycle to exactly that one rule and
  action. An expiration rule would be a `raw/` deletion path around the bucket policy.
- `docs/runbooks/account-deletion.md`: the stub is now the runbook. The path is unchanged (D-325).
- `docs/capabilities/16-rebuild-drill.md`: *Account deletion, executed (`0106`)*, with placeholders
  for the live run's counts.

**Decisions made (proposed to the orchestrator, not yet in the register)**

- **The Cognito delete runs after the data deletes, not inside step 3.** Disable and global sign-out
  stay at step 3. `02` §8.5 lists the delete last. `08` §6.4 says "delete comes last". This ticket says
  disabling "stops sessions immediately while the slower deletes run", which only holds if the delete
  waits. Doing it this way also leaves a failed run resumable against a disabled user.
- **`ExploredCell` and `IngestReceipt` are enumerated by Scan, not Query.** A user's cells span many
  `U#<uid>#C#<parent>` / `#AGG#` partitions, and receipts have no user index. At this scale
  (6.5k / 123 rows) a `begins_with` / equality scan is the enumeration that cannot miss a row.
- **The multipart-abort rule is infrastructure, and the script checks it rather than setting it.**
  A script-side `PutBucketLifecycleConfiguration` would drift from CloudFormation.
- **The owner is refused without `--delete-owner`** (operator decision, relayed 2026-10-20). If the
  uid is in `OWNER_USER_IDS`, `runAccountDeletion` throws `OwnerRefused` before any AWS call, so the
  refusal has zero side effects and exits 3. With the flag, the run goes through the same preflight
  and the same typed-uid confirmation. Two tests cover the two paths, and the runbook documents it.
- **Enumeration runs as the operator; only `raw/` deletions run as the role.** The role has no
  `ListBucketVersions` and is not given any.

**Findings (live, read-only, 2026-10-20)**

- The break-glass role `LostSolesArchiveDeletion` and the `raw/*` Deny exist as the design says.
  IAM simulation against the live policy gives `cli-user` and the process-activity role
  `explicitDeny` on both delete actions on `raw/…`, and gives the break-glass role `allowed`.
- **There was no lifecycle configuration on the bucket**: `NoSuchLifecycleConfiguration`. Fixed in IaC.
- **PITR is enabled on `LostSolesExploredCell` only.** The other eight tables have it disabled, so
  `08` §6.4's "if PITR is enabled" is true for one table. The confirmation reports this per table.
- `backup/0198/t6-before.json` is an operator one-off T6 dump that the script does not cover. The
  runbook says so.
- The design text names `POST /oauth/deauthorize`, but the shipped connector uses
  `POST /oauth/revoke`, the current form chosen in `0089`. The runbook documents the shipped call.
- The read-only preflight was smoke-run against live AWS with a nonexistent uid and an answer of
  `nope`. Every table and index query resolved, the guard simulation returned
  `explicitDeny`/`allowed`, and the run exited 3 with "Nothing was changed."
