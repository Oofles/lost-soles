import { describe, expect, it } from "vitest"

import { markSheetOpenedFromHome, sheetOpenedFromHome } from "./sheet-origin"

/**
 * `0270`. A sheet opened from the plinth's quick-view dismisses back to `/` (Esc, scrim, Close); a
 * deep link to the same sheet still replaces itself with `/skills`.
 */
describe("where a skill sheet was opened from (0270)", () => {
  it("a quick-view click marks its own sheet, and the mark survives a re-render (strict mode)", () => {
    markSheetOpenedFromHome("/skills/a")
    expect(sheetOpenedFromHome("/skills/a")).toBe(true)
    expect(sheetOpenedFromHome("/skills/a")).toBe(true)
  })

  it("any other path drops the mark, so a later deep link is never mistaken for a quick-view open", () => {
    markSheetOpenedFromHome("/skills/a")
    expect(sheetOpenedFromHome("/skills")).toBe(false)
    expect(sheetOpenedFromHome("/skills/a")).toBe(false)
  })

  it("with no click at all, nothing was opened from home", () => {
    expect(sheetOpenedFromHome("/skills/b")).toBe(false)
  })
})
