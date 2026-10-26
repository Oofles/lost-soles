import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * TICKET `0112` — *"No action anywhere is reachable only by a gesture, or only by a pointer"*
 * (06 §9.2, D-253), held at the source across `app/` and `components/`.
 *
 * Every pointer handler in JSX sits on an element the keyboard can reach and activate (a button, a
 * link, a form control), or is listed below with the keyboard path that does the same thing. Every
 * pointer listener added by hand is listed the same way. A new one fails here until it has one.
 * There is no drag-and-drop and no context-menu path anywhere (§9.2).
 *
 * The walk itself — Tab through every screen, every action done — is the operator's, in the desktop
 * browser (D-229); this is what makes that walk short.
 */

const ROOT = join(import.meta.dirname, "..")

function sources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ file: relative(ROOT, path), src: readFileSync(path, "utf8") })
    }
  }
  for (const d of ["app", "components"]) walk(join(ROOT, d))
  return out
}

/** Elements the keyboard reaches and activates by themselves. */
const ACTIVATABLE = new Set(["button", "a", "Link", "input", "select", "textarea", "summary"])

/** Pointer handlers on other elements, each with the keyboard path that does the same thing. */
const POINTER_EXTRAS: Record<string, string> = {
  "app/skills/skill-sheet.tsx <div onClick>": "the scrim's click-outside; Esc and the sheet's close button dismiss it too (§1.5)",
  "components/map/region-jump-control.tsx <li onClick>": "a listbox option; the list's onKeyDown takes arrows, Enter and Esc (0285)",
}

/** Pointer listeners added outside JSX, each with its keyboard path. */
const LISTENERS: Record<string, string> = {
  'components/map/region-jump-control.tsx addEventListener("mousedown"': "click-outside closes the list; Esc and Tab close it too",
  'lib/run-moment/exit.ts addEventListener("click"': "a click skips the sequence; Esc and Back skip it too (0084)",
  'components/map/map-controls.tsx map.on("click"': "a route line inspects its run; every run is reachable from RUNS (the Chronicle) and the last-run line",
  'components/map/map-controls.tsx map.on("mousemove"': "the pointer cursor over a route line, and nothing else (D-313: hover carries no information)",
  'lib/sheet/swipe-dismiss.ts addEventListener("pointerdown"': "a touch swipe-down closes a sheet; Esc, the close control and Back still work (D-314)",
  'lib/sheet/swipe-dismiss.ts addEventListener("pointerup"': "the same swipe's end",
}

describe("keyboard reachability (0112, 06 §9.2)", () => {
  const files = sources()

  it("every JSX pointer handler is on an activatable element, or listed with its keyboard twin", () => {
    const found: string[] = []
    for (const { file, src } of files) {
      for (const m of src.matchAll(/\bon(Click|PointerDown|PointerUp|MouseDown|MouseUp|DoubleClick)=/g)) {
        // The element the attribute belongs to: the nearest `<Tag` before it.
        const before = src.slice(0, m.index)
        const tag = /<([A-Za-z][\w.]*)(?![\s\S]*<[A-Za-z])/.exec(before)?.[1] ?? "?"
        if (ACTIVATABLE.has(tag)) continue
        found.push(`${file} <${tag} on${m[1]}>`)
      }
    }
    expect(found.sort()).toEqual(Object.keys(POINTER_EXTRAS).sort())
  })

  it("every pointer listener added by hand is listed with its keyboard twin", () => {
    const found: string[] = []
    for (const { file, src } of [...files, ...["lib/run-moment/exit.ts", "lib/sheet/swipe-dismiss.ts"].map((f) => ({ file: f, src: readFileSync(join(ROOT, f), "utf8") }))]) {
      for (const m of src.matchAll(/(addEventListener|map\.on)\("(click|dblclick|mousedown|mouseup|mousemove|pointerdown|pointerup|contextmenu|wheel)"/g)) {
        found.push(`${file} ${m[1]}("${m[2]}"`)
      }
    }
    expect([...new Set(found)].sort()).toEqual(Object.keys(LISTENERS).sort())
  })

  // `/log`'s held − and + repeat (§6.4) is an accelerator over a click per step, not a path of its own.
  it("no drag-and-drop and no context menu anywhere (§9.2)", () => {
    for (const { file, src } of files) {
      expect(src, file).not.toMatch(/\bdraggable\b|onDrag\w*=|onDrop=|onContextMenu=/)
    }
  })
})
