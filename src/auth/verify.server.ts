import { getRequest } from "@tanstack/react-start/server";
import { adminUserId } from "./admin.server";
import { auth } from "./server";

/**
 * Server-side session resolution (server-only).
 *
 * Better Auth runs at same-origin `/api/auth/*`, so the session cookie rides
 * along with every server function call and SSR loader. Never trust a
 * client-supplied user id, only the result of this verification.
 */

/**
 * Thrown by `requireUserId` when the caller has no valid admin session. Carries
 * `status: 401`; the message is a stable contract: match
 * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null };

/**
 * The signed-in admin for the current request, or `null` when nobody is
 * signed in or the session belongs to any account other than the admin.
 */
export async function getSessionUser(): Promise<VerifiedUser | null> {
  const request = getRequest();
  if (!request) return null;
  // Skip the signed `session_data` cookie cache: it would keep a signed-out or
  // revoked session working for up to its maxAge. Check the session row.
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session?.user) return null;
  if (session.user.id !== (await adminUserId())) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

/** The admin's user id, or throw `UnauthorizedError`. Prefer `authMiddleware`. */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}
