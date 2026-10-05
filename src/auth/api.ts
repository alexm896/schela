import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/server/db";
import { displayUsername, toAuthEmail } from "./admin-id";
import { createFirstAdmin as createFirstAdminUser, hasAdminUser } from "./bootstrap-admin";
import { authMiddleware } from "./middleware";

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { hasAdmin: await hasAdminUser() };
});

const firstAdminSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128),
});

/** First-run form: creates the admin only while no account exists. */
export const createFirstAdmin = createServerFn({ method: "POST" })
  .validator(firstAdminSchema)
  .handler(async ({ data }) => {
    if (!z.email().safeParse(toAuthEmail(data.username)).success) {
      throw new Error("Use letters, numbers, dots or dashes for the username");
    }
    if (!(await createFirstAdminUser(data.username, data.password))) {
      throw new Error("An admin account already exists. Sign in instead.");
    }
    return { ok: true };
  });

export const sessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("./verify.server");
  const user = await getSessionUser();
  return user ? { id: user.id, email: user.email } : null;
});

export const getAdminIdentity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ email: string }>`
      select email from "user" where id = ${context.userId}
    `;
    const email = rows[0]?.email ?? "admin@schela.local";
    return { username: displayUsername(email), email };
  });

export const updateAdminIdentity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ username: z.string().min(1).max(120) }))
  .handler(async ({ data, context }) => {
    const email = toAuthEmail(data.username);
    const name = displayUsername(email);
    const sql = await getSql();
    await sql`
      update "user" set email = ${email}, name = ${name} where id = ${context.userId}
    `;
    await sql`
      update "account"
      set "accountId" = ${email}
      where "userId" = ${context.userId} and "providerId" = 'credential'
    `;
    return { username: name, email };
  });
