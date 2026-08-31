# Lost Soles

A fitness tracker where running reveals a permanent fog-of-war over a real map, wrapped in a
Runescape-style skill progression system. Built for one person.

**Status: fully planned, nothing built.** No code exists. The next action is ticket `0001`.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand why this exists and what it refuses to be | [`docs/00-vision.md`](docs/00-vision.md) |
| Know what was decided and why | [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md) |
| Start building | [`docs/09-roadmap.md`](docs/09-roadmap.md), then `tickets/open/0001-*.md` |
| Change something | Find the `D-xxx` in the decision log first. It records the reasoning, not just the choice. |

## The design

| Doc | What it settles |
|---|---|
| [`00-vision.md`](docs/00-vision.md) | Goals, principles, non-goals, the one-sentence test |
| [`01-architecture.md`](docs/01-architecture.md) | Stack, AWS topology, adapter architecture, cost |
| [`02-data-model.md`](docs/02-data-model.md) | DynamoDB schema, the XP ledger, 30 invariants |
| [`03-integrations.md`](docs/03-integrations.md) | Strava adapter, raw archive, future sources |
| [`04-game-design.md`](docs/04-game-design.md) | Skills, the `4L²` XP curve, combat (post-MVP) |
| [`05-fog-of-war.md`](docs/05-fog-of-war.md) | H3 projection, discovery scoring, WebGL rendering |
| [`06-ui-ux.md`](docs/06-ui-ux.md) | Screens, the post-run moment, visual system |
| [`07-ticketsmith.md`](docs/07-ticketsmith.md) | This ticket system |
| [`08-security-privacy.md`](docs/08-security-privacy.md) | Threat model, secrets, the D-123 trigger |
| [`09-roadmap.md`](docs/09-roadmap.md) | 19 capabilities, build order, definition of done |
| [`contracts/ingestion-contract.md`](docs/contracts/ingestion-contract.md) | **Canonical** `Activity` / `Trace` / `SourceAdapter` |

`docs/research/` holds the ten research briefs the design rests on. Read them when you want to know
*why* a constraint exists — most were expensive to establish.

## The shape of it

- **Fog of war.** Every run permanently reveals ~65 m either side of your path, stored as H3
  resolution-10 cells. The map never re-fogs. Five years of running is ~300–450 KB gzipped, so the
  whole explored set ships to the browser once per session — no tile server, no viewport queries.
- **Skills.** Activity skills 1:1 with exercises (Wayfaring, Vigil, Might, Fortitude, Endurance)
  plus meta skills (Cartography, Constitution). `4L²` XP curve — Runescape's exponential curve was
  evaluated and rejected, because fed real mileage it puts level 99 at 126 years.
- **Adding a workout type is a data row, not code.** Enforced permanently in CI.
- **Ingestion is source-agnostic.** Strava is one replaceable adapter behind a normalized contract.
  Every raw trace is archived to S3 before normalization, so switching sources loses nothing.
- **Runs about $1–5/month.**

## Tickets

```
tickets/open/     118 tickets, 0001-0119
tickets/closed/   completed
tickets/inbox/    unnumbered phone captures awaiting triage
```

Markdown on disk is the only source of truth. The phone **creates** (into `inbox/`); the agent
**numbers, edits and moves**. Those write sets are disjoint by construction, which is why there is
no sync engine and no merge conflicts.

Use `/tickets` — see [`docs/07-ticketsmith.md`](docs/07-ticketsmith.md) §4. Adapted from
[ticketsmith](https://github.com/Oofles/ticketsmith).

## Before the first commit

1. **`0002` — rotate the AWS key** in `~/devaultsecurity/.claude/settings.local.json` and gitignore
   it. Not leaked, but one `git add .` away. Rotate *first*, then gitignore, then de-inline.
2. **`0001` — audit CloudFront** for orphaned `devaultsecurity.com` aliases, or adding the
   subdomain fails with `CNAMEAlreadyExistsException`.
3. **`0118` — the `gl.MAX` spike.** The one result that would change the plan. Cheap, and it fails
   loudly.
