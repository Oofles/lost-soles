// ONE OWNER FOR "WHERE THE HARNESS SCRATCHES", because there were four and they all leaked.
//
// Every tool here compiles TypeScript to a scratch directory and points headless chromium at an
// HTML file inside it. Two constraints shape where that directory may be, and they pull in
// opposite directions until you notice they do not:
//
//   1. **Chromium under WSL will only load `file://` from under `$HOME`.** Point it at `/tmp` and
//      the page silently never runs — no error, just an empty `<pre>`. This is why the original
//      four tools wrote to `$HOME` and it was the right diagnosis.
//   2. **The project must not create anything outside itself.** The operator found 27 abandoned
//      `~/fog-*` directories, one per harness run since ticket `0055`, because (1) was solved by
//      reaching for `$HOME` directly and nothing ever deleted them.
//
// Both hold at once: THE PROJECT IS ITSELF UNDER `$HOME`. `<repo>/tmp/fog-harness/` is under
// `$HOME` for chromium's purposes and inside the project for the operator's, and `tmp/` is already
// gitignored because a render of the real fog traces the operator's route (D-199, `08` §7.2).
//
// The cleanup is the other half. `mkdtempSync` without a matching `rm` is a leak with a slow fuse:
// each run is ~130 KB and nothing fails, so it is invisible until someone lists their home
// directory a month later.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * A scratch directory inside the project, removed when the process exits however it exits.
 *
 * @param prefix  names the tool, so a directory surviving a `SIGKILL` says which run left it.
 * @param keep    skip the cleanup — for debugging a page that will not run.
 */
export function harnessWorkdir(prefix, { keep = process.env.FOG_HARNESS_KEEP === "1" } = {}) {
  const base = join(ROOT, "tmp", "fog-harness")
  mkdirSync(base, { recursive: true })
  const work = mkdtempSync(join(base, `${prefix}-`))

  if (!keep) {
    // `exit` covers a normal return and an uncaught throw; the signals cover a Ctrl-C, which is how
    // a harness run most often ends when the page is hanging. `rmSync` must be sync — an async
    // unlink queued in an exit handler never runs.
    const clean = () => rmSync(work, { recursive: true, force: true })
    process.on("exit", clean)
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => { clean(); process.exit(130) })
    }
  }
  return work
}
