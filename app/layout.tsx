import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AuthGate } from "@/components/auth-gate"
import { APP_NAME, APP_TAGLINE } from "@/lib/app-meta"

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
        The gate wraps the whole tree, so there is no route that renders without a
        session — ticket 0014's "an unauthenticated visitor cannot reach any app
        route". Today that is only `/`; ticket 0016 adds the seven route stubs and
        they inherit this by construction rather than each remembering to opt in.
      */}
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  )
}
