"use client"

import "@aws-amplify/ui-react/styles.css"

import { Amplify } from "aws-amplify"
import { Authenticator } from "@aws-amplify/ui-react"
import type { ReactNode } from "react"

import outputs from "@/amplify_outputs.json"

/**
 * The auth gate (ticket 0014). Everything inside it requires a signed-in user.
 *
 * `hideSignUp` is the VISIBLE face of `allowAdminCreateUserOnly: true` in
 * ../amplify/backend.ts. The pool refuses public registration regardless of what
 * the UI renders — this only stops the component advertising a door that is
 * already locked. Do not read it as the control; the control is server-side, and
 * `scripts/check-auth-posture.mjs` is what proves it on every deploy.
 *
 * Accounts are created by the operator (`admin-create-user`, 08-security-privacy
 * §5.4). There is no invite feature, no signup page and no "add a friend" button,
 * and adding one is gated by §2.4 Trigger A — which is a seven-item checklist,
 * not a UI change.
 *
 * `ssr: true` lets the server components read the session; §5.3 requires every
 * server route to re-derive `sub` from the verified JWT and NEVER to take a uid
 * from a request body, query string or header.
 */
Amplify.configure(outputs, { ssr: true })

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <Authenticator hideSignUp loginMechanisms={["email"]}>
      {children}
    </Authenticator>
  )
}
