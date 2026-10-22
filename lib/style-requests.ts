/**
 * WHAT A MAPLIBRE STYLE WILL FETCH, AND FROM WHERE. Ticket `0293`; built to be `0113`'s base.
 *
 * `06-ui-ux.md` §9.5: no third-party request at runtime. A style is the one place in the app where
 * request URLs are DATA rather than code, so a grep for `fetch(` cannot see them — a style can name
 * a font host, a sprite host or a tile host and the browser will dutifully call it. This module
 * lists every URL a style makes MapLibre request, so a test can hold the list to an allowlist of
 * first-party origins.
 *
 * ONLY REQUEST-BEARING FIELDS, never every string. `sources.*.attribution` carries `<a href>` links
 * to protomaps.com and openstreetmap.org, which ODbL obliges us to show and the browser never
 * fetches. A deep scan of every string would flag those and teach the next reader to allowlist them,
 * which is exactly how a real third-party request would later slip through.
 */

/** The style fields this reads. Structural, so any style object (ours or a fixture) fits. */
export interface StyleWithRequests {
  glyphs?: unknown
  sprite?: unknown
  sources?: Record<string, unknown>
}

/** A request URL with a scheme wrapper removed: `pmtiles://https://x/a.pmtiles` → `https://x/a.pmtiles`. */
function unwrap(url: string): string {
  return url.replace(/^pmtiles:\/\//, "")
}

/**
 * Every URL the style makes MapLibre fetch: `glyphs`, `sprite` (a string or MapLibre's array of
 * `{ id, url }`), and each source's `url`, `tiles[]`, `urls[]` (video) and a string `data`
 * (GeoJSON by URL). Templates such as `{fontstack}` are left in; they do not affect the host.
 */
export function styleRequestUrls(style: StyleWithRequests): string[] {
  const out: string[] = []
  const add = (v: unknown) => {
    if (typeof v === "string" && v !== "") out.push(unwrap(v))
  }
  add(style.glyphs)
  if (Array.isArray(style.sprite)) {
    for (const s of style.sprite) add((s as { url?: unknown })?.url)
  } else add(style.sprite)
  for (const source of Object.values(style.sources ?? {})) {
    const s = source as { url?: unknown; tiles?: unknown; urls?: unknown; data?: unknown }
    add(s.url)
    if (Array.isArray(s.tiles)) s.tiles.forEach(add)
    if (Array.isArray(s.urls)) s.urls.forEach(add)
    add(s.data)
  }
  return out
}

/**
 * The hosts a style would call that are not in `firstParty`, deduplicated. Empty means clean.
 *
 * `firstParty` is a list of origins or base URLs (`https://soles.example`,
 * `https://d123.cloudfront.net`); only their host is compared. A URL without a scheme
 * (`/basemap-assets/…`) resolves against the page, which IS the app's origin, so it is first-party
 * by construction. A `data:` or `blob:` URL is never a network request.
 */
export function thirdPartyRequestHosts(style: StyleWithRequests, firstParty: readonly string[]): string[] {
  const allowed = new Set(firstParty.map((o) => new URL(o).host))
  const hosts = new Set<string>()
  for (const raw of styleRequestUrls(style)) {
    // Protocol-relative `//host/x` names a host without a scheme; it is not page-relative.
    const url = raw.startsWith("//") ? `https:${raw}` : raw
    if (/^(data|blob):/.test(url)) continue
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) continue
    const host = new URL(url).host
    if (!allowed.has(host)) hosts.add(host)
  }
  return [...hosts]
}
