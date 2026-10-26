import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { PREFIX, REAL_TMPDIR, cdkOutDirs, makeFileTmp, ownerPid, sweepStale } from "./vitest-tmpdir.mjs"

/** Ticket 0230: the per-file TMPDIR that stops the CDK synth suites leaking into /tmp. */

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "sweep-"))
  dirs.push(d)
  return d
}

describe("the per-file TMPDIR (0230)", () => {
  it("is in effect for this file: os.tmpdir() is a private dir under the real temp dir", () => {
    const here = tmpdir()
    expect(here).not.toBe(REAL_TMPDIR)
    expect(here.startsWith(join(REAL_TMPDIR, `${PREFIX}${process.pid}-`))).toBe(true)
  })

  it("parses the owning pid from a per-file dir name, and nothing else", () => {
    expect(ownerPid(`${PREFIX}4242-AbC123`)).toBe(4242)
    expect(ownerPid("cdk.outAbC123")).toBeNull()
    expect(ownerPid(`${PREFIX}notapid-x`)).toBeNull()
  })

  it("sweeps a dead worker's leftover (a killed run) and spares live ones and strangers", () => {
    const root = scratch()
    const dead = makeFileTmp(root, 111)
    mkdirSync(join(dead, "cdk.outXYZ"))
    const live = makeFileTmp(root, 222)
    mkdirSync(join(root, "cdk.outStranger"))

    const removed = sweepStale(root, (pid) => pid === 222)

    expect(removed).toHaveLength(1)
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(readdirSync(root)).toContain("cdk.outStranger")
    expect(cdkOutDirs(root)).toEqual(["cdk.outStranger"])
  })
})
