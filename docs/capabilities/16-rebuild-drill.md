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

_PENDING — filled in by the orchestrator after deploy._

- Throwaway account created / seeded / deleted: _timestamps_ (Trigger A open for _N_ minutes)
- Seed: `tools/account-deletion/seed-throwaway.ts`, receipt reached `DONE` at _time_
- Archive guard (preflight): _simulation decisions_, probe: _result_

| Table | Before | After |
|---|---|---|
| _paste from the confirmation_ | | |

| S3 prefix (current / noncurrent / delete markers) | Before | After |
|---|---|---|
| _paste from the confirmation_ | | |

- `list-object-versions --prefix raw/<uid>/` afterwards (SDK `ListObjectVersions`; the CLI command is
  broken in this environment): _0 versions, 0 delete markers_
- Cognito user gone from the pool: _yes/no_
- Owner's counts unchanged (T6 items, `raw/<owner>/` objects): _before → after_

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

