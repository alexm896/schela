import { getSql } from "../db";

/**
 * Schela has exactly one account: the panel admin. Nothing over HTTP can create
 * users (sign-up is disabled in `server.ts`); the admin is created here, either
 * from the installer's bootstrap credentials or by the first-run form while no
 * user exists yet.
 *
 * Server-only. Do not import `./server` statically from this file: `server.ts`
 * imports `userCount` from here for its create hook.
 */

export async function userCount(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`select count(*)::int as n from "user"`;
  return rows[0]?.n ?? 0;
}

const globalRef = globalThis as typeof globalThis & {
  __schelaAdminLock__?: Promise<unknown>;
  __schelaAdminId__?: string;
};

/** Run `fn` with no other admin creation in flight (one panel process). */
function withAdminLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (globalRef.__schelaAdminLock__ ?? Promise.resolve()).then(fn, fn);
  globalRef.__schelaAdminLock__ = run.catch(() => undefined);
  return run;
}

/** Thrown when the admin cannot be created from the given input. */
export class AdminInputError extends Error {}

/**
 * Create the admin account. Returns false, creating nothing, when a user
 * already exists. Serialized, so two concurrent first-run requests cannot both
 * create an account.
 */
export function createAdminUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<boolean> {
  return withAdminLock(async () => {
    if ((await userCount()) > 0) return false;
    const { auth } = await import("./server");
    const ctx = await auth.$context;
    const { minPasswordLength, maxPasswordLength } = ctx.password.config;
    if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
      throw new AdminInputError(
        `Password must be ${minPasswordLength} to ${maxPasswordLength} characters`,
      );
    }
    const hash = await ctx.password.hash(input.password);
    const user = await ctx.internalAdapter.createUser({
      email: input.email.toLowerCase(),
      name: input.name,
      emailVerified: false,
    });
    if (!user) throw new Error("Could not create the admin account");
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    return true;
  });
}

/**
 * The admin's user id: the first account created. Only this account may use
 * the panel, so accounts that were registered before sign-up was disabled
 * cannot sign in.
 */
export async function adminUserId(): Promise<string | null> {
  if (globalRef.__schelaAdminId__) return globalRef.__schelaAdminId__;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from "user" order by "createdAt" asc, id asc limit 1
  `;
  const id = rows[0]?.id ?? null;
  if (!id) return null;
  globalRef.__schelaAdminId__ = id;
  const extra = (await userCount()) - 1;
  if (extra > 0) {
    console.warn(
      `[schela] ${extra} account(s) besides the admin exist in the "user" table. ` +
        "They cannot sign in to the panel. Review and delete them.",
    );
  }
  return id;
}
