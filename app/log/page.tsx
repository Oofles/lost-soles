import { LogPage } from "./log-page"

// §6, D-061 verbatim: an "Add workout" BUTTON, not per-exercise buttons, opening a
// DEDICATED PAGE. Exists because no API on earth exposes reps (D-060).
//
// STATIC ON PURPOSE (D-282). This file reads no session and no data, so Next prerenders it and
// `/`'s "Add workout" link prefetches all of it. That is what lets `/log` render with the network
// off: the rows come from the bundled registry and the standing from IndexedDB, both inside
// `LogPage`. Reading the session here would make the route dynamic and put the network back on
// the critical path (§6.2: "Nothing waits on the network").
export default function Log() {
  return <LogPage />
}
