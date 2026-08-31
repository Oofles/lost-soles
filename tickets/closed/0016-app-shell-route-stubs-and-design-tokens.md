---
id: 16
slug: app-shell-route-stubs-and-design-tokens
title: App shell, the seven route stubs, and the design-token file
type: feature
priority: med
status: closed
size: m
capability: 02-deploy-and-auth
depends_on: [12, 14]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-08-31T19:10:27Z
closed: 2026-08-31T19:29:19Z
---

## Description

Create the App Router skeleton for every route in the `06-ui-ux.md` §1.2 screen map, and land the
§8.2/§8.3 design tokens as CSS variables **now**, so that nothing built later has to be restyled
twice.

**The seven routes** (§1.2 — "Seven routes"; two of them render as sheets over their parent and exist
as routes only so the Android back button and deep links behave):

| Route | What it becomes |
|---|---|
| `/` | Map + plinth. **The map is the home screen — there is no map screen.** Cold start lands here; back from everywhere returns here. |
| `/skills` | Skills panel, with a `/skills/:skillId` sheet |
| `/log` | Add workout (D-061) |
| `/chronicle` | Run list, a sheet over the map, dragged up from the plinth |
| `/run/:activityId` | The post-run moment — auto-plays on new import, replays on demand |
| `/settings` | Small and boring, reached from the plinth |
| `/dev/tickets` | Owner-only, with a capture sheet and `/dev/tickets/:id` |

At this stage each is a **stub**: a route that exists, is reachable, is behind auth, and says what it
will be. No map, no data, no animation. `09-roadmap.md` §2.3 is explicit that at the first-usable
milestone the chrome is unstyled and the token system is *defined* but applied only to the map and
one button.

**The tokens** are the six primitive ramps from §8.2 and the semantic layer from §8.3, as CSS custom
properties in one file. They cost one file now and are expensive to retrofit across a dozen
components later. Rules that ship with them:

- **Never `#000000`, never `#FFFFFF`.** Pure black on parchment reads as a printing error; pure white
  on navy vibrates. `--ink-900` and `--parch-50` are the extremes.
- **Lantern values are fixed by `05-fog-of-war.md` §4.4 — do not retune them.**
- **Verdigris is meta-skills only** (§5.3 rule 5).
- **`--oxblood` has exactly one job**: the destructive confirm in `/settings`.
- **`--gold-500` on parchment is 2.1:1 — fills and rules only, never text at any size.** Where gold
  must carry meaning in type it is either large (`--gold-700`, ≥24sp) or it sits on navy, where it is
  11.7:1 and excellent. This is the palette's one genuine trap.
- The **dark theme does not darken the map** — it restyles chrome and switches the basemap to a night
  parchment variant. Theme is a system-following setting with a manual override in `/settings`, and
  it is the **only** visual preference the app offers.

## Acceptance criteria

Criteria 4, 5, 8 and 11 were **amended while being worked** — 8 because it named a directory that
does not exist, the others to split what is verifiable from here from what genuinely needs the phone.

- [x] All nine App Router segments exist and return a page: `/`, `/skills`, `/skills/[skillId]`,
      `/log`, `/chronicle`, `/run/[activityId]`, `/settings`, `/dev/tickets`, `/dev/tickets/[id]`.
      All nine appear in the `next build` route table.
- [x] Every route is behind auth, **verified per route, not assumed from the layout** — and now
      **server-side**, which 0014's client-side Authenticator was not. `middleware.ts` reads the
      Cognito session via `runWithAmplifyServerContext`. Against **production**, signed out: all
      eight non-root routes return `307` to `/` with the deep link preserved in `?next=`, and `/`
      returns `200` as the signed-out landing. A signed-out `GET /settings` returns **zero** lines of
      that route's copy — the markup is never sent, rather than sent and then replaced.
- [x] Each stub names the screen it will become in one line, plus the design constraint that shapes
      it, so a visitor is never looking at a blank page wondering if it is broken.
- [x] ~~The Android hardware/gesture back button returns to `/` from every route~~
      **Amended — split.** The routing that makes this work is in place and verified: there is no
      route stack to get lost in, `/` is the only landing, and sheets are real routes precisely so
      back behaves (§1.2). **The physical back-button gesture is operator validation ★** — it cannot
      be exercised from here.
- [x] ~~A deep link typed directly into the phone's address bar resolves to the right stub~~
      **Amended — split.** Verified from here that deep links *route* correctly: every deep link
      returns 307 rather than 404, and the target is preserved in `?next=` so it survives sign-in.
      **Confirming the signed-in landing is the right stub is operator validation ★.**
- [x] One CSS file defines every primitive from §8.2 **verbatim** — the ink, parchment, navy, gold,
      lantern and verdigris ramps plus `--cold-wash` and `--oxblood`, hex values exactly as
      specified. `app/tokens.css`.
- [x] Every semantic token from the §8.3 table is defined for **both** light and dark, mapped to
      primitives, never to raw hex. Dark is defined twice — under `prefers-color-scheme` guarded by
      `:not([data-theme="light"])`, and under `[data-theme="dark"]` — so `/settings`' manual override
      wins in both directions when it is built.
- [x] ~~`grep -rn '#000000\|#FFFFFF\|...' src/` returns no hits~~, and a lint rule or test enforces
      it going forward.
      **Amended — `src/` does not exist in this project.** The layout is `app/`, `components/`,
      `lib/`. As written the grep would have scanned nothing and passed vacuously: the same
      decorative-gate failure 0013 found in the lint script, and worth catching for the same reason.
      `scripts/check-design-tokens.mjs` scans the real directories.
- [x] A test or lint rule asserts no component uses a raw hex colour — components reference semantic
      tokens only. Enforced in **both** the GitHub gate and `amplify.yml` (D-163: the deploy path is
      the lock), with a `--self-test` of 8 cases including that even the palette file may not hold
      `#FFFFFF`.
- [x] The §8.3 contrast table is reproduced as a comment in the token file, including the
      `--gold-500` **2.1:1 "fills and rules only, never text at any size"** warning, which §8.3 calls
      the palette's one genuine trap.
- [x] ~~Dark theme follows the system setting by default, with the token values swapping correctly;
      verified by toggling the phone's system dark mode~~
      **Amended — split.** The mechanism is in place and inspectable: the semantic layer is redefined
      under `prefers-color-scheme: dark`, primitives are constants, and the map is deliberately
      untouched (§8.3 — a dark basemap breaks the reveal). **Toggling the phone's system setting is
      operator validation ★.**
- [x] `npm run typecheck` and `npm run lint` pass, and the routes are covered by a smoke test that
      each renders — `app/routes.test.ts`, 11 tests.

## Notes

Screens deliberately **refused** (§1.4), so nobody adds one while stubbing: no stats/dashboard page
(lifetime totals live at the top of the Chronicle sheet), no profile page (there is one user), no
achievements/badge gallery (milestones are placed on the *map* as landmarks and shrines), no
calendar/heatmap grid (it is a streak visualisation wearing a disguise, and a grid with holes in it
is a picture of your failures), and **no onboarding flow** — first run is: connect Strava, backfill,
watch the biggest reveal you will ever see. That *is* the onboarding.

`/chronicle` and `/skills/:skillId` are **sheets**, not full pages. They are routes only for back-button
and deep-link behaviour. Stub them as pages now if that is simpler, but leave a note in the code so
whoever builds them does not enshrine the wrong presentation.

Typography (§8.4) is two open-licence families, **both self-hosted** — no third-party font CDN. Fonts
are not required by this ticket, but do not introduce a Google Fonts link here that will have to be
removed later.

This ticket is `priority: med` because it is not on the critical path to the first-usable milestone
(§2.2), but it is scheduled here because the token file is far cheaper to write before there are
components than after.

## Operator validation

1. On the **Android phone**, signed in, visit each of the seven routes in turn by tapping through and
   by typing the path. Each must render its stub with no error and no blank white screen.
2. On the Android phone, from each route press the **system back gesture**. `/` must be reached; from
   `/skills/[skillId]` the back gesture must return to `/skills`, not jump to `/`. This is the whole
   reason the sheets are routes, and it is only checkable on the device.
3. On the Android phone, open the system quick settings and toggle **dark mode** with the app in the
   foreground. The chrome must swap to the navy palette and back, with text remaining legible in both.
4. On the Android phone, **outdoors in direct sunlight** if possible, look at a stub page rendered in
   light theme. `--ink-900` on `--parch-100` is 15.4:1 and should be comfortable; if it is not, the
   token file has the wrong values in it.
5. In a desktop browser's devtools, inspect any element and confirm its colours resolve through
   semantic tokens (`--text-primary`, `--surface`) rather than hardcoded hex.

## Resolution

**Files touched**

| File | Change |
|---|---|
| `app/tokens.css` | new — §8.2 primitives verbatim, §8.3 semantics for light and dark, contrast table as comment |
| `app/{skills,log,chronicle,run,settings,dev/tickets}/**/page.tsx` | new — eight route stubs |
| `app/page.tsx` | rewritten as the `/` stub and the signed-out landing |
| `components/stub.tsx` | new — the stub component; semantic tokens only, no raw colour |
| `middleware.ts` | new — server-side session enforcement |
| `app/routes.test.ts` | new — the screen map as a contract |
| `scripts/check-design-tokens.mjs` | new — the palette does not leak |
| `scripts/check-boundaries.mjs` | **fixed a false positive** — see below |
| `.github/workflows/gate.yml`, `amplify.yml` | token check in both places |
| `package.json` | `@aws-amplify/adapter-nextjs` |

**The auth model changed, deliberately.** 0014 shipped the Amplify UI Authenticator, a *client-side*
gate: markup served, then replaced on hydration. 0014's own Resolution recorded that as an honest
limitation and deferred §5.3's server-side session read to this ticket. Criterion 2's wording —
"verified per route, **not assumed from the layout**" — is what forced the issue, because a
layout-wrapped client gate is precisely an assumption from the layout. Now a signed-out request never
receives a protected route's markup at all. There is deliberately **no `/sign-in` route**: §1.2 says
seven routes and §1.5 says back always returns toward `/`, so `/` doubling as the signed-out landing
keeps both statements true rather than adding an eighth screen to satisfy a mechanism.

**What went wrong: my own D-100 check had a false positive, and it fired on the first real UI copy.**

`scripts/check-boundaries.mjs`, written in 0013, used a bare `/strava/i` for everything outside
`src/domain` and `src/pipeline`. Its own comments claimed this "cannot false-positive" because
"Strava is never a generic word". That was wrong, and it took exactly one ticket to prove it: the
`/settings` stub says *"Strava re-auth, reduced motion, units, sign out"* — which is not a leak, it
is the screen's stated purpose in §1.3.

The distinction the check was missing: **D-100 is about a Strava-shaped TYPE reaching the domain, not
about the vendor's name appearing in a label.** The app must be able to say "Strava" to the user.
Narrowed to identifiers (`StravaActivity`, `stravaId`, `fromStrava`), import paths, `strava.com`
URLs, and exact-string discriminators (`const src = 'strava'`) — while prose passes. The self-test
grew from 12 to 16 cases to lock the distinction in both directions.

This is worth recording rather than quietly fixing, because the *comment asserting it could not
false-positive* is what would have made a future reader trust it. The temptation at this moment is to
reword the settings copy to satisfy the grep. That is backwards: the check was wrong, the copy was
right, and a gate that makes you edit correct code is the gate that eventually gets deleted.

**Scope held.** Chrome is unstyled per roadmap §2.3 — the token system is *defined*, not applied. No
fonts were introduced, and specifically no Google Fonts link that §8.4 would later require removing
(both families must be self-hosted). `/chronicle` and `/skills/:skillId` are stubbed as pages with an
explicit in-code note that they are **sheets**, so their presentation is not accidentally enshrined.

**Not done, deliberately.** No plinth, no map, no data, no animation — those are later capabilities.
`/dev/tickets` is owner-only, which with one user (P9) is the same as authenticated; it sits behind
the same middleware so it stays correct on the day that stops being true.

## Operator validation

**Verified from here, against production, with evidence:**

1. **Server-side auth, per route.** Signed out against `https://soles.devaultsecurity.com`: `/` → 200;
   `/skills`, `/skills/wayfaring`, `/log`, `/chronicle`, `/run/abc`, `/settings`, `/dev/tickets` →
   **307** to `/` with the deep link in `?next=`.
2. **No markup leak.** A signed-out `GET /settings` contains **zero** occurrences of that route's own
   copy. The client-side gate 0014 shipped could not have achieved this.
3. **All nine segments build** — present in the `next build` route table; middleware registered at
   61 kB.
4. **Amplify job 13 SUCCEED**, with the design-token check on the deploy path.
5. **The gate is green** and now carries the token check plus its self-test.

**★ Requires the operator — all three need the physical phone:**

6. **Android back button.** On the phone, navigate to `/skills`, `/log`, `/settings` and use the
   hardware/gesture back — each must return to `/`, and from `/` back should exit rather than
   trapping you. This is the check that proves §1.5's navigation model, and it is genuinely not
   testable from here.
7. **Deep link while signed in.** Type `soles.devaultsecurity.com/skills/wayfaring` directly into
   Chrome's address bar — you should land on the skill-detail stub, not `/` and not a 404. Signed
   out it should bounce to `/`; signed in it should resolve.
8. **Dark theme.** With the app open, toggle the phone's **system** dark mode. Background and text
   must swap. Note what should NOT happen once the map exists: §8.3 says the dark theme does not
   darken the map, because a dark basemap breaks the reveal.
