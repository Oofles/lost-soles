---
id: 68
slug: log-route-one-row-per-workout-type
title: /log route — one row per workout type, one click to log
type: feature
priority: high
status: closed
size: m
capability: 10-add-workout
depends_on: [16, 60, 62, 70]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-06T18:35:58Z
closed: 2026-10-06T18:52:05Z
---

## Description

**D-061 is unusually specific and its reasoning is the design:** an **"Add workout" button**,
**not** per-exercise buttons on the home screen. It opens a dedicated page with one quick-log
row per workout type.

The decision is not about the home screen's tidiness — it is about **where growth lands**.
Per-exercise buttons put every future workout type on the most valuable surface in the app,
competing with the map, and the fifth one forces a redesign. One button routing to one page
moves that growth onto a page whose only job is to hold rows, and rows are the one UI shape that
scales without anyone thinking about it.

So `/log` is a **list of rows generated from the skill registry** (T5, ordered by
`displayOrder`), not a hand-written list of components. Each row renders from the row's
`exercises` entry: sigil, skill name, plain-English unit label, a stepper, a value and a `LOG`
button.

D-060 is forced, not chosen: no API anywhere exposes reps or sets, so strength work is logged
in-app or not at all. **Strength work is never ingested from Strava.**

Route and navigation: `/log`, reached from the plinth's "Add workout" affordance, with the
browser back returning to `/`. It is a real route so the browser back button and deep links behave.

Scope here is the route, the registry-driven rendering and the commit path. Row anatomy and the
physical interaction rules are 0071; the adapter behind the write is 0069; the zero-code-diff
proof is 0072.

## Acceptance criteria

- [x] `/log` exists as a route; the browser back button and the app-bar arrow both return to `/`.
- [x] The page renders **one row per enabled registry skill with `logMode: reps | duration`**
      ~~`| trace-manual`~~, in `displayOrder` order, with **no per-skill component and no hardcoded
      list** anywhere in the page. *(Amended by D-282: no `trace-manual` logMode exists; manual
      distance is `0240`.)*
- [x] The home screen gains exactly one affordance — "Add workout" — and **no** per-exercise
      buttons; a diff of the home screen shows zero new controls per workout type.
- [x] Clicking `LOG` on a row commits **that row alone**: no page-level save button, no "done",
      no confirmation dialog.
- [x] The page renders from cache and **nothing waits on the network**; with the browser
      offline (DevTools → Offline) the page renders fully and a log still succeeds locally.
      *(Narrowed by D-282: "offline" means reached by navigation from `/`. With no service worker
      a cold reload cannot render offline; that is `0241`.)*
- [x] The write lands in IndexedDB before the confirmation animation starts and flushes on a
      background-sync queue with an idempotency key; a failed flush retries silently and is
      never surfaced as an error on this page.
- [x] A logged row shows the optimistic result in place — units, XP, resulting level — without
      navigating away.
- [x] No skill id or exercise id is legible to the compiler in `(app)/log/` (I-25).
- [x] Adding a row to `xp-rules-v1.yaml` adds a row to `/log` with an empty `.tsx` diff (proved
      properly in 0072).

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0016 provides the app shell and route stubs /log mounts into.


~~`06-ui-ux.md` §6.2 states the physical brief: *the user is standing in a hallway, breathing
hard, holding the phone in one hand, possibly with sweat on the screen.*~~ *(D-251, 0215 — `/log`
is a desktop-browser feature.)* Target: **from the plinth's Add workout to logged, under three
seconds, without looking twice.**

~~The background-sync queue with idempotency keys is the same machinery the ticket-capture UI uses
(§7) — build it once, use it twice.~~ *(D-252, 0215 — there is no in-app ticket-capture UI.)*

When the page outgrows one screen it **scrolls**. It does not gain sections, tabs, search,
favourites, or a "frequent" group. Those are all ways of reordering, and reordering is what
§6.5 forbids.

## Resolution

**Built as designed, with four points the plan did not settle, recorded in D-282** (operator,
2026-10-06):
- **The stepper's step comes from the exercise's `entry` kind** (`count → 5`, `seconds → 15`), not
  a registry field. A fresh install starts at the first `quickValue`. `06` §6.4 and §6.5 were
  corrected, since they listed a `step` field that no registry row has.
- **Undo cancels; it never compensates.** XP never decreases (D-135), so a log is held in
  IndexedDB for its 8-second window and only flushes after the window closes.
- **No `trace-manual` row**, because that logMode does not exist. Filed as `0240`.
- **"Offline" means reached by navigation.** There is no service worker. Filed as `0241`.

**Files**
- `lib/log/rows.ts` (new) turns the registry into `/log`'s rows:
  - `logRows(registry)` returns one row per `exercises[]` entry of each enabled
    `reps | duration` activity skill, in `displayOrder`, with a plain-English label.
  - Also `STEP_BY_ENTRY`, plus the stepper arithmetic (`clampValue`, `stepValue`), m:ss
    formatting and parsing.
  - `entryFor` builds the `WorkoutEntry`. The set's field comes from `entryFieldFor`, the same map
    the server validates with. `occurredAt` is the instant of the click (D-281).
- `lib/log/optimistic.ts` (new) produces the in-row result. `awardFor` runs **the same
  `scoreActivity`** the server runs, on an activity shaped like the manual adapter's.
  `rulesForSkills` picks the ruleset the way `rulesForUser` does. `rowResult` gives the gain,
  the resulting level and the progress bar position. It restates the worker's version pick
  instead of importing `worker-rules.ts`, which loads the DynamoDB client at module scope.
- `lib/log/queue.ts` (new) is the write queue:
  - `QueuedLog` carries `holdUntil = click + 8 s`.
  - `flushDue` sends due entries serially, oldest first. A `REFUSED:` error is dropped; anything
    else retries silently with a 1 s doubling backoff capped at 5 min, and coming back online
    skips the backoff.
  - `undoLog` deletes only inside the window.
  - Storage is IndexedDB (`lost-soles-log`: `queue` plus a `kv` store holding last values and
    cached `SkillState`), with an in-memory fallback and one shared instance per tab.
- `lib/log/transport.ts` (new) talks to the network. `sendLog` calls the `logWorkout` mutation
  and `fetchSkills` lists `SkillState`, both through the Amplify data client with the user-pool
  token, with §9.5's 10 s timeout. `errorFrom` maps the Lambda's `REFUSED:<code>:` prefix to
  `LogRefusedError`.
- `lib/log/repeat.ts` (new) is hold-to-repeat: one step on press, then 4/s after 400 ms.
- `components/log-queue-runner.tsx` (new) is mounted in `app/layout.tsx` inside the auth gate,
  so the queue flushes on **every** route. It polls every 1 s, which is one IndexedDB read and no
  network when nothing is due, and also runs on `online`. After a successful send it refreshes
  the `SkillState` cache.
- The page:
  - `app/log/page.tsx` is a **static** server component that reads no session, so `/` prefetches
    it (the build reports `○ /log`).
  - `app/log/log-page.tsx` renders the rows from the bundled registry on the first frame, then
    reads standing and last values from IndexedDB, then revalidates `SkillState` in the
    background.
  - `app/log/log-row.tsx` is the row. Its anatomy and interaction rules are `0071`'s, built in
    the same session.
- `components/add-workout-link.tsx` (new) is the home screen's one affordance, placed beside Sync
  until the plinth (capability 13) exists.
- `src/rules/no-skill-names.test.ts` gained a `/log` block covering skill **and exercise** ids
  from every bundled ruleset, over `app/log/` and `lib/log/`, skipping comment lines.
- Docs: D-282, plus `06` §6.4's step row and §6.5's procedure.

**Tests** (+75): `rows.test.ts` and `optimistic.test.ts` run against the real v2 registry.
- The optimistic award is compared with the manual adapter's real `normalize` followed by
  `scoreActivity`, for every row at four values.
- `queue.test.ts` runs every case against both stores: the hold window, undo before and after
  it, retry and backoff (the same idempotency key is re-sent), the 5-minute cap, the online
  bypass, refusal drop, flush order, per-user isolation, and a held log surviving a new
  connection.
- `repeat.test.ts` uses fake timers to check the 4/s rate.
- `log-page.test.tsx` checks that the first render is complete and in registry order with no
  network, that every control has an accessible name, and that the page has no dialog, no
  `confirm(`, nothing draggable, no save or done, and no session read.
- `add-workout-link.test.tsx` checks that `/` has exactly one affordance and reads nothing from
  the registry.

**Not built here, deliberately.**
- **Sigils** belong to `0072`'s icon set, which is data-keyed with a fallback glyph.
- **The level-up card** (§6.4 "Level-ups still interrupt") is capability 12's Beat 3 (`0082`).
- There is no `/settings` "left-handed" flag (D-251 withdrew it).

**What went wrong.**
- The first draft of the row rebuilt its hold-to-repeat timers on every step, which would have
  stopped a hold after one repeat. Caught on reading it back.
- The optimistic test imported the manual adapter directly, and `registry.test.ts` refused that,
  correctly. It now goes through `getAdapter`.

## Operator validation

*Planned at ticket-write:* On **`/log`** in the desktop browser: click the plinth's "Add workout", log 40 pushups, and
return to the map — **under three seconds, without hunting for any control.** Then set DevTools
to Offline and repeat: identical behaviour, no spinner, no error.

**The perceptual half of this check carries to `0071`**, whose validation runs on the same page
(logging 40 pushups by mouse and by keyboard, and undo). `0071` stays open until the operator
has looked.

**Automated (agent, 2026-10-06, WSL host).**
- `npm run typecheck` and `npm run lint` are clean.
- The full suite passes: 148 files, 2,685 tests.
- `next build` succeeds and shows `○ /log` (static, 9.11 kB).
- After the build, `check-bundle-leak` passes and no DynamoDB client is in `/log`'s chunks.
- Every other `scripts/check-*.mjs` passes, except `check-home-not-in-client`, which needs
  `LOST_SOLES_HOME_LAT/LNG` and has none on this host. That is not a pass and not related to
  `/log`.

**Smoke: the browser's real path against the deployed stack (agent, 2026-10-06, `devault`).**
`tmp/0068/smoke.ts` created a throwaway Cognito user with `admin-create-user`. It is not on
`OWNER_USER_IDS`, so no write was possible. It signed in by SRP through Amplify, exactly as the
browser does, then drove **the shipped modules**:
- `currentUid` read the sub from the local session.
- `fetchSkills` → `SkillState.list` through AppSync returned `[]` for the new user (owner-scoped,
  no auth error).
- `sendLog` → `logWorkout` was refused, and **the real AppSync error parsed as
  `LogRefusedError` with code `NOT_OWNER`**.
- Through `flushDue`, the entry was held inside the undo window (nothing sent), then sent,
  refused and **dropped rather than retried**.
- The user was deleted and confirmed gone.

The operator's own `SkillState` rows carry `owner = <sub>::<sub>`, and their Cognito username is
their sub, so the owner rule will return their rows to the browser. No real log was written,
because XP never decreases (D-135).
