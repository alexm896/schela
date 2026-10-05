import { getRequest } from "@tanstack/react-start/server";

/**
 * Fetch-Metadata cross-site check: **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` uses Node `AsyncLocalStorage`). Imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * A `SameSite=Lax` session cookie is still sent on same-site subrequests, so a
 * page on another subdomain of the panel's domain could make a scripted
 * (fetch/XHR/form-POST) request to the server functions and ride the admin's
 * session. We allow only same-origin requests (the panel's own client),
 * non-browser requests (SSR, which send no `Sec-Fetch-Site`), and top-level GET
 * navigations. Every cross-site or same-site *scripted* request is rejected.
 * Enforced at the `authMiddleware` chokepoint (see `middleware.ts`).
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  const h = request.headers;
  const site = h.get("sec-fetch-site");
  // Non-browser client (no header), the app's own origin, or a direct
  // (address-bar/bookmark) load are all fine.
  if (!site || site === "same-origin" || site === "none") return;
  // A top-level GET navigation (a link to the panel) is fine even when it's
  // cross-site; scripted requests never set navigate mode.
  const dest = h.get("sec-fetch-dest");
  const isTopLevelGet =
    h.get("sec-fetch-mode") === "navigate" &&
    request.method === "GET" &&
    dest !== "object" &&
    dest !== "embed";
  if (isTopLevelGet) return;
  throw new CrossSiteRequestError();
}
