// Mailbox helpers that run in the browser as well as on the server.

export function mailboxDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase() : address.toLowerCase();
}

export function generateMailboxPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/** What may go with a deleted mailbox besides its configuration. */
export const MAILBOX_REMOVAL_OPTIONS = ["messages", "dns"] as const;
export type MailboxRemovalOption = (typeof MAILBOX_REMOVAL_OPTIONS)[number];
