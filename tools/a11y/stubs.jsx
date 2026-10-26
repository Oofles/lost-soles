// Ticket 0112 — the seams `run-zoom.mjs` swaps out so the real screens render without a session, a
// router or a map. Each stub is the smallest thing its importers need, and nothing it draws stands
// in for a layout under test: the map's place is a flat `--bg` pane, which is what an unpainted map
// is (06 §4.8).
export const usePathname = () => globalThis.__pathname ?? "/"
export const useRouter = () => ({ back() {}, push() {}, replace() {}, refresh() {}, prefetch() {} })
export const useSearchParams = () => new URLSearchParams()
export const redirect = () => {}
export const notFound = () => {}

export const syncNowAction = async () => ({ kind: "none" })

export function MapShell({ paneClassName }) {
  return paneClassName ? (
    <div className={paneClassName} data-testid="map-shell" />
  ) : (
    <div data-testid="map-shell" style={{ position: "relative", height: "55vh", minHeight: "16rem", width: "100%", background: "var(--bg)" }} />
  )
}

// `/settings`, signed in as the owner with one source connected.
export const OWNER_USER_IDS = ["owner"]
export const isOwner = () => true
export const currentUserId = async () => "owner"
export const getSourceAccountSummary = async (_, sourceId) => ({
  sourceId,
  externalOwnerId: "12345678",
  scopes: ["read", "activity:read_all"],
  expiresAt: 0,
  status: "ACTIVE",
  connectedAt: "2026-08-01T00:00:00.000Z",
})
