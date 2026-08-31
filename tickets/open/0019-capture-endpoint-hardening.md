---
id: 19
slug: capture-endpoint-hardening
title: Harden the capture endpoint - owner auth, server-derived path, size and rate limits, idempotency
type: feature
priority: high
status: open
size: m
capability: 03-ticket-capture-endpoint
depends_on: [18]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The capture endpoint is a **write primitive pointed at the source repository**. This ticket
applies `07-ticketsmith.md` §6.4 and §6.5 in full. Nothing on the phone may point at the
endpoint until this closes.

**The client never supplies the file path.** The server derives it:

```
path = "tickets/inbox/" + utcNow("YYYY-MM-DDTHHmm") + "-" + slugify(title).slice(0, 60) + ".md"
```

`slugify` lowercases, replaces every non-`[a-z0-9]` run with `-`, and trims leading and trailing
`-`. The result is then **re-validated** against
`^tickets/inbox/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$`, and anything failing that regex is a
**500, not a fallback**. A client-supplied path is a path-traversal bug that writes arbitrary
files into the repository — including `.github/workflows/` and `.claude/`, either of which is
remote code execution against the operator's machine or CI.

A second, independent prefix check runs immediately before the API call (§6.4/3): reject any
computed path not beginning `tickets/inbox/`, and reject any path containing `..`, a leading `.`,
a backslash, a null byte, or a `/` beyond the two in the prefix. Belt and braces — check 2 makes
traversal impossible, check 3 makes a future refactor of check 2 fail closed.

Also in scope:

- **Owner-only auth.** A valid Lost Soles session **and** the user id against a hard-coded
  allowlist. Not "is logged in" — "is the owner." The route returns **404, not 403**, to a
  non-owner (§6.5) so it does not confirm it exists. This stays owner-only even after D-014 adds
  friends.
- **Reject-unknown-keys**, not strip-unknown-keys, so a future client bug surfaces as a 400
  instead of silently dropping data.
- **Create-only.** Contents API called **without a `sha`**, so an existing path returns 422
  rather than overwriting. On a 422 from a same-minute collision, retry once with a `-2` suffix,
  then fail.
- **Size and rate limits.** Title 200 chars, body 8 KB, total request 16 KB. 30 creates/hour and
  200/day per user, enforced server-side with a DynamoDB counter carrying a TTL.
- **Idempotency.** Store `idempotencyKey` with a 24-hour TTL; a repeat key returns the original
  result without a second commit. This is what makes the 0022 retry queue safe.
- **CORS locked** to the app's own origin.

## Acceptance criteria

- [ ] A request body containing a `path` key is rejected **400 unknown key**; the path is never
      read from input under any key name.
- [ ] A title of `../../.github/workflows/pwn.yml` produces a path of the form
      `tickets/inbox/<ts>-github-workflows-pwn-yml.md` and nothing outside `tickets/inbox/`.
- [ ] A unit test calls the prefix guard directly with `tickets/open/x.md`, `../x.md`,
      `tickets/inbox/../../x.md`, `tickets/inbox/a/b.md`, a leading-dot name, a backslash and an
      embedded null byte — every one is rejected.
- [ ] A title that slugifies to the empty string (e.g. all emoji) fails the regex and returns
      500, not a file at a fallback path.
- [ ] A signed-in **non-owner** receives **404**, not 403, and no commit is made.
- [ ] An unauthenticated request receives 404 and no commit is made.
- [ ] A 201-byte title, an 8.1 KB body, and a 17 KB request each return 400 and make no commit.
- [ ] The 31st create within one hour returns 429; the counter row carries a TTL.
- [ ] Replaying an identical request with the same `idempotencyKey` returns the **original**
      path and commit sha and creates **no second commit**.
- [ ] Two captures with the same title in the same minute produce two files, the second with a
      `-2` suffix; a third in the same minute fails cleanly rather than overwriting.
- [ ] The `Access-Control-Allow-Origin` header names the app origin only.

## Notes

The §6.5 abuse table is the test plan; each row above maps to one row of it. The one abuse case
**not** covered here is the forged webhook against the browse cache (§6.4/7, HMAC over the raw
body with constant-time comparison) — that belongs with the cache in capability `17`, because
the cache does not exist yet. Do not build a webhook route here that nothing reads.

§6.6 offers a more paranoid variant — commit to a `tickets-inbox` branch rather than `main` and
let `/tickets sync` merge it. Deliberately **not** taken: checks 2-4 already confine writes to
`tickets/inbox/` and make them create-only, which makes direct-to-`main` defensible for a
single-operator project. Revisit if the credential ever broadens or if branch protection lands
on `main` for another reason.

## Operator validation

On the Android phone, in Chrome, signed in: send a capture whose title is
`../../.github/workflows/pwn.yml`. Then on the desktop, open the repo's
`.github/workflows/` directory on GitHub and confirm it is unchanged, and open `tickets/inbox/`
and confirm the file landed there with a mangled-but-harmless name. Then sign out and re-send —
you should get a 404 page, not a permission error.
