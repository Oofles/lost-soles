---
id: 83
slug: chronicle-and-frontier-lines
title: Beats 4 and 5 — the chronicle line and the frontier line
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [81, 48]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Two lines of text that do more emotional work per byte than anything else in the app.

**Beat 4 — the chronicle line (6.0 → 7.2 s).** One generated sentence in the setting's voice, keyed
off the run's most distinctive computed fact. `04-game-design.md` §4.2 supplies the template table.

- Spectral Italic 17sp, `--ink-700`, on the ledger, centred, 22dp of air above and below. **Nothing
  else on screen moves while it is there.**
- Fades in over 500 ms and **stays in the end state**.
- *"Thirty-eight paces in a hundred fell on roads that had never felt your step."*
- *"You returned to Ashgrove Lane after two hundred and eleven days. It remembered you."*

The line is cheap — a template table over facts the ledger already computed — and it is what makes
the app feel like it is paying attention. It is a **template table**, data, not a `switch`: adding a
line is adding a row.

The table must include the dedicated **no-new-ground set** (§3.5 rule 4), written to be *warm*,
never consoling:

- *"Old roads, run well. The map holds them still."*
- *"The eleventh league along the river. It knows your weight by now."*
- *"You have now walked further than the road from here to Carlisle."* (lifetime threshold)
- *"Ashgrove Lane comes back into season in nineteen days."* (a cell approaching the 6-month re-arm —
  the **only** forward-looking line in the app, and it is an invitation, not a deadline)

**Never**: *"No new territory today"*, *"0 cells discovered"*, *"Try somewhere new!"* The first
states a lack, the second quantifies it, the third gives an instruction — and instructions are N2 in
miniature.

**Beat 5 — the frontier line (7.2 → 8.4 s).** One line at the very bottom:

```
  ◇  Unclaimed ground 1.2 km north — Millbrook
```

- `--ink-500`, 14sp, small hollow diamond glyph. **Quiet by construction.**
- Tapping it recentres the map there in **atlas** mode.
- **Ignoring it costs nothing.** It never repeats, never turns red, never counts down, never appears
  as a notification (D-013, `04-game-design.md` §4.2). It is a signpost, not a task.

## Acceptance criteria

- [ ] Beat 4 spans 6.0 → 7.2 s and beat 5 spans 7.2 → 8.4 s, ± 0.1 s each, on the target phone.
- [ ] The chronicle line fades in over 500 ms with nothing else on screen animating during it.
- [ ] Both lines persist into the end state and survive a scroll.
- [ ] The template table is a data file (YAML/JSON); adding a new line requires **zero** code diff,
      proven by a test that adds one and asserts it can be selected.
- [ ] Selection is deterministic given the same facts: the same activity produces the same line
      twice, so a `⟲ Relive` does not rewrite history.
- [ ] Line selection has a guaranteed fallback: a run whose facts match no template still gets a
      line — never an empty slot, never a placeholder.
- [ ] A run with `newCells = 0` selects from the no-new-ground set, never from a set that would
      mention new ground.
- [ ] A repository-wide test asserts no template string contains the substrings `No new`,
      `0 cells`, or an imperative "Try" — the three forbidden shapes.
- [ ] The frontier line names a real nearest unexplored frontier with a distance and a bearing; a
      tap recentres the map there in atlas mode.
- [ ] The frontier line is rendered once, never repeats, never changes colour, and has no
      notification, badge or countdown anywhere in its code path.

## Notes

Depends on 0081 (the ledger the lines sit on) and 0048 (the discovery classification that supplies
the facts). The nearest-frontier computation shares its source with 0090's derived stats feed —
build it once, in the domain layer, not twice.

The re-arm line ("comes back into season in nineteen days") is the single forward-looking string
permitted in the entire app. It exists because the 6-month re-arm (D-120) is genuinely good news, not
because the app should ever be pointing at the future. Do not let it become a pattern; if a second
forward-looking template is proposed, it needs a decision record, not a commit.

## Operator validation

**Go for an actual run and import it.** On the Android phone, read the chronicle line out loud. Does
it sound like the app noticed something, or like a fortune cookie? That is a judgement only the
operator can make and it is the point of this ticket.

Then run a loop you have run many times before, import it, and read the line it picks. It must land
as *"you did the work"* and never as consolation. If it makes you feel slightly worse about a
perfectly good run, the template set is wrong and the ticket is not done.

Finally tap the frontier line and confirm the map recentres in atlas mode on somewhere real and
reachable — and then deliberately ignore it for a week and confirm the app never mentions it again.
