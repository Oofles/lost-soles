---
id: 24
slug: runbook-rotating-the-github-pat
title: Runbook - rotating and revoking the GitHub PAT
type: docs
priority: med
status: open
size: s
capability: 03-ticket-capture-endpoint
depends_on: [18]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The capture endpoint holds a 90-day fine-grained PAT with **Contents: read/write on the
`lost-soles` repo**. That token will expire on a schedule and may one day leak. Both need a
written procedure, because both will be handled while annoyed.

Write the runbook into `docs/capabilities/03-ticket-capture-endpoint.md` (or a
`docs/runbooks/` file it links) covering the two paths from `08-security-privacy.md` §8.2:

**Scheduled rotation (every 90 days).**
1. Issue a new fine-grained PAT: **one repo, Contents: read/write only, 90-day expiry**
   (`07-ticketsmith.md` §6.2). No Actions, no workflows, no admin.
2. Update the SSM `SecureString` parameter.
3. Redeploy (or force a cold start) so the Lambda picks it up — the token is cached in memory for
   the life of the execution environment, so an in-flight warm environment keeps the old one.
4. Verify with a live test capture.
5. Revoke the old token and confirm it 401s.
6. Reset the calendar reminder for day 80.

**Leak response (S5).**
- **Detect** — GitHub's own secret scanning emails on a push; unexpected commits or a changed
  default branch; an unexpected author in `git log`; the token appearing in a build log.
- **Contain** — **revoke the PAT in GitHub settings first. One click.** Then check
  `.github/workflows/` on *every branch*, because repo write means CI execution, and a workflow
  file added by an attacker runs with whatever the repo's Actions secrets hold.
- **Rotate** — as above. **Then seriously consider doing `07-ticketsmith.md` §6.3 instead** — the
  GitHub App with 1-hour installation tokens is the structural fix, and an incident is the moment
  its cost stops looking theoretical.
- **Verify** — the old token 401s; `/api/tickets/capture` still commits a test capture; review
  the **full** commit log since the leak, not just the tip; confirm branch protection and push
  protection are on. If anything was committed by the attacker, the repo is the source of a
  deployment — `08-security-privacy.md` §8.3 (AWS credential leak) is then also in scope.

## Acceptance criteria

- [ ] The runbook exists in the repo and is linked from the capability doc.
- [ ] It names the exact SSM parameter path and the exact GitHub PAT settings (single repo,
      Contents read/write only, 90-day expiry).
- [ ] It states that the Lambda caches the token per execution environment and therefore requires
      a redeploy or cold start, not just an SSM write.
- [ ] The leak path lists detect / contain / rotate / verify in that order, with **revoke first**
      before any investigation.
- [ ] The `.github/workflows/` check across all branches is called out explicitly as the
      escalation path.
- [ ] A calendar reminder for day 80 of the current token's life has actually been created (not
      just described).
- [ ] The runbook records the current token's issue date and expiry date, and says where to
      update them on rotation.
- [ ] The GitHub App (§6.3) is named as the standing recommendation with its trade-offs, so the
      next rotation is a prompt to reconsider rather than a reflex.

## Notes

`docs` type: the deliverable is prose, and its value is entirely in being correct at 11pm on the
day it is needed. Test it by following it — a runbook that has never been executed is a draft.

The PAT acting **as the user** (§6.2) means commits are attributed to the operator and blast
radius is whatever the token reaches. The runbook should say this plainly so the leak path is
taken seriously.

## Operator validation

**Desktop, GitHub settings page and the AWS SSM console.** Actually perform one rotation by
following the runbook verbatim, without improvising. Then, from the phone, tap the capture tile
and confirm a new file lands in `tickets/inbox/` — that is the proof the rotation did not break
the endpoint. Any step you had to improvise is a defect in the runbook; fix it before closing.
