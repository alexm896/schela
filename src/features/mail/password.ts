import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const MIN = 8;
const MAX = 128;

export function assertMailboxPassword(password: string): string {
  if (typeof password !== "string") throw new Error("Password required");
  if (password.length < MIN) throw new Error("Password must be at least 8 characters");
  if (password.length > MAX) throw new Error("Password is too long");
  if (/\s/.test(password)) throw new Error("Password cannot contain spaces");
  return password;
}

/** Dovecot `{SSHA512}` — SHA-512(password + salt) then salt, Base64. */
export function hashMailboxPassword(password: string): string {
  const plain = assertMailboxPassword(password);
  const salt = randomBytes(8);
  const digest = createHash("sha512").update(plain, "utf8").update(salt).digest();
  return `{SSHA512}${Buffer.concat([digest, salt]).toString("base64")}`;
}

export function verifyMailboxPassword(password: string, stored: string): boolean {
  if (!stored.startsWith("{SSHA512}")) return false;
  const raw = Buffer.from(stored.slice("{SSHA512}".length), "base64");
  if (raw.length <= 64) return false;
  const digest = raw.subarray(0, 64);
  const salt = raw.subarray(64);
  const check = createHash("sha512").update(password, "utf8").update(salt).digest();
  if (digest.length !== check.length) return false;
  return timingSafeEqual(digest, check);
}


