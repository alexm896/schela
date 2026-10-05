import { createMiddleware } from "@tanstack/react-start";

/**
 * Auth middleware for server functions: the standard way to get the caller's
 * verified user id.
 *
 *   export const listSites = createServerFn({ method: "GET" })
 *     .middleware([authMiddleware])
 *     .handler(async ({ context }) => { ... context.userId ... });
 *
 * Throws `UnauthorizedError` unless the caller holds the admin's session (see
 * `verify.server.ts`). Every panel server function must use it, except the few
 * public ones listed in `src/lib/server-fn-auth.test.ts`.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // ONLY import `*.server` modules here, so Vite does not ship
  // `@tanstack/react-start/server` to the browser.
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  // Reject scripted cross-site requests before touching panel data.
  assertSameSiteRequest();
  const userId = await requireUserId();
  return next({ context: { userId } });
});
