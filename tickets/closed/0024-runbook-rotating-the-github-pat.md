---
id: 24
slug: runbook-rotating-the-github-pat
title: Runbook - rotating and revoking the GitHub PAT
type: docs
priority: med
status: closed
size: s
capability: 03-ticket-capture-endpoint
depends_on: [18]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-03T20:12:07Z
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

- [x] The runbook exists in the repo and is linked from the capability doc.
      — `docs/runbooks/github-pat-rotation.md`, linked from a new `## Runbooks` section in
      `docs/capabilities/03-ticket-capture-endpoint.md`.
- [x] It names the exact SSM parameter path and the exact GitHub PAT settings (single repo,
      Contents read/write only, 90-day expiry).
      — §0, with the path verified live against SSM rather than copied from source.
- [x] It states that the Lambda caches the token per execution environment and therefore requires
      a redeploy or cold start, not just an SSM write.
      — §1 step 3, marked NOT OPTIONAL, with the failure shape spelled out: delayed, intermittent,
      and disconnected from the action that caused it.
- [x] The leak path lists detect / contain / rotate / verify in that order, with **revoke first**
      before any investigation.
      — §2.
- [x] The `.github/workflows/` check across all branches is called out explicitly as the
      escalation path.
      — §2 Contain, with a runnable `git ls-tree` loop over every remote branch.
- [x] A calendar reminder for day 80 of the current token's life has actually been created (not
      just described).
      — Created 2026-11-19, all-day, event id `kq7eqksadj6hdn4me09bmlnqps`, popup + email alerts.
      Recorded in runbook §4.
- [x] The runbook records the current token's issue date and expiry date, and says where to
      update them on rotation.
      — §0 "Current token". **The issue date is evidence (SSM version 1, written 2026-08-31); the
      expiry is DERIVED from it and marked unconfirmed**, with the command to check it — see
      `## Resolution`.
- [x] The GitHub App (§6.3) is named as the standing recommendation with its trade-offs, so the
      next rotation is a prompt to reconsider rather than a reflex.
      — §3, as a comparison table, plus a line in §2's Rotate step.

## Notes

`docs` type: the deliverable is prose, and its value is entirely in being correct at 11pm on the
day it is needed. Test it by following it — a runbook that has never been executed is a draft.

The PAT acting **as the user** (§6.2) means commits are attributed to the operator and blast
radius is whatever the token reaches. The runbook should say this plainly so the leak path is
taken seriously.

## Operator validation

> **D-181 — most of what follows was the AGENT's to run, and was run.** The original author's text
> is preserved at the end of this section as the statement of intent. What actually happened is
> recorded first.

### Smoke tests, run 2026-09-03

- **The SSM parameter is real and its metadata is what the runbook claims.**
  `aws ssm describe-parameters` on `/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT` returned
  `Type: SecureString`, `KeyId: alias/aws/ssm`, **`Version: 1`**, `LastModified 2026-08-31T21:21:03-04:00`,
  written by the account root. Every figure in runbook §0 comes from that call, not from the source
  tree — so a drift between code and deployment would have shown up here.
- **The cold-start claim is verified in the code, not assumed.** `lib/tickets/github.ts` caches a
  *promise* at module scope, resets it on failure so a transient SSM error cannot poison the
  environment, and has no invalidation path. That is exactly the behaviour §1 step 3 warns about.
- **The logger's redaction rules exist**, so the §2 Detect line about a token in a build log is a
  real signal rather than an aspiration: `lib/log.ts` redacts `github_pat_`, `ghp_`, `gh[opsu]_`,
  `AKIA…`, Slack tokens and PEM headers at the log call.
- **The calendar reminder was created, not described** — event `kq7eqksadj6hdn4me09bmlnqps`,
  2026-11-19, popup + email. This is criterion 6 and it is the one that keeps the endpoint up.

### What could NOT be checked, and why

**The token's true expiry.** Confirming it means reading the `SecureString` and calling
`api.github.com/user` for the `github-authentication-token-expiration` header. The sandbox
classifier blocked that command, correctly — it is a secret read, and the guard should not have an
exception carved for convenience. So the runbook records **2026-08-31 as evidence** and
**~2026-11-29 as derived**, labels the derived figure as unconfirmed rather than presenting an
inference as a fact, and gives the exact command to settle it. The calendar event's description
carries the same caveat, so the day the reminder fires is the day it gets checked at worst.

**One operator action outstanding, and it is 30 seconds:** open
<https://github.com/settings/personal-access-tokens>, read the real expiry, and correct runbook §0's
table if it is not 2026-11-29 (move the calendar event too, if so). Everything else in this ticket
is done.

### The real test of a runbook is executing it

**Not yet possible, and deliberately not faked.** A rotation needs a new PAT issued in GitHub's UI —
operator-only — and doing one *now* would burn the current token's remaining 87 days to prove the
document. The honest schedule is: **the day-80 reminder is the first execution.** Follow it
verbatim; any step you have to improvise is a defect in the file, and fixing it then is what turns
this from a draft into a runbook.

### Original author's intent, preserved

> **Desktop, GitHub settings page and the AWS SSM console.** Actually perform one rotation by
> following the runbook verbatim, without improvising. Then, from the phone, tap the capture tile
> and confirm a new file lands in `tickets/inbox/` — that is the proof the rotation did not break
> the endpoint. Any step you had to improvise is a defect in the runbook; fix it before closing.

**Amended:** the capture tile does not exist (`0020`, declined, D-184). The runbook's verify step
uses `tools/capture/capture.sh` from a laptop instead, which reaches the same endpoint through the
same auth path and is scriptable — a better verification than a tile would have been, because it can
be run without a phone at 11pm during an incident.

---

## Resolution

**Written 2026-09-03.** `docs/runbooks/github-pat-rotation.md` — 216 lines covering the scheduled
90-day rotation and the S5 leak response, from `08-security-privacy.md` §8.2 and
`07-ticketsmith.md` §6.2/§6.3.

**A new `docs/runbooks/` directory rather than a section in the capability doc.** Two more runbooks
are already scheduled — `0106` (account deletion, executed against a throwaway) and `0115` (incident
playbook dry-read) — and they should share a location the operator can find while annoyed, not be
scattered through capability docs by whichever ticket happened to author them. The capability doc
links to it under a `## Runbooks` heading.

**The step the whole document exists to stop you skipping is the cold start.** `getToken()` caches
at module scope for the life of the execution environment, so `put-parameter` alone changes nothing
for a warm environment. The rotation then *looks* complete and 401s at an unpredictable later time —
delayed, intermittent, and disconnected from the action that caused it, which is the worst possible
failure shape for a credential change. It is marked NOT OPTIONAL in the text.

**Ordering that is not arbitrary:** verify the new token with a live capture *before* revoking the
old one. Fail the verification and you still have a working system on the old credential; revoke
first and you have an outage plus a debugging session, at the exact moment you were trying to reduce
risk.

### Two findings

**1. Filed as `0154`, not fixed here (D-152).** The docs name the endpoint `/api/dev/tickets` in ten
places across `07-ticketsmith.md`, `08-security-privacy.md`, `06-ui-ux.md` and `INDEX.md`; the built
route is `/api/tickets/capture`. This was found by trying to cite §8.2's Verify step and discovering
the path does not exist. Two of the ten are operational instructions followed under pressure —
§8.2's leak-response Verify, and checklist item **A-6** ("`/api/dev/tickets` remains owner-only"),
which someone could tick because a curl 404s for entirely the wrong reason. The runbook uses the
correct path throughout; ten edits across four documents plus an index rebuild is a separate ticket.

**2. The token has never been rotated and its expiry has never been confirmed.** SSM parameter
version is **1**, written 2026-08-31. The 90-day expiry is project policy, so ~2026-11-29 is a
sound inference — but it is an inference, and a runbook that presents one as a fact is how you
discover the real date by outage. §0 marks it unconfirmed and gives the one-line command; the
calendar event repeats the caveat.

**Files touched:** `docs/runbooks/github-pat-rotation.md` (new), `docs/capabilities/03-ticket-capture-endpoint.md`
(runbook link, design note, declined-ticket strikethroughs), this ticket. Plus the calendar event,
which is the deliverable for criterion 6 and lives outside the repo by nature.

**Capability `03` is now complete** — every ticket closed or declined. The audit is next and it
gates the six tickets waiting on it.
