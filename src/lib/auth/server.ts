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
 * Auth internals. The client uses `@/lib/auth/client`; server functions get a
 * verified id via `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { userCount } from "./admin.server";
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
const vpsMode = env("SCHELA_VPS") === "1" || env("SCHELA_APPLY") === "1";
const explicitHttps = (explicitBaseURL ?? "").startsWith("https:");
// `__Host-` + Secure cookies only work on HTTPS or localhost. A VPS opened at
// http://1.2.3.4 must use a normal cookie or the browser drops the session.
const vpsHttpCookies = vpsMode && !explicitHttps;

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

  // On HTTPS use `__Host-` cookies: the browser refuses a same-named cookie with
  // a `Domain` attribute, so a sibling subdomain cannot plant a session. Better
  // Auth would otherwise use `__Secure-` (which permits Domain), so its prefix
  // is turned off and Secure + the names are set here.
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: vpsHttpCookies
      ? { secure: false, sameSite: "lax", path: "/" }
      : { secure: true, sameSite: "lax", path: "/" },
    cookies: vpsHttpCookies
      ? {
          session_token: { name: "schela.session_token" },
          session_data: { name: "schela.session_data" },
          account_data: { name: "schela.account_data" },
          dont_remember: { name: "schela.dont_remember" },
        }
      : {
          session_token: { name: "__Host-schela.session_token" },
          session_data: { name: "__Host-schela.session_data" },
          account_data: { name: "__Host-schela.account_data" },
          dont_remember: { name: "__Host-schela.dont_remember" },
        },
  },

  plugins: [
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});
