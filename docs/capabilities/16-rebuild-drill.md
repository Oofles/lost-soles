# 16-rebuild-drill

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`16-rebuild-drill\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0102` — Rebuild drill steps 1-3 — enumerate raw/, normalize in parallel, sort
- `0103` — Rebuild drill steps 4-8 — re-project cells, fold, replay XP, verify, cut over never
- `0104` — CI rebuild drill on every build against a ~20-object fixture spanning every SourceId
- `0105` — EXECUTE THE DRILL FOR REAL, once, before MVP ship — four numbers pasted or it did not happen
- `0106` — Account-deletion runbook, executed once against a throwaway account

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Account deletion, executed (`0106`)

The runbook is [`../runbooks/account-deletion.md`](../runbooks/account-deletion.md); the script is
`tools/account-deletion/delete-account.ts`. Gate item **A-5** of D-123 Trigger A (`08` §2.4) needs it
executed once against a throwaway account with genuinely ingested data. That execution:

Executed 2026-10-20 by the orchestrator (wave 16.1), from the laptop, `AWS_PROFILE=devault`.

- Throwaway account `drill-0106@example.invalid`, sub `f4183488-a0a1-702e-5354-3f957fe2e8f6`:
  created 18:04:29Z, seeded 18:04:41Z, deleted by the run 18:05:31Z → 18:05:38Z. **Trigger A was
  open for about 70 seconds** and is closed: the account no longer exists.
- Seed: `tools/account-deletion/seed-throwaway.ts` archived the synthetic `run-continuous.json`
  (Point Nemo) under `raw/<sub>/strava/18736594040/` and enqueued one job; the real
  `process-activity` worker took the receipt to `DONE` within seconds.
- Archive guard (preflight, IAM simulation against the live bucket policy): `cli-user` →
  `explicitDeny` for `s3:DeleteObject` and `s3:DeleteObjectVersion`; `LostSolesArchiveDeletion` →
  `allowed` for both. Live probe: `AccessDenied` for the default credentials.
  - **The first attempt aborted with zero side effects**: the probe's made-up `VersionId` got
    `InvalidArgument`, because S3 checks the id's format before authorisation. The probe now uses
    the literal `"null"` version id, which S3 accepts; the second attempt is the one recorded here.
- Upstream: `strava no-connection` (no `SourceAccount` row — recorded no-op, D-348).

| Table | Before | After |
|---|---|---|
| SourceAccount | 0 | 0 |
| ExploredCell | 10 | 0 |
| Activity | 1 | 0 |
| XpLedgerEntry | 3 | 0 |
| SkillState | 3 | 0 |
| Landmark | 0 | 0 |
| Profile | 1 | 0 |
| IngestReceipt | 1 | 0 |
| OAuthState | 0 | 0 |

| S3 prefix (current / noncurrent / delete markers) | Before | After |
|---|---|---|
| `raw/<sub>/` | 1 / 0 / 0 | 0 / 0 / 0 |
| `users/<sub>/` | 9 / 0 / 0 | 0 / 0 / 0 |
| `snapshots/skillstate/<sub>/` | 1 / 0 / 0 | 0 / 0 / 0 |

- "What could not be deleted": **Nothing.** The confirmation states PITR's 35-day window for
  `LostSolesExploredCell` (complete 2026-11-24T18:05:38Z) and lists the eight tables without PITR
  (D-404, `0300`).
- Independent check afterwards, SDK `ListObjectVersions` (the CLI command is broken in this
  environment): `raw/<sub>/`, `users/<sub>/` and `snapshots/skillstate/<sub>/` each 0 versions,
  0 delete markers.
- Cognito user gone: `list-users --filter 'sub = "<sub>"'` returns `[]`.
- Owner untouched: item counts of all eleven tables (ExploredCell 6,491, Activity 116,
  XpLedgerEntry 368, IngestReceipt 123, …) and the bucket's total (1,436 objects) are identical
  before the seed and after the deletion.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

