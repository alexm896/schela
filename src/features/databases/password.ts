import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt } from "node:crypto";
import type { DatabaseEngine } from "./databases";

// Server only. The panel generates every database password, shows it once and
// keeps only the hash the engine itself stores, so state.json never holds a
// usable password.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const DATABASE_PASSWORD_LENGTH = 24;

const SCRAM_ITERATIONS = 4096;

export const DATABASE_HASH_PATTERNS: Record<DatabaseEngine, RegExp> = {
  mariadb: /^\*[0-9A-F]{40}$/,
  postgresql: /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/,
};

/** 24 letters and digits (about 142 bits); safe in URLs, .env files and shells. */
export function generateDatabasePassword(length = DATABASE_PASSWORD_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** mysql_native_password: "*" + uppercase hex of SHA1(SHA1(password)). */
export function mariadbPasswordHash(password: string): string {
  const inner = createHash("sha1").update(password, "utf8").digest();
  return `*${createHash("sha1").update(inner).digest("hex").toUpperCase()}`;
}

/**
 * PostgreSQL SCRAM-SHA-256 verifier (RFC 5802 / RFC 7677), the same string
 * `password_encryption = scram-sha-256` stores. Generated passwords are ASCII,
 * so SASLprep normalisation is a no-op.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export function databasePasswordHash(engine: DatabaseEngine, password: string): string {
  return engine === "mariadb" ? mariadbPasswordHash(password) : scramSha256Verifier(password);
}
