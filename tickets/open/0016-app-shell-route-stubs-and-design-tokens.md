---
id: 16
slug: app-shell-route-stubs-and-design-tokens
title: App shell, the seven route stubs, and the design-token file
type: feature
priority: med
status: open
size: m
capability: 02-deploy-and-auth
depends_on: [12, 14]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] All seven routes exist as App Router segments and return a page: `/`, `/skills`,
      `/skills/[skillId]`, `/log`, `/chronicle`, `/run/[activityId]`, `/settings`, `/dev/tickets`,
      `/dev/tickets/[id]`.
- [ ] Every route is behind auth: signed out, each redirects to sign-in (verified per route, not
      assumed from the layout).
- [ ] Each stub names the screen it will become in one line, so a visitor is never looking at a blank
      page wondering if it is broken.
- [ ] The Android hardware/gesture **back** button returns to `/` from every route, and from the
      sheet routes returns to their parent — verified on the phone, per route.
- [ ] A deep link typed directly into the phone's address bar (e.g. `/skills/wayfaring`) resolves to
      the right stub rather than 404ing.
- [ ] One CSS file defines every primitive token from §8.2 verbatim: the ink, parchment, navy, gold,
      lantern and verdigris ramps plus `--cold-wash` and `--oxblood`, with the hex values exactly as
      specified.
- [ ] Every semantic token from the §8.3 table is defined for both light and dark, mapped to
      primitives (never to raw hex).
- [ ] `grep -rn '#000000\|#FFFFFF\|#000\b\|#fff\b' src/` returns no hits, and a lint rule or test
      enforces it going forward.
- [ ] A test or lint rule asserts no component uses a raw hex colour — components reference semantic
      tokens only.
- [ ] The §8.3 contrast table is reproduced as a comment in the token file, including the
      `--gold-500` 2.1:1 "fills and rules only, never text" warning.
- [ ] Dark theme follows the system setting by default, with the token values swapping correctly;
      verified by toggling the phone's system dark mode with the app open.
- [ ] `npm run typecheck` and `npm run lint` pass, and the routes are covered by at least a smoke test
      that each renders.

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
