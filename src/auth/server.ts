/**
 * Better Auth for the panel (server-only).
 *
 * The panel has one account, the admin, signing in with email and password at
 * same-origin `/api/auth/*`. Public sign-up is disabled and a database hook
 * refuses any second user, so the only way an account is created is
 * `createAdminUser` (`./admin.server`), used by the installer bootstrap and the
 * first-run form.
 *
 * NEVER import this from client code: it pulls in `pg` and server-only Better
 * Auth internals. The client uses `@/auth/client`; server functions get a
 * verified id via `@/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "@/server/db";
import { userCount } from "./admin.server";
import { CLIENT_IP_HEADER } from "./client-ip";
import { failedSignInLog } from "./failed-sign-in-log";
import { pgliteDialect } from "./pglite-dialect";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/**
 * The installer sets BETTER_AUTH_SECRET. Without it (local dev), use a secret
 * that survives HMR re-evaluation of this module, so dev sessions stay valid
 * until the process restarts.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __schelaAuthDevSecret__?: string;
};
function devAuthSecret(): string {
  globalAuthRef.__schelaAuthDevSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__schelaAuthDevSecret__;
}

const explicitBaseURL = env("BETTER_AUTH_URL");
// Local `npm run dev` (port 8080). Browsers may send Origin as any of these for
// the same server; trusting only `localhost` breaks sign-in with "Invalid origin".
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

/** Public origins this VPS panel is opened at (IP and hostname, http/https). */
function vpsPublicOrigins(): string[] {
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    const v = raw?.trim().replace(/\/+$/, "");
    if (!v) return;
    if (v.startsWith("http://") || v.startsWith("https://")) {
      out.push(v);
      return;
    }
    out.push(`http://${v}`, `https://${v}`);
  };
  add(env("BETTER_AUTH_URL"));
  add(env("SCHELA_PUBLIC_IP"));
  add(env("SCHELA_HOSTNAME"));
  return [...new Set(out)];
}

const vpsOrigins = vpsPublicOrigins();

const extraHosts = [env("SCHELA_PUBLIC_IP"), env("SCHELA_HOSTNAME")].filter((h): h is string =>
  Boolean(h),
);

const baseURL = explicitBaseURL ?? {
  allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...extraHosts],
  protocol: "auto" as const,
  fallback: vpsOrigins[0] ?? "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs. Missing entries surface as
// FORBIDDEN "Invalid origin".
const trustedOrigins: string[] = [
  ...(explicitBaseURL ? [explicitBaseURL.replace(/\/+$/, "")] : []),
  ...LOCAL_DEV_ORIGINS,
  ...vpsOrigins,
];

const databaseUrl = env("DATABASE_URL");

// Real Postgres when `DATABASE_URL` is set, else the panel's embedded PGLite via
// a Kysely dialect, so Better Auth persists to the same DB as panel data.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? devAuthSecret(),
  database,
  trustedOrigins,

  // Cache the session in the short-lived signed `session_data` cookie so reads
  // (incl. the client's `/get-session`) skip the DB.
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // Sign-in only. `disableSignUp` also rejects `auth.api.signUpEmail` called
  // from the server, so the admin is created by `createAdminUser` instead.
  emailAndPassword: { enabled: true, disableSignUp: true },

  // Last line of defence: whatever the code path, never store a second user.
  databaseHooks: {
    user: {
      create: {
        before: async () => ((await userCount()) > 0 ? false : undefined),
      },
    },
  },

  // On a server the panel is reached over HTTPS only (nginx redirects port
  // 80), so cookies are always Secure, whatever BETTER_AUTH_URL says; local dev
  // on http://localhost used these same cookies before. `__Host-` makes the browser
  // refuse a same-named cookie with a `Domain` attribute, so a sibling
  // subdomain cannot plant a session. Better Auth would otherwise use
  // `__Secure-` (which permits Domain), so its prefix is turned off and Secure
  // + the names are set here.
  advanced: {
    // Client address for the rate limiter and session rows: the header nginx
    // overwrites with $remote_addr, never the forgeable X-Forwarded-For.
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: "__Host-schela.session_token" },
      session_data: { name: "__Host-schela.session_data" },
      account_data: { name: "__Host-schela.account_data" },
      dont_remember: { name: "__Host-schela.dont_remember" },
      // twoFactor plugin: the pending sign-in and the trusted-device cookie.
      two_factor: { name: "__Host-schela.two_factor" },
      trust_device: { name: "__Host-schela.trust_device" },
    },
  },

  // Rate limiting: Better Auth's own limiter, on by default when NODE_ENV is
  // production (the schela-panel unit sets it), in memory (one process), keyed
  // per client address (`advanced.ipAddress`). Its built-in limits apply:
  // /sign-in/* 3 requests per 10 s, the twoFactor plugin's /two-factor/* 3 per
  // 10 s, everything else 100 per 10 s.

  plugins: [
    // TOTP with recovery codes, opt-in from Settings. Sign-in with it on stops
    // after the password with no session until a code is verified.
    twoFactor({ issuer: "Schela" }),
    // One stdout line per failed sign-in or two-factor code, for fail2ban.
    failedSignInLog(),
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});
