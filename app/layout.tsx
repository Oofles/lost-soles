import "./tokens.css"

import type { Metadata } from "next"
import localFont from "next/font/local"
import type { ReactNode } from "react"

import { AuthGate } from "@/components/auth-gate"
import { LogQueueRunner } from "@/components/log-queue-runner"
import { APP_NAME, APP_TAGLINE } from "@/lib/app-meta"

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
}

/**
 * THE TWO FAMILIES, SELF-HOSTED. Ticket 0255, `06-ui-ux.md` §8.4.
 *
 * The files are committed under `app/fonts/` (Latin subsets from Fontsource, OFL — the licences sit
 * beside them) and next/font serves them from `/_next/static/media/` on this origin, so a page load
 * asks no font CDN for anything (§4.8). Only the cuts §8.4 uses ship: Spectral 600 and 400 italic,
 * Inter 400/500/600. Each sets a CSS variable on `<html>`; `tokens.css` turns those into
 * `--font-serif` and `--font-sans`, and components use only the tokens.
 */
const spectral = localFont({
  src: [
    { path: "./fonts/spectral-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/spectral-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-spectral",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
})

const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "Arial", "sans-serif"],
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spectral.variable} ${inter.variable}`}>
      {/*
        The gate wraps the whole tree, so there is no route that renders without a
        session — ticket 0014's "an unauthenticated visitor cannot reach any app
        route". Today that is only `/`; ticket 0016 adds the seven route stubs and
        they inherit this by construction rather than each remembering to opt in.
      */}
      <body>
        <AuthGate>
          {/* Flushes `/log`'s queue on every route, not only `/log` (ticket 0068, D-282). */}
          <LogQueueRunner />
          {children}
        </AuthGate>
      </body>
    </html>
  )
}
