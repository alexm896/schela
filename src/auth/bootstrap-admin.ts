import { createAdminUser, userCount } from "@/auth/admin.server";
import { DEFAULT_ADMIN_EMAIL, toAuthEmail } from "./admin-id";

type BootstrapFile = { email: string; password: string; name?: string };

const BOOTSTRAP_FILE = "/var/lib/schela/bootstrap-admin.json";

async function readBootstrap(): Promise<BootstrapFile | null> {
  const email = toAuthEmail(process.env.SCHELA_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL);
  const password = process.env.SCHELA_ADMIN_PASSWORD?.trim();
  if (email && password) {
    return { email, password, name: "Admin" };
  }
  if (typeof window !== "undefined") return null;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(BOOTSTRAP_FILE, "utf8");
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

async function dropBootstrapFile() {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(BOOTSTRAP_FILE);
  } catch {
    /* already gone */
  }
}

async function stripAdminPasswordFromEnv() {
  try {
    const fs = await import("node:fs/promises");
    const path = "/var/lib/schela/admin.env";
    const raw = await fs.readFile(path, "utf8");
    const next = raw
      .split("\n")
      .filter((line) => !line.startsWith("SCHELA_ADMIN_PASSWORD="))
      .join("\n");
    await fs.writeFile(path, next, { mode: 0o600 });
  } catch {
    /* optional */
  }
}

/** Create the first admin from installer env/file. No-op if a user exists. */
export async function bootstrapAdminIfNeeded(): Promise<void> {
  if (typeof window !== "undefined") return;
  if ((await userCount()) > 0) {
    await dropBootstrapFile();
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
  await dropBootstrapFile();
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
