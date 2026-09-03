# The quick-capture tile — building it on the phone

> # ⛔ DECLINED — 2026-09-03, D-184
>
> **Nothing in this document is scheduled work.** Tickets `0020` (this tile), `0021` (the Assistant
> routine) and `0022` (the offline retry queue) are closed as **declined**. Two reasons: the plan
> recommended **MacroDroid without ever pricing it** against the ~$3/mo D-081 budget, and the
> operator's judgement is that a phone-automation client is not worth its setup, maintenance and
> phone-wipe-reproduction cost for a channel that already works from a laptop.
>
> **The endpoint is unaffected and live** — `0018`, `0019`, `0149`–`0152`, smoke-tested on every
> push. What was dropped is the client in front of it.
>
> **Why this file is kept rather than deleted.** Two things in it are still load-bearing:
> the **refresh-token extraction procedure** below, which `tools/capture/capture.sh` still needs,
> and the action-by-action build, which is what a re-file would start from. Reviving the tile costs
> one new ticket against this document — but **do not use the MacroDroid recommendation as-is**;
> re-evaluate against a free client such as
> [HTTP Shortcuts](https://github.com/waboodoo/http-shortcuts) (open source, quick-settings tiles,
> arbitrary HTTP requests) before spending anything.
>
> Idea capture until capability `17` ships: a notes app, hand-carried into `tickets/inbox/`, or
> `tools/capture/capture.sh` from a laptop. That is the reopened D-092 gap, stated plainly.

Ticket `0020`. **Android only (D-124).** There is no iOS path here and there will not be one.

The runnable definition of this task is [`tools/capture/capture.sh`](../../tools/capture/capture.sh),
which does exactly what the macro below must do, in the same order, with the same two HTTP calls.
When the tile misbehaves, run that script from a laptop with the same refresh token: it tells you
whether the problem is the phone or the endpoint. Its logic is covered by
`tools/capture/capture.test.mjs`.

> **Why a spec and not a committed export.** The `.macro` / `.tsk.xml` formats encode actions as
> numeric codes, and an export written by hand — by an agent with no device to import it on —
> imports cleanly and then misbehaves. That failure surfaces at mile six, in the rain, on the one
> note that mattered. So the build is specified here, and **the export is produced by the phone
> once the macro works** and committed then. See `0020`'s amended criterion 7.

## Which app

**Superseded by the banner above — MacroDroid is no longer a recommendation, it is the dependency
that got this declined.** The paragraph is kept as the record of what was originally chosen and why.

**MacroDroid** is the recommendation. It has a first-class *Quick Settings Tile* trigger and a
*Voice Input* action, where Tasker needs the AutoTools/QuickTile plumbing for the same thing.
Tasker equivalents are given per step so either works.

## What the phone holds, and what it must never hold

The device stores **one Cognito refresh token** and nothing else. **No GitHub credential ever
reaches the phone** (`07-ticketsmith.md` §6.1) — the PAT lives in SSM and is read server-side by the
endpoint. If a step below seems to want a GitHub token, the step is wrong.

Obtain the refresh token once, per `0149`: sign in at `https://soles.devaultsecurity.com` in a
browser, then read it out of **cookies** — not Local Storage, which is empty because
`Amplify.configure(outputs, { ssr: true })` stores the session where the server can read it. In the
Console tab:

```js
decodeURIComponent(
  document.cookie.split('; ')
    .find(c => /^CognitoIdentityServiceProvider\..*\.refreshToken=/.test(c))
    .split('=').slice(1).join('=')
)
```

It lasts **one year** (`0151`).

## The macro, step by step

### Trigger

**Quick Settings Tile.** MacroDroid: *Add Trigger → Device Events → Quick Settings Tile*, pick a
free tile slot, label it `Lost Soles`. Then add the tile to the shade in Android's
*Settings → Quick Settings → Edit*.

*Tasker:* a `QuickTile` action bound to a task, via Tasker's own Quick Settings tiles.

### 1 — Dictate

**Voice Input** → store the result in a variable, `dictated`.

*Tasker: `Get Voice`, result to `%dictated`.*

If the recogniser returns nothing (a mis-tap, or silence), **stop the macro here.** An empty title
is a 400 the endpoint answers with `title must be 1..200 characters`, which surfaces as a failure
buzz for a capture that was never attempted.

### 2 — Generate the idempotency key, ONCE

**UUID** → variable `idem`. MacroDroid has a `[uuid]` magic text token; Tasker has
`%TIMES` plus `%RANDOM`, but prefer a real UUID if the plugin set allows one.

**This is the single most important step to get right.** The key must be generated **once per
dictation and reused on every retry** (`0022`). A key regenerated per attempt turns one dictated
note into N committed files the first time the network is slow enough that the request times out
*after* the server has already written the file. The endpoint's idempotency check (§6.4/9) is what
makes the retry safe, and it is keyed on this value.

### 3 — Title and body

- `title` = the first **200** characters of `dictated`.
- `body` = the **full** `dictated` text, included **only if** it ran past 200 characters.

The body is deliberately the whole thing rather than the remainder: a truncated title above the
complete note reads better at triage than a title cut mid-sentence followed by a body that starts
mid-word. Nothing is dropped either way, which is criterion 5.

### 4 — Refresh token → ID token

**HTTP Request**, POST to `https://cognito-idp.us-east-1.amazonaws.com/`

| | |
|---|---|
| `Content-Type` | `application/x-amz-json-1.1` |
| `X-Amz-Target` | `AWSCognitoIdentityProviderService.InitiateAuth` |

```json
{"AuthFlow":"REFRESH_TOKEN_AUTH",
 "ClientId":"5vc5e8t2ljv1hg3doau5mp0m00",
 "AuthParameters":{"REFRESH_TOKEN":"<the stored refresh token>"}}
```

Extract `AuthenticationResult.IdToken` into `idToken`. It is valid for 60 minutes.

No SigV4, no signing, no client secret — the app client has none, which is the only reason this is
reproducible in a phone automation app at all.

**If this call returns no `IdToken`** (`NotAuthorizedException`), the refresh token is dead:
expired or revoked. **This is not retryable.** Signal a distinct failure and stop; retrying a dead
credential forever is the thing `0022` must not do.

### 5 — The capture

**HTTP Request**, POST to `https://soles.devaultsecurity.com/api/tickets/capture`

| | |
|---|---|
| `Authorization` | `Bearer <idToken>` |
| `Content-Type` | `application/json` |

```json
{"title":"<title>","body":"<body, omitted when short>",
 "type":"feature","priority":"med","idempotencyKey":"<idem>"}
```

**Send no other keys.** The endpoint rejects unknown keys rather than stripping them (§6.4), so one
stray field is a 400 that reads on the phone as "capture failed" with nothing to explain it.

### 6 — Tell the operator, without requiring an unlock

Criterion 6. Success and failure must be distinguishable with the phone still in your hand and the
screen still locked:

| Response | Meaning | Signal |
|---|---|---|
| **201** | committed | one short vibration |
| **200** | replay of a key already committed — also success | one short vibration |
| **429** / **503** | retryable; the note is not lost | two short buzzes, hand to the retry queue (`0022`) |
| **404** | the token did not verify, or not the owner | long buzz — something is wrong, re-pair |
| anything else | | long buzz |

A toast is not enough on a locked screen. Vibration is the channel that works with the phone in a
pocket and gloves on.

## The lock-screen question

Whether the tile can run **without unlocking** is the thing only the device can answer, and it is
the whole value of this ticket (`0020`'s criterion 2). Android lets a tile mark itself as requiring
an unlock, and the speech recogniser may demand one regardless of what the tile says.

**If an unlock turns out to be required, record it here rather than quietly accepting it.**
"Requires one unlock" is a real degradation — it is most of the difference between capturing a
thought at mile six and losing it.

## Exporting, once it works

MacroDroid: *Menu → Export/Import → Export selected macros* → commit the `.macro` file to
`tools/capture/`. Tasker: long-press the task → *Export → As XML file* → commit the `.tsk.xml`.

Then update `0020`'s criterion 7 and name the path here. A phone wipe should be recoverable from
the committed export; this page is the fallback if the export is ever unreadable.
