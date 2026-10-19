"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"

/**
 * THE JUMP-TO CONTROL, AS PRESENTATION. Ticket `0285`.
 *
 * One 40px button on the map pane, directly under `⚙` (D-313: all map chrome lives on the pane),
 * closed by default. Open, it drops a short list of the operator's regions under itself, most
 * recently run first. Choosing one hands its id up and closes; `region-jump.tsx` moves the camera.
 *
 * Mouse and keyboard (D-253): the button opens it, focus moves into the list, ↑/↓ (and Home/End)
 * move the highlight, Enter or Space chooses, Esc closes and returns focus to the button, and a
 * click anywhere else or Tab away closes it. With fewer than two regions nothing renders at all
 * (criterion 4) — the caller decides that, this component only draws what it is given.
 *
 * Quiet on purpose: the same surface, rule and size as `⚙`, no count, no badge, nothing that
 * changes while it is closed.
 */

export interface RegionItem {
  id: string
  label: string
}

/**
 * What a key does in the open list, as data so it is tested without a DOM (the repo has none).
 * `null`: the key is not the list's, and is left alone.
 */
export type ListMove = { active: number } | { choose: number } | { close: "escape" | "tab" } | null

export function listKey(key: string, active: number, count: number): ListMove {
  if (count === 0) return key === "Escape" ? { close: "escape" } : null
  switch (key) {
    case "ArrowDown":
      return { active: Math.min(count - 1, active + 1) }
    case "ArrowUp":
      return { active: Math.max(0, active - 1) }
    case "Home":
      return { active: 0 }
    case "End":
      return { active: count - 1 }
    case "Enter":
    case " ":
      return { choose: active }
    case "Escape":
      return { close: "escape" }
    case "Tab":
      return { close: "tab" }
    default:
      return null
  }
}

/**
 * Positioned against the pane's right edge, as `⚙` is: `right: 16px` from the window IS the pane's
 * right edge at every width (the rail is on the left). `top: 64px` is `⚙`'s 16px inset, its 40px,
 * and the 8px gap §2.2 uses between stacked map controls. Clear of the mode toggle (top-left) and of
 * fit and `⌖` (bottom-right).
 */
export const REGION_JUMP_CSS =
  ".region-jump { position: fixed; z-index: 1; top: 64px; right: 16px; }" +
  " .region-jump-button { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;" +
  " box-sizing: border-box; padding: 0; background: var(--surface-raised); border: 1px solid var(--line);" +
  " border-radius: 4px; color: var(--text-primary); font-size: 18px; line-height: 1; cursor: pointer; }" +
  " .region-jump-button:hover { background: var(--bg); }" +
  " .region-jump-list { position: absolute; top: 48px; right: 0; min-width: 14rem; max-width: 20rem; max-height: 50vh;" +
  " overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; box-sizing: border-box;" +
  " background: var(--surface-raised); border: 1px solid var(--line); border-radius: 4px; }" +
  " .region-jump-option { display: flex; align-items: center; min-height: 32px; padding: 0 12px; cursor: pointer;" +
  " color: var(--text-primary); font: 400 14px/1.3 var(--font-sans); white-space: nowrap; overflow: hidden;" +
  " text-overflow: ellipsis; }" +
  " .region-jump-option[aria-selected=true] { background: var(--bg); box-shadow: inset 2px 0 0 var(--text-primary); }" +
  " .region-jump-button:focus-visible, .region-jump-list:focus-visible { outline: 2px solid var(--text-primary);" +
  " outline-offset: 2px; }"

export function RegionJumpControl({
  regions,
  onChoose,
  defaultOpen = false,
}: {
  regions: readonly RegionItem[]
  onChoose: (id: string) => void
  /** Tests only: the repo has no DOM, so the open list is checked by rendering it open. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const list = useRef<HTMLUListElement | null>(null)
  const listId = useId()

  // Focus follows the list open, so the arrows work at once.
  useEffect(() => {
    if (open) list.current?.focus()
  }, [open])

  // A click anywhere outside closes it. Nothing is chosen, nothing moves.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // The highlight stays on the list if the regions change under it.
  const current = Math.min(active, Math.max(0, regions.length - 1))

  function choose(index: number) {
    const region = regions[index]
    setOpen(false)
    button.current?.focus()
    if (region) onChoose(region.id)
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const move = listKey(event.key, current, regions.length)
    if (!move) return
    if ("active" in move) {
      event.preventDefault()
      setActive(move.active)
    } else if ("choose" in move) {
      event.preventDefault()
      choose(move.choose)
    } else {
      // Tab is left to the browser, so focus moves on as it would; only Esc takes it back.
      if (move.close === "escape") {
        event.preventDefault()
        button.current?.focus()
      }
      setOpen(false)
    }
  }

  const optionId = (i: number) => `${listId}-${i}`

  return (
    <div ref={root} className="region-jump" data-testid="region-jump">
      <style>{REGION_JUMP_CSS}</style>
      <button
        ref={button}
        type="button"
        className="region-jump-button"
        aria-label="Jump to a region"
        title="Jump to a region"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setActive(0)
          setOpen((o) => !o)
        }}
      >
        <span aria-hidden="true">⚑</span>
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Regions you have run in"
          className="region-jump-list"
          tabIndex={-1}
          aria-activedescendant={optionId(current)}
          onKeyDown={onListKey}
        >
          {regions.map((region, i) => (
            <li
              key={region.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className="region-jump-option"
              data-region={region.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {region.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
