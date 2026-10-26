/**
 * Ticket 0230. vitest `setupFiles`: runs in the worker before each test file is imported.
 * Points `TMPDIR` at a fresh per-file directory and removes it after the file, pass or fail.
 * The why, and what happens on a killed run, is in vitest-tmpdir.mjs.
 */
import { rmSync } from "node:fs"
import { afterAll } from "vitest"
import { REAL_TMPDIR, makeFileTmp } from "./vitest-tmpdir.mjs"

const previous = process.env.TMPDIR
const dir = makeFileTmp(REAL_TMPDIR)
process.env.TMPDIR = dir

const remove = () => rmSync(dir, { recursive: true, force: true })

afterAll(() => {
  if (previous === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = previous
  remove()
})

// A test file that throws at module scope (where every CDK suite synthesises, so where an
// ENOSPC lands) never runs its afterAll, and vitest kills the worker without an "exit"
// event. globalSetup's teardown sweeps that dir once the worker is gone.
