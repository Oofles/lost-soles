import { APP_NAME, APP_TAGLINE } from "@/lib/app-meta"

// Deliberately unstyled. Ticket 0016 owns the app shell, the seven route stubs
// and the design tokens; 0012 only has to prove the thing deploys and renders.
export default function Home() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>{APP_TAGLINE}</p>
    </main>
  )
}
