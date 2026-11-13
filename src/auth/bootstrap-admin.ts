import { adminUserId, createAdminUser, userCount } from "@/auth/admin.server";
import { DEFAULT_ADMIN_EMAIL, toAuthEmail } from "./admin-id";

type BootstrapFile = { email: string; password: string; name?: string };

// The installer and `schela reset-admin-password` leave their requests here.
// SCHELA_ADMIN_DIR moves them for tests.
function adminDir(): string {
  return process.env.SCHELA_ADMIN_DIR?.trim() || "/var/lib/schela";
}
const bootstrapFile = () => `${adminDir()}/bootstrap-admin.json`;
const adminEnvFile = () => `${adminDir()}/admin.env`;
const resetFile = () => `${adminDir()}/admin-reset.json`;

async function readBootstrap(): Promise<BootstrapFile | null> {
  const email = toAuthEmail(process.env.SCHELA_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL);
  const password = process.env.SCHELA_ADMIN_PASSWORD?.trim();
  if (email && password) {
    return { email, password, name: "Admin" };
  }
  if (typeof window !== "undefined") return null;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(bootstrapFile(), "utf8");
    const parsed = JSON.parse(raw) as BootstrapFile;
    if (parsed.password) {
      return {
        email: toAuthEmail(parsed.email || DEFAULT_ADMIN_EMAIL),
        password: parsed.password,
        name: parsed.name || "Admin",
      };
    }
  } catch {
    /* no file */
  }
  return null;
}

async function dropFile(path: string) {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(path);
  } catch {
    /* already gone */
  }
}

async function stripAdminPasswordFromEnv() {
  try {
    const fs = await import("node:fs/promises");
    const path = adminEnvFile();
    const raw = await fs.readFile(path, "utf8");
    const lines = raw.split("\n");
    const next = lines.filter((line) => !line.startsWith("SCHELA_ADMIN_PASSWORD="));
    if (next.length === lines.length) return;
    await fs.writeFile(path, next.join("\n"), { mode: 0o600 });
  } catch {
    /* optional */
  }
}

/** Set the admin's password through Better Auth's own hashing and account store. */
async function setAdminPassword(password: string): Promise<void> {
  const userId = await adminUserId();
  if (!userId) {
    await createAdminUser({ email: DEFAULT_ADMIN_EMAIL, password, name: "Admin" });
    return;
  }
  const { auth } = await import("./server");
  const ctx = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    throw new Error(`Password must be ${minPasswordLength} to ${maxPasswordLength} characters`);
  }
  const hash = await ctx.password.hash(password);
  // Not updatePassword(): it matches accountId = userId, and renaming the admin
  // (updateAdminIdentity) sets accountId to the email. Sign-in only accepts a
  // credential account whose accountId is the user id, so it is set back too.
  const account = (await ctx.internalAdapter.findAccounts(userId)).find(
    (a) => a.providerId === "credential",
  );
  if (account) {
    await ctx.internalAdapter.updateAccount(account.id, { password: hash, accountId: userId });
  } else {
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hash,
    });
  }
}

/**
 * `schela reset-admin-password` (root) writes admin-reset.json and requests a
 * page. The new password is set here and the file deleted; on failure the
 * file stays and the command reports that the panel did not take it.
 */
async function applyAdminPasswordReset(): Promise<void> {
  let password: string;
  try {
    const fs = await import("node:fs/promises");
    const parsed = JSON.parse(await fs.readFile(resetFile(), "utf8")) as { password?: unknown };
    if (typeof parsed.password !== "string" || !parsed.password) return;
    password = parsed.password;
  } catch {
    return;
  }
  try {
    await setAdminPassword(password);
  } catch (err) {
    console.error("[schela] admin password reset:", err);
    return;
  }
  await dropFile(resetFile());
  await dropFile(bootstrapFile());
}

/** Create the first admin from installer env/file. No-op if a user exists. */
export async function bootstrapAdminIfNeeded(): Promise<void> {
  if (typeof window !== "undefined") return;
  await applyAdminPasswordReset();
  if ((await userCount()) > 0) {
    // Nothing to create: the installer's password must not linger anywhere.
    await dropFile(bootstrapFile());
    await stripAdminPasswordFromEnv();
    return;
  }
  const boot = await readBootstrap();
  if (!boot) return;
  try {
    await createAdminUser({
      email: boot.email,
      password: boot.password,
      name: boot.name || "Admin",
    });
  } catch (err) {
    console.error("[schela] admin bootstrap:", err);
  }
  // Keep the credentials around for the next attempt if creation failed.
  if ((await userCount()) === 0) return;
  await dropFile(bootstrapFile());
  await stripAdminPasswordFromEnv();
}

export async function hasAdminUser(): Promise<boolean> {
  await bootstrapAdminIfNeeded();
  return (await userCount()) > 0;
}

/**
 * First-run form: create the admin when the installer left no credentials and
 * no account exists. Returns false when an admin already exists (including one
 * just created from the installer's credentials).
 */
export async function createFirstAdmin(username: string, password: string): Promise<boolean> {
  await bootstrapAdminIfNeeded();
  return createAdminUser({ email: toAuthEmail(username), password, name: "Admin" });
}
