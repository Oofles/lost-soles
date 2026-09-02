---
id: 114
slug: d123-standing-conditions-wired
title: The D-123 standing conditions, wired as code and CI rather than caveated
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [17, 24, 111]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] **Trigger A is code:** a CI check enumerates the production Cognito pool and fails if any
      user other than the owner exists without a recorded `D-2xx` superseding D-123.
- [ ] **Trigger B is CI:** a check greps changed tickets, docs and diffs for the trigger-B
      vocabulary and fails the build with a message naming the §2.4 gate; the operator can only
      pass it by recording a decision, not by editing the pattern.
- [ ] **Trigger C is CI:** a check asserts no built artifact under `.next/static` and no entry in
      the prerender manifest contains cell or trace data (C-2), and that every authed route sets
      `Cache-Control: private, no-store` (C-3).
- [ ] `explored-r10.bin` is fetched with credentials from an owner-scoped prefix via a short-lived
      signed URL or an authed route; a test asserts an unauthenticated fetch of the object's
      predictable key returns 403 (C-4).
- [ ] The public surface is enumerated in `docs/capabilities/18-mvp-hardening.md`: the webhook
      Function URL, the sign-in page, static assets, and the R2 tile bucket — with the note that
      **the tile bucket serves the generic basemap only and the explored set is never baked into
      a tile** (C-1).
- [ ] `CLAUDE.md` carries the standing note pointing at §2.4 by name, next to its `DECISIONS.md`
      pointer.
- [ ] The ticket template's `## Operator validation` section carries the D-123 trigger line, and
      the triage command flags matching inbox captures.
- [ ] `/api/dev/tickets` and `/dev/tickets` are owner-only (A-6), asserted by a test signing in as
      a non-owner.

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
carries cell data. On the Android phone, sign out completely and try to fetch the
`explored-r10.bin` URL you can see in devtools while signed in: it must 403. Finally, open
`CLAUDE.md` on the phone and confirm the standing note is visible in the first screenful — if an
agent has to scroll to find it, it will not be read.
