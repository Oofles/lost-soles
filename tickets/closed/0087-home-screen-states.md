---
id: 87
slug: home-screen-states
title: Home screen states — cold start, nothing imported, sync in progress, sync failed, offline
type: feature
priority: high
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [86, 43]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-15T18:28:53Z
---

## Description

Every state the home screen can be in, per `06-ui-ux.md` §2.4. The theme running through all of them
is D-013: **no state of this screen is allowed to become a demand.**

| State | Plinth shows | Map shows |
|---|---|---|
| Cold start, cached | Cached totals immediately | Cached basemap + last `explored-r10.bin` from IndexedDB, drawn **before any network call** |
| Fresh import waiting | `1 new run — tap to open` in gold, **once**, never red, never repeating | Territory as of *before* the run — the reveal belongs to the post-run moment, not here |
| Nothing ever imported | `Connect Strava to begin` — the only call to action in the app | Parchment, **unfogged**, centred on device location |
| Three weeks idle | Identical to any other day | Identical |
| Offline | Everything above, from cache, with **no error chrome** | Cached tiles; missing tiles render as flat parchment, never a grey checkerboard |

**The empty state deserves its own note and it is easy to get wrong.** With no territory, a fogged
map is *all* fog and reads as broken. So **before the first import, fog is not drawn at all** — the
parchment map sits there clean, and the fog arrives, for the first time, as part of the first reveal.
*The first thing the fog ever does is burn back.*

**Sync in progress / sync failed.** Until capability `14` ships, ingest is the manual **Sync** action
(0043) and the app has upkeep — a knowing, scheduled violation of D-013 (roadmap §4.5). Surface it
honestly and quietly: a sync in flight shows a small inline progress indication on the plinth, never
a blocking spinner over the map. A failed sync shows nothing at all — a Strava silence is **not an
event** (§2.3). The **only** failure ever surfaced is a genuinely broken token, and it appears as a
quiet ink-coloured line, `Strava needs reconnecting` → `/settings`. **Never a red badge, never a
modal, never a nag.**

Cold start must paint from cache first and reconcile after. The user opening the app on a slow or
absent connection sees their territory immediately, not a spinner.

## Acceptance criteria

- [x] On cold start with a populated IndexedDB, the map and plinth render from cache with **zero**
      network requests issued before first paint — asserted by an offline-mode test.
      *(`lib/plinth/cold-start.test.tsx`: the explored set, the standing and — new here — the last
      run each paint from cache before their own first request, and with every request failing the
      plinth still renders all three with no error text.)*
- [x] With nothing ever imported, no fog layer is instantiated at all (not merely hidden), the map is
      clean parchment ~~centred on device location~~ **centred on the configured home** (amended:
      D-313 and `06` §2.4 — a desktop browser's geolocation is an IP guess plus a permission prompt;
      D-249's precedence with no run to frame already lands on the home), and the plinth reads
      `Connect Strava to begin` *(when no source is connected — see Resolution)*.
- [x] With an unseen import, the plinth shows ~~`1 new run — tap to open` in gold~~
      **`1 new run — open it` with a gold rule** (amended: `06` §2.4's desktop wording, D-227; gold
      is a rule or fill, never text, D-148); it pulses once and then stops; it never changes colour
      and never re-pulses on subsequent renders.
- [x] Clicking that line opens `/run/:id` and auto-plays (0078's entry-point matrix).
- [x] The home map shows territory as of **before** the unseen run — the new cells are not revealed
      on `/` ahead of the sequence. *(Re-armed cells are not held back: they were explored before
      the run, and D-020's map never re-fogs. Known gap in Resolution: a run landing mid-session can
      show for one request before the hold applies.)*
- [x] A sync in progress shows an inline indication on the plinth only *(the rail's Sync caption
      line, D-313)*; no overlay, no blocked input, the map stays pannable throughout.
- [x] A sync that returns no new activities changes nothing on screen and produces no message.
- [x] A sync that fails for a non-auth reason produces **no** user-visible error.
- [x] An expired/revoked token — and only that — produces one ink-coloured line linking to
      `/settings`. A test asserts no red token, badge, dot or modal is used.
- [x] Offline: cached tiles render, missing tiles render as flat parchment, and there is no error
      chrome anywhere on the screen. *(No chrome added by this ticket; the plinth's offline render is
      asserted error-free. Tile behaviour is unchanged from `0052`/`0053`: the basemap style's
      background is parchment.)*
- [x] With no activity for 21 days, the rendered home screen is identical (diffed) to one rendered
      with an activity yesterday, apart from the last-run line's own text.

## Notes

Depends on 0086 (the plinth) and 0043 (the manual Sync action, which is the only thing that can be
"in progress" until 0091–0095 land).

The temptation this ticket exists to resist is the "helpful" empty state: a card explaining what to
do next, a checklist, a progress-to-first-run meter. `06-ui-ux.md` §2.3 rules all of it out and
D-013 is the reason. One call to action, once, and then never again.

The unfogged empty map is a real implementation constraint, not a styling choice — do not ship a fog
layer with opacity 0 and call it done, because a zero-cell mask is also the state after a cache
clear, and the two must behave the same way.

- **From 0086 (2026-10-15).** Total Level and cells paint from IndexedDB on a cold start, but the plinth's last-run line waits for `/api/runs/latest`. §2.4's "cached totals immediately" may want the line cached too; decide it here rather than in a ticket of its own.
- **Operator, 2026-10-15 (wave 1 of `13`): cache the last-run line.** Store the last `/api/runs/latest` response in IndexedDB so the plinth's last-run line paints on cold start and offline with Total Level and cells, then reconciles. Keep D-316's single source: the line, the first camera and `⌖` still read the same value. Also note D-313: with nothing imported the map centres on the **configured home**, not device location — that supersedes this ticket's "centred on device location" (amend the criterion with the reason). D-313 also places the interim manual Sync as a small text line in the rail below the three buttons; the in-flight indication belongs there.

## Operator validation

*(Rewritten under D-229 by the agent, 2026-10-15. The broken-token, empty, offline-cache and
sync-result states are proved by tests and fakes — see Resolution — so revoking Strava, clearing
site data and going offline are no longer the operator's to do. What is left is perception only.)*

In the desktop browser, at ≥1024px:

1. **The fresh-run line.** The next time a run lands, look at `/` before opening it. Does
   `1 new run — open it` with its gold rule read as an invitation rather than an alert? Is the one
   pulse noticeable without being demanding? Does the map look like your territory *before* the run?
2. **The reconnect and connect lines** are judged only if they ever occur for real; their quietness
   is pinned by tests. If one grabs your attention when it does appear, it is too loud.

**Agent smoke test, deployed `e15122d` (Amplify job 404), 2026-10-15.** Throwaway user, headless
Chromium. With an unseen latest run, `/` shows `1 new run — open it`, linking to
`/run/<latest>?play=1`. With nothing imported, after a reload, it shows `TOTAL LEVEL 9 · 0 cells ·
Connect Strava to begin`. Signing in without a reload leaves cells at `—` with no connect line: filed
as `0276`, likely older than this ticket.

**Operator, 2026-10-15: pending.** Their latest real run (Tue 13 Oct) had already been opened in this
browser, so the plinth correctly showed `Last: Tue 13 Oct · 4.84 km · 211 new` and not the fresh-run
line. Item 1 above waits for the next real run. Stays open until then; no one is asked to run for it.

## Resolution

*(Agent, 2026-10-15, wave 1 of capability `13`. Left in `tickets/open/` for the orchestrator to close
after deploy.)*

**The shape.** Every state is data into `plinthModel` (`lib/plinth/model.ts`) or into the home map's
fog rule (`lib/fog/home-territory.ts`); no state draws chrome of its own.

**Files touched**

- `lib/plinth/latest-run.ts` *(new)* — `loadLatestRun`: the last `/api/runs/latest` answer cached in
  the `LogStore` kv (`latest-run:<sub>`, beside `skills:<sub>`), emitted before the request, written
  back after, failure silent to the screen. The operator's decision from the Notes.
- `components/map/use-latest-run.ts` — reads through `loadLatestRun` (cache on the first ask only, so
  a generation refetch never steps the line back); a `corridor` flag turns the optimistic corridor
  off while an unseen run is held. Still one source (D-316): line, first camera and `⌖` read the
  same collection.
- `lib/runs/wire.ts`, `lib/runs/server.ts` — `/api/runs/latest`'s feature gains `newCells`: the run's
  NEW cell ids, read beside the trace from the same `cells/<id>.classes.json` `runById` reads
  (`0251`, D-294). One extra S3 GET; an absent/unreadable object is `null` ("hold nothing"), never a
  lost line. The SSR role's existing `users/*` read covers it.
- `lib/fog/home-territory.ts` *(new)*, `lib/fog/reveal.ts` (`withoutCells`, factored out of
  `preRunCells`) — what `/` draws fog over: the set minus an unseen run's new cells, or `null`
  when that is zero cells.
- `components/map/use-fog-mask.ts`, `components/map/map-shell.tsx` — a `home` argument / `held` prop.
  On `/` a `null` territory means the `FogMaskLayer` is **never constructed** (`fogless` guards the
  effect that creates it), so "nothing ever imported", "cache cleared, network not back yet" and
  "the only run is the unseen first one" all behave identically: clean parchment. `/run/:id` is
  untouched (`home` is `null` when `framed`).
- `lib/plinth/states.ts` *(new)* — `firstPulse` (module-scope set: once per run per page load, so
  neither a re-render nor a client-side return to `/` restarts it; a reload — a cold open — may
  pulse once more, which is §3.1's "app opened cold" case) and `heldCells`.
- `lib/plinth/connections.ts` *(new)*, `app/page.tsx` — the server reads each connectable source's
  summary (no token attributes) and hands `{sourceId, name, state}` to `HomeScreen`; signed-out
  pages get no prop at all. A failed read omits the source.
- `lib/plinth/sync-result.ts` *(new)*, `components/sync-button.tsx` — what a Sync press may say on
  `/`: only `N activities queued.`. Nothing-new, provider failure, not-connected and the outstanding
  failed-import count say nothing; a `reconnect` outcome is handed up (`onReconnect`) to become the
  plinth's one reconnect line. A thrown action is caught (`quietSync`) so it can never reach an
  error boundary. The in-flight indication is the existing `Syncing…` label and caption — inline in
  the rail, no overlay, nothing over the map.
- `lib/plinth/model.ts` — `seen`/`pulse`/`sources`/`reconnectIds` inputs; `freshRunLine`
  (`1 new run — open it` → `runHref(id, { play: true })`); `connect` and `reconnect` lines.
- `components/plinth/plinth.tsx` — the fresh line (`plinth-fresh`: an inset gold rule;
  `plinth-pulse`: one 1200 ms gold ring, `animation-iteration-count` 1, none under reduced motion),
  the connect line in the last-run row, the reconnect line (ink, `--text-secondary`, underline in
  `--line`) under the Sync caption.
- `components/plinth/home-screen.tsx` — reads `isSeen` for the latest run (`0084`'s flag), derives
  pulse, held cells and the model; passes `held` to `MapShell`.
- Tests: `lib/plinth/{cold-start.test.tsx, latest-run.test.ts, states.test.ts, sync-result.test.ts,
  connections.test.ts, model.test.ts}`, `lib/fog/home-territory.test.ts`,
  `components/plinth/plinth.test.tsx`, `lib/runs/server.test.ts`, `app/page.test.tsx`,
  `lib/run-moment/seen.test.ts` (its importer allow-list now includes the plinth, which `seen.ts`'s
  header already named as its reader).

**Decisions made (proposed to the orchestrator as D-NEW, not recorded here)**

- `/` shows a Sync press's result only when activities were queued; `0044`'s failed-import sentence
  no longer reaches any UI (§2.3: the only failure surfaced is a broken token). `syncResultLine`
  itself is unchanged.
- Only an unseen run's **new** cells are held back on `/`; re-armed cells stay clear (D-020).
- `Connect <source> to begin` shows only when nothing is imported (no traced run, zero cells) **and**
  no source is connected. A connected account waiting on its first import is told nothing.
- While the latest run's `seen` flag is being read (milliseconds, IndexedDB) the last-run row is
  empty rather than showing one line and swapping; nothing is held on the map in that window.

**How the states are proved without the operator (D-229)**

- Broken token: `connections.test.ts` (NEEDS_REAUTH → `reconnect`), `model.test.ts` (server state or
  a Sync press → one line, nothing for connected / not-connected), `plinth.test.tsx` (one ink link
  to `/settings`; no oxblood, red, raw colour, badge, dot, toast or dialog).
- Empty: `home-territory.test.ts` (null set, zero-cell set and fully-held first run → `null`; source
  grep that `fogless` guards `new FogMaskLayer`), `model.test.ts` (the connect line's conditions).
  Centring is `0186`'s existing precedence: `firstLoadRunCamera` returns `null` for no run, so the
  camera stays on stored → configured home → extract.
- Offline / cold start: `cold-start.test.tsx` (three caches, an always-failing network, paint before
  request per loader, no error text) and `latest-run.test.ts`.
- Sync: `sync-result.test.ts`.

**Known gap.** The hold needs `newCells` from `/api/runs/latest`. When a run lands mid-session the
explored-set delta arrives first and the latest-run refetch one request later, so the new ground
can show for that request's duration before it is held; likewise on a first visit with no cached
latest run. Proposed as a follow-up ticket rather than widened here.

**Decisions recorded at merge (orchestrator):** D-317 (last-run line cached, operator), D-318 (Sync on `/` speaks only on queued; the operator declined to resurface the failed-import count anywhere), D-319 (hold only new cells; no fog layer at zero cells), D-320 (the connect line's condition). The proposed one-request-flash bug is `0273`.
