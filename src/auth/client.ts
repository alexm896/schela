import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the panel (browser-side). Talks to the panel's own
 * Better Auth at same-origin `/api/auth/*`; the session is an HttpOnly cookie.
 */
export const authClient = createAuthClient();

/**
 * Sign out, then go to `redirectTo`. Rejects when the server does not confirm:
 * only the server can clear the HttpOnly session cookie, so redirecting anyway
 * would report a sign-out that did not happen.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  window.location.href = redirectTo;
}
