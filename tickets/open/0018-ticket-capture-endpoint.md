---
id: 18
slug: ticket-capture-endpoint
title: POST /api/tickets/capture commits a new file to tickets/inbox/
type: feature
priority: high
status: open
size: m
capability: 03-ticket-capture-endpoint
depends_on: [12, 14, 17]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The happy path of the capture endpoint: an authenticated POST creates one new markdown file in
`tickets/inbox/` on `main` via the GitHub Contents API, server-side, and returns the committed
path.

**D-092 is not satisfied until this ships** (roadmap §4.1). Until then, post-run ideas go to a
notes app and get hand-carried into the repo. That is the gap this closes; the in-app ticket UI
(capability `17`) is a later convenience, not the fix.

Credential is a **fine-grained PAT** per `07-ticketsmith.md` §6.2: scoped to the single
`lost-soles` repository, permission **Contents: read and write and nothing else**, 90-day
expiry, stored in **SSM Parameter Store as a `SecureString`**, fetched at cold start and held in
memory for the life of the execution environment. Per §6.1 no GitHub credential ever reaches the
browser — there is no client-side GitHub SDK and no token in a client-exposed env var.

Accepted body, verbatim from §6.4:

```json
{ "title": "string, 1..200",
  "body":  "string, 0..8192, optional",
  "type":  "feature|bug|design|chore",
  "priority": "low|med|high",
  "idempotencyKey": "uuid" }
```

The file written is the §3.4 inbox capture format — `status: inbox`, `title`, `type`,
`priority`, `source: ui`, `created`, then a `## Description` holding the body. No `id`, no
`slug`, no `size`, no `capability`, no acceptance criteria: **triage supplies those** (0023).

Frontmatter is emitted with a **real YAML serializer, never string concatenation** (§6.4/6):
a title containing `\n---\n` or a leading `!!python/object` must not be able to forge or break
frontmatter. Control characters are stripped and newlines in the title normalized to spaces
before serializing; null bytes are stripped from the body.

Per D-081 this Lambda is **not** VPC-attached — it only needs outbound HTTPS to
`api.github.com`, so no NAT Gateway is involved.

## Acceptance criteria

- [ ] `POST /api/tickets/capture` with a valid body commits exactly one file under
      `tickets/inbox/` on `main` and returns 201 with the committed path and commit sha.
- [ ] The committed file parses as valid frontmatter + markdown and matches the §3.4 inbox shape:
      `status: inbox`, `source: ui`, `created` set to the server's UTC now, no `id`/`slug`/`size`.
- [ ] Frontmatter is produced by a YAML serializer; a title containing `\n---\nstatus: closed\n---\n`
      round-trips as a single scalar string and does not create a second document.
- [ ] The PAT is read from SSM at cold start; `grep -r` over the built client bundle finds no
      `ghp_` or `github_pat_` string, and no GitHub token appears in any client-exposed env var.
- [ ] The logger has a redaction rule for `ghp_` / `github_pat_` prefixes; a deliberately logged
      token is masked in CloudWatch.
- [ ] The endpoint has **no update path and no delete path** — not disabled, absent. There is no
      handler that passes a `sha` to the Contents API.
- [ ] Unit tests cover: valid capture, empty optional body, and a title at exactly 200 chars.

## Notes

Hardening (auth, size caps, rate limits, path derivation, idempotency) is 0019 and is a hard
prerequisite for exposing this to the phone — do not point a Tasker tile at this until 0019 is
closed. This ticket is deliberately the plumbing only.

Note the acknowledged drawback of the PAT (§6.2): it acts **as the user**, so commits are
attributed to the operator. That is why the repo scoping and the Contents-only permission are
load-bearing rather than cosmetic. The GitHub App variant (§6.3, separate `lost-soles-bot`
identity, 1-hour installation tokens) is the v2 fix and is out of scope here.

Path derivation is deliberately in 0019 rather than here, because it is the security-critical
part and deserves its own review and its own test file.

## Operator validation

On the desktop browser at `soles.devaultsecurity.com`, signed in as the owner, POST a capture
from the browser devtools console (or `curl` with the session cookie). Then open
`github.com/<user>/lost-soles/tree/main/tickets/inbox` and confirm a new file appeared with the
title you sent, within a few seconds, and that the commit shows one file changed and nothing else.
Open the file in GitHub's markdown view and confirm the frontmatter renders as a table, not as
stray `---` text — that is the visible symptom of a broken serializer.
