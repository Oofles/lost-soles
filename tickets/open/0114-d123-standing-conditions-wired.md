---
id: 114
slug: d123-standing-conditions-wired
title: The D-123 standing conditions, wired as code and CI rather than caveated
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [17, 24]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-22T05:00:54Z
---

## Description

`08-security-privacy.md` §2.3–2.5. **D-123 and D-014 cannot both remain true indefinitely.**
D-123 justifies zero home-location masking on the premise *"map shown only to the owner."* D-014
plans for the owner plus up to ~5 friends and family. **The moment a second account exists,
D-123's stated premise is false. Not weakened — false.**

A revisit trigger written as prose is a caveat, and caveats are not enforced. This ticket converts
the three triggers into gates a person or an agent actually hits.

> **Standing rule, to be carried in `CLAUDE.md`:** if any of the three conditions below becomes
> true — **or is *proposed* in a ticket, a design doc, or a PR** — D-123 is reopened before that
> work merges. Reopening means a new `D-2xx` is recorded in `docs/decisions/DECISIONS.md`
> explicitly superseding or re-affirming D-123 with its new premise stated, and the gate checklist
> is complete. *"It's fine, it's still just me" is not a resolution; a recorded decision is.*

**TRIGGER A — a second user account is created.** Fires when any Cognito user exists in the
production pool other than the owner — when the account is *provisioned*, not when friends are
planned. A shared login is the same thing with worse accountability. Gate A-1…A-7; what must be
**built** before it: owner-scoping tests (A-1), a fidelity field on the user record (A-3), a
consent screen (A-4), a working delete (A-5, which is 0106). *The multi-user story is not "add a
Cognito user", it is those five items.*

**TRIGGER B — any share, export, or screenshot feature is proposed.** Fires on a share button, an
image export, "export my map", a social card, an OG image, a printable poster, a GPX/GeoJSON
export, an embeddable widget, or a screenshot helper — **at proposal time, not implementation
time**, because the design of a share feature is where the privacy decision actually gets made.
Gate B-1…B-5: the shared artifact is a *different artifact* built from an explicitly enumerated
payload; home-region handling is decided and implemented in that payload; zoom and resolution are
capped; **no raw trace geometry leaves the system** (shares render cells, never `latlng`); timing
metadata is stripped or coarsened.

**TRIGGER C — any public URL serves cell data.** Fires on any response reachable without a valid
Cognito session containing cell data, trace geometry or anything derived from them — including an
ISR/SSG page rendered with real data and a "just for testing" endpoint. C-1…C-5: enumerate the
public surface; **no page containing cell data may be statically rendered**; `Cache-Control:
private, no-store` on every authed response; `explored-r10.bin` served authenticated from an
owner-scoped prefix via a short-lived signed URL, never a public or predictable key.

Placement, so the checklist is enforced rather than decorative (§2.5): a standing note in
`CLAUDE.md` pointing at §2.4 by name; a line in the ticket template's `## Operator validation`
section for tickets touching auth, sharing, export or public routes — *"D-123 trigger checked?
A / B / C / none."*; and `/tickets triage` flagging any inbox capture whose title or body matches
`/share|export|screenshot|public|friend|invite|account|signup|poster|embed/i`.

## Acceptance criteria

- [x] **Trigger A is code:** a CI check enumerates the production Cognito pool and fails if any
      user other than the owner exists without a recorded `D-2xx` superseding D-123.
      *Amended (operator, Q1 = a):* the live check runs in `amplify.yml`'s backend phase, which
      holds AWS credentials. `gate.yml` runs only its `--self-test`, because that job holds none by
      design (`0017`). The build role needs `cognito-idp:ListUsers` added before this deploys.
- [x] **Trigger B is CI:** a check greps changed tickets, docs and diffs for the trigger-B
      vocabulary and fails the build with a message naming the §2.4 gate; the operator can only
      pass it by recording a decision, not by editing the pattern.
      *Amended (operator, Q2 = c):* the vocabulary is §2.4's own phrase list, matched on ADDED
      lines of changed tickets and docs, plus API-shaped signals on added code lines. The §2.5
      triage regex matches 464 of 620 code files, so it could not be the CI pattern. A doc passes
      by citing a decision that supersedes or re-affirms D-123. Code passes through
      `scripts/d123-acknowledgements.json` citing one. The self-test pins every pattern to §2.4.
- [x] **Trigger C is CI:** a check asserts no built artifact under `.next/static` and no entry in
      the prerender manifest contains cell or trace data (C-2), and that every authed route sets
      `Cache-Control: private, no-store` (C-3).
- [x] `explored-r10.bin` is fetched with credentials from an owner-scoped prefix via a short-lived
      signed URL or an authed route; a test asserts an unauthenticated fetch of the object's
      predictable key returns 403 (C-4).
      *Amended:* the object is `users/<sub>/explored/explored-r11.<gen>.bin` (D-237). It is served
      by the authed route `/api/fog/blob/[gen]` (D-228). There is no signed URL. The route answers a
      signed-out caller **404**, by `0019`'s design, and that is asserted in
      `app/api/fog/route.test.ts`. The predictable S3 key answers **403**, which
      `amplify/explored-set-not-public.test.ts` asserts structurally. The smoke test checks it live.
- [x] The public surface is enumerated in `docs/capabilities/18-mvp-hardening.md`: the webhook
      Function URL, the sign-in page, static assets, and the R2 tile bucket — with the note that
      **the tile bucket serves the generic basemap only and the explored set is never baked into
      a tile** (C-1). *Amended:* "R2 tile bucket" is the tiles CloudFront distribution in front of
      the private `lost-soles-tiles` bucket (D-226, D-250). Tiles never moved to R2.
- [x] `CLAUDE.md` carries the standing note pointing at §2.4 by name, next to its `DECISIONS.md`
      pointer.
- [x] The ticket template's `## Operator validation` section carries the D-123 trigger line, and
      the triage command flags matching inbox captures.
- [x] `/api/dev/tickets` and `/dev/tickets` are owner-only (A-6), asserted by a test signing in as
      a non-owner.
      *Amended (operator, Q3 = a):* `/api/dev/tickets` never existed. `0154` corrected §2.4 A-6 to
      `POST /api/tickets/capture`, and that route's non-owner test already exists ("gives a
      non-owner a response INDISTINGUISHABLE from a signed-out one", `route.test.ts`).
      `/dev/tickets` is a static stub that `0216` deletes (D-252), so it is out of scope here.

## Notes

**Standing reminder, to be repeated wherever it will be read: any share, export or screenshot
feature reopens D-123, and adding a second user account triggers the same gate.** These are not
future problems; they are the two most natural next features anyone would think of for a map app,
and both are pre-decided as gated.

Trigger C's honest note from §2.4: nothing new needs building for it. C-1…C-4 are constraints on
how MVP is built. **The trigger's job is to stop C from happening by accident**, which is why it
is written as an audit rather than a backlog.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the laptop, open a scratch PR that adds a file named `share-my-map.md` with the word "export"
in it, and confirm CI fails with a message naming the §2.4 gate. Then run the prerender check
against a real build and read its output — it should list every prerendered route and assert none
carries cell data. In the desktop browser, sign out completely and try to fetch the
`explored-r10.bin` URL you can see in devtools while signed in: it must 403. Finally, open
`CLAUDE.md` on GitHub in the desktop browser and confirm the standing note is visible in the first screenful — if an
agent has to scroll to find it, it will not be read.

## Resolution

The three D-123 triggers from `08-security-privacy.md` §2.4 are now checks that fail a build. They
run in both the GitHub gate and `amplify.yml` (D-163), and every one fails closed (D-176). The
operator answered three D-152 questions on 2026-10-22: Q1 = a, Q2 = c, Q3 = a. They are recorded
in the criteria amendments above.

**Trigger A** — `scripts/check-d123-trigger-a.mjs`.
- Reads the live pool with `ListUsers`, fetching the `sub` attribute only. It prints subs and
  never usernames or emails.
- It passes only if every account is in `lib/auth/owner-ids.ts` OWNER_USER_IDS, or is listed in
  its `APPROVED_ACCOUNTS` (empty) citing a DECISIONS.md entry that names D-123.
- It refuses a pool not tagged `amplify:deployment-type = branch`, so a sandbox pool cannot stand
  in for production.
- It runs in `amplify.yml`'s backend phase after `check-auth-posture`. Only `--self-test` runs in
  `gate.yml`, which holds no credentials (`0017`).
- **It needs `cognito-idp:ListUsers` on the build role before it deploys.** Today that call is
  denied (`simulate-principal-policy`: implicitDeny), and the check fails closed on a denial.

**Trigger B** — `scripts/check-d123-trigger-b.mjs`, with `scripts/d123-acknowledgements.json`
(empty).
- Part one scans the lines added to `tickets/**.md` and `docs/**.md` for §2.4's phrase list, one
  pattern per listed item. `docs/INDEX.md` is skipped because it is generated.
- A match passes only if the file cites a decision that **supersedes or re-affirms** D-123. That
  is stricter than "names D-123", on purpose: DECISIONS.md already has an entry that mentions D-123
  in passing, and citing it would have been a free pass.
- Part two scans added code lines for the operator's API signals. It also flags a Next
  metadata-image route file by its *path* (the two file names are in the script). A hit passes
  only through an acknowledgement entry for that file and signal, citing such a decision.
- This ticket's own first draft tripped part one, because its Resolution named one of those file
  names. Prose that *describes* the check trips it like a proposal does. It was reworded and the
  pattern left alone.
- **Base ref:** `D123_BASE_SHA`, which GitHub sets to `before` or the PR base. If the shallow
  checkout lacks that commit, it is fetched at depth 1.
- An empty or all-zeros sha falls back to HEAD^, deepening the clone by one if it is shallow.
  Amplify takes the HEAD^ path, and its build log shows a full clone.
- A root commit, or a sha that cannot be fetched, fails.
- The self-test builds throwaway git repos and covers 15 diff cases and all 4 base-ref paths. It
  also pins every pattern to its own §2.4 wording.
- Over the last 150 commits it fires once: `geo+json` in `src/pipeline/rebuild-drill-back.ts`,
  which is internal route-trace storage and not an export. That is a known false-positive class,
  reported rather than narrowed.

**Trigger C.**
- **C-3:** `lib/http/no-store.ts` `withNoStore` wraps every route handler (all 11 route files).
  Every response carries `Cache-Control: no-store, private`, including the 404s, 304s, redirects
  and errors. Before this, only the success paths set it.
- The wrapper leaves exactly D-228's `IMMUTABLE_PRIVATE` alone. `scripts/check-route-cache-control.mjs`
  fails the build in four cases:
  - a handler exported without the wrapper
  - a `public`/`s-maxage`/`revalidate`/`force-static` directive
  - the carve-out used outside its two routes
  - a hand-spelled lifetime
- **C-2:** `scripts/check-prerender-no-cell-data.mjs` runs after the build. Every
  prerender-manifest route must be on an allowlist, each entry with its reason. The allowlist today:
  `/_not-found`, `/skills`, `/skills/[skillId]`, `/log`, `/dev/tickets`.
- It also scans every prerendered body and `.next/static` for H3 indexes, GPS-precision
  coordinate pairs and `latlng` arrays. Prerendered bodies are also scanned for run/cell field
  names and blob magic.
- **C-4:** `amplify/explored-set-not-public.test.ts` covers three things on the synthesized
  storage stack:
  - the predictable key `objectKeys.cells`
  - no bucket policy statement allows an anonymous principal
  - no public ACL, and no weakened public-access block
- The block itself comes from S3's default and is not set in the template. A follow-up ticket is
  proposed to make it explicit.
- **C-1:** a new section in `docs/capabilities/18-mvp-hardening.md`. It enumerates the surface as
  built, checked live: the only Function URL in the app is `ingest-webhook`'s (D-345).
- Finding: Amplify serves `public/` **without** running middleware. `/fog-fixtures/*.bin` answers
  200 signed out. Those are synthetic perf cells (`PERF_ORIGIN` 30°N 100°E), not anyone's map, and
  the section records that a real explored set must never go in `public/`.

**Placements (§2.5).**
- `CLAUDE.md`: a standing-rule block in the first screenful, naming §2.4 and pointing at
  DECISIONS.md, plus a Map row.
- `tickets.mjs create` writes *"D-123 trigger checked? A / B / C / none."* into
  `## Operator validation`. `07` §3.5 and `TICKET_FORMAT.md` §3.5 say so.
- `tickets.mjs list` marks inbox captures matching §2.5's regex `[needs D-123 review]`, and adds
  `d123Review` to `--json`. The triage procedure in `SKILL.md` says what to do with a flagged
  capture.

**Files:**
- `CLAUDE.md`
- `.claude/skills/tickets/{SKILL.md,scripts/tickets.mjs,scripts/tickets.test.mjs}`
- `docs/07-ticketsmith.md`, `docs/TICKET_FORMAT.md`, `docs/capabilities/18-mvp-hardening.md`
- `lib/http/no-store.ts`, `lib/http/no-store.test.ts`
- the 11 `app/**/route.ts` files
- `app/api/fog/route.test.ts`, `app/api/tickets/capture/route.test.ts`,
  `app/api/auth/[source]/disconnect/retains-everything.test.ts`
- `amplify/explored-set-not-public.test.ts`
- `scripts/check-d123-trigger-{a,b}.mjs`, `scripts/d123-acknowledgements.json`,
  `scripts/check-route-cache-control.mjs`, `scripts/check-prerender-no-cell-data.mjs`
- `amplify.yml`, `.github/workflows/gate.yml`
