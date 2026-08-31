import { defineAuth } from "@aws-amplify/backend"

/**
 * SKELETON ONLY. Ticket 0014 configures this properly:
 * email sign-in, self-signup OFF, unauthenticated identities OFF
 * (01-architecture.md §1; 08-security-privacy.md §5.1).
 *
 * It exists now so that later capabilities EXTEND an auth resource rather than
 * introduce one — introducing `defineAuth` later would replace the user pool and
 * take every account with it.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
})
