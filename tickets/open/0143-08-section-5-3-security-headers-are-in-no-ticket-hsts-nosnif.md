---
id: 143
slug: 08-section-5-3-security-headers-are-in-no-ticket-hsts-nosnif
title: 08 section 5.3 security headers are in no ticket — HSTS, nosniff, frame-ancestors, CSP
type: feature
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T01:55:54Z
---

## Description

`08-security-privacy.md` §5.3's **Headers** row specifies, for every authed response:

> `Cache-Control: private, no-store` […] plus HSTS, `X-Content-Type-Options: nosniff`,
> `frame-ancestors 'none'`, and a CSP whose `connect-src` allows only the AppSync endpoint, the API
> origin, and the R2 tiles host

`Cache-Control: private, no-store` is covered — it is `0114`'s criterion C-3. **The other four are
in no ticket in the backlog.** `next.config.ts` sets no `headers()` and `middleware.ts` sets none,
so nothing at `soles.devaultsecurity.com` sends any of them today.

**Why this is worth its own ticket rather than a note.** §5.3 accepts a real risk on the strength of
one of these controls. Its token-storage row keeps the JWTs in `localStorage` and defends the choice
like this:

> an XSS in this app can steal a session — but an XSS in this app can also just *read the map*,
> which is the asset […] **The mitigation for XSS is a strict CSP and no
> `dangerouslySetInnerHTML`, not token gymnastics.**

The accepted risk and the compensating control were decided together. Shipping the acceptance and
not the control leaves the reasoning half-applied — and the half that is missing is the half that
does the work. This is not a hole anyone drilled; it is one nobody filled, which is exactly the kind
the close audit exists to find.

Capability `18` is the right home: §5.3's headers are hardening, and `09-roadmap.md` §2.3 does not
list them among what is deliberately missing at the first-usable milestone, so their absence is an
oversight rather than a deferral. Sequence with `0115` (secrets/dependency audit) and `0114`
(D-123 standing conditions), which already own the neighbouring rows of the same section.

## Acceptance criteria

- [ ] `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` and a
      `frame-ancestors 'none'` directive are sent on every response from the app.
- [ ] A CSP is sent whose `connect-src` allows only the AppSync endpoint, the app's own origin, and
      the R2 tiles host — no wildcard, and the tiles host named rather than inherited.
- [ ] The CSP is verified not to break the map: MapLibre, the pmtiles range requests and the
      WebGL worker all still load. A CSP that ships and is then loosened in a panic is worse than
      one designed against the real asset list.
- [ ] `dangerouslySetInnerHTML` appears nowhere in the app, asserted by a check rather than by
      reading — §5.3 names it as the other half of the XSS mitigation.
- [ ] A test asserts the headers are present on a representative authed route, so they cannot be
      dropped by a later `next.config.ts` edit without something going red.
- [ ] Where the headers are set is stated in the Resolution — `next.config.ts` `headers()` and
      `middleware.ts` are both plausible and they behave differently for static assets. Pick
      deliberately.

## Notes

Found by the capability `02` close audit (2026-09-02), AUDIT.md §2, resolved as `code-was-wrong`.
Recorded as divergence 4 of 4 in that audit and in **D-176**.

Filed against capability `18` rather than `02` because it is hardening, not deploy-and-auth — but
found in `02` because `0014` cited §5.3 and `0016` built the responses that should carry the
headers. Note `0019` (capture endpoint hardening) covers CORS for `/api/tickets/capture`
specifically; keep the two from overlapping.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the **Android phone at `https://soles.devaultsecurity.com`**, signed in, with the laptop attached
via `chrome://inspect`: the Network panel's response headers for the document request show HSTS,
`nosniff`, the CSP and the frame-ancestors directive. Then load the **map** and confirm tiles and
fog still render — a CSP that silently blocks the basemap looks identical to a slow network on a
phone, and this is the check that distinguishes them.
