# Capability roadmap

> **This file picks what is next. It does not design anything.**
> Designs live in `NN-name.md` beside this file; the authoritative ticket tables and
> done-conditions live in [`../09-roadmap.md`](../09-roadmap.md) §3.

> Ordering within a capability comes from [`../BUILD-ORDER.md`](../BUILD-ORDER.md) until ticket
> `0009` lands, and from `/tickets next` after that.

| # | Capability | Phase | Tickets | Done | Status |
|---|---|---|---|---|---|
| `00` | preflight and repo | 0 · Ground truth on disk | 7 | 1 | ◐ in progress |
| `01` | ticket system | 0 · Ground truth on disk | 6 | 0 | **◀ NEXT** |
| `02` | deploy and auth | 1 · The spine | 6 | 0 | · not started |
| `03` | ticket capture endpoint | 1 · The spine | 7 | 0 | · not started |
| `04` | domain contract and rules | 1 · The spine | 7 | 0 | · not started |
| `05` | strava adapter | 1 · The spine | 7 | 0 | · not started |
| `06` | ingest pipeline | 1 · The spine | 6 | 0 | · not started |
| `07` | fog projection and cells | 1 · The spine | 7 | 0 | · not started |
| `08` | map and fog renderer | 1 · The spine | 10 | 0 | · not started |
| `09` | xp engine and ledger | 2 · The game made visible | 8 | 0 | · not started |
| `10` | add workout | 2 · The game made visible | 5 | 0 | · not started |
| `11` | skills panel | 2 · The game made visible | 5 | 0 | · not started |
| `12` | post run moment | 2 · The game made visible | 8 | 0 | · not started |
| `13` | home plinth and chronicle | 2 · The game made visible | 5 | 0 | · not started |
| `14` | webhook and automatic sync | 3 · Trustworthy and complete | 6 | 0 | · not started |
| `15` | two map modes and cold territory | 3 · Trustworthy and complete | 5 | 0 | · not started |
| `16` | rebuild drill | 3 · Trustworthy and complete | 5 | 0 | · not started |
| `17` | tickets ui | 3 · Trustworthy and complete | 5 | 0 | · not started |
| `18` | mvp hardening | 3 · Trustworthy and complete | 6 | 0 | · not started |

---

**Next capability: `01-ticket-system`.**

Before starting it, confirm the previous capability's close audit passed
(`AUDIT.md`). Capabilities `00` and `01` are audited by hand; from `02` onward
`/tickets audit` runs it and refuses to advance until it passes (D-153).

★ **First usable** is the end of `08-map-and-fog-renderer` — a real run imports and real
territory is revealed. Everything before it is scaffolding; everything after it is the game.
