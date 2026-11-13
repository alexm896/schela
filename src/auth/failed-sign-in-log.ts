import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { clientIp, failedSignInLine } from "./client-ip";

/**
 * Endpoints whose refusal is a failed sign-in: the password step and every
 * second-factor check (the two-factor plugin's routes, see
 * better-auth/dist/plugins/two-factor).
 */
export const SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);

/**
 * Writes one `schela-auth: failed sign-in from <ip>` line to stdout each time
 * one of `SIGN_IN_PATHS` answers with an error. Requests the rate limiter
 * refuses never reach the endpoint, so they are not logged.
 */
export const failedSignInLog = () =>
  ({
    id: "schela-failed-sign-in-log",
    hooks: {
      after: [
        {
          matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            if (!isAPIError(ctx.context.returned)) return;
            console.log(failedSignInLine(clientIp(ctx.request?.headers ?? ctx.headers)));
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
