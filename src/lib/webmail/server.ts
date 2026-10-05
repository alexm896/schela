import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { verifyMailboxPassword } from "@/lib/panel/mail-pass";
import { demoStore } from "./demo";
import { withImap, type MailBody, type MailListItem } from "./imap";
import { sanitizeHtml, textToHtml } from "./sanitize";
import { parseAddressList } from "./rfc822";
import { assertImapFolder, assertMailAddress } from "./safe.ts";
import {
  clearWebmailSession,
  readWebmailSession,
  writeWebmailSession,
} from "./session";
import { buildMessage, sendSmtp } from "./smtp";

const IMAP_HOST = "127.0.0.1";
const IMAP_PORT = 143;
const SMTP_HOST = "127.0.0.1";
const SMTP_PORT = 25;

const attempts = new Map<string, { n: number; reset: number }>();

function rateKey(addr: string): string {
  return addr.toLowerCase();
}

async function hitLogin(addr: string): Promise<void> {
  let ip = "local";
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    ip =
      req?.headers.get("x-real-ip") ||
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "local";
  } catch {
    /* no request */
  }
  const k = `${rateKey(addr)}|${ip}`;
  const now = Date.now();
  const cur = attempts.get(k);
  if (!cur || now > cur.reset) {
    attempts.set(k, { n: 1, reset: now + 15 * 60_000 });
    return;
  }
  cur.n += 1;
  if (cur.n > 8) throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
}

async function sameSite() {
  const { assertSameSiteRequest } = await import("@/auth/isolation.server");
  assertSameSiteRequest();
}

async function requireBox(address: string, password: string) {
  const sql = await getSql();
  const rows = await sql<{
    address: string;
    status: string;
    password_hash: string;
  }>`
    select address, status, password_hash from mailboxes where address = ${address}
  `;
  const row = rows[0];
  if (!row || row.status === "disabled") throw new Error("Unknown mailbox or wrong password");
  if (!verifyMailboxPassword(password, row.password_hash || "")) {
    throw new Error("Unknown mailbox or wrong password");
  }
}

async function sessionOrThrow() {
  const s = await readWebmailSession();
  if (!s) throw new Error("Not signed in");
  return s;
}

function vps(): boolean {
  return isVpsApply();
}

export const webmailWhoami = createServerFn({ method: "GET" }).handler(async () => {
  await sameSite();
  const s = await readWebmailSession();
  return s ? { address: s.addr } : null;
});

export const webmailLogin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      address: z.string().min(3).max(120),
      password: z.string().min(8).max(128),
    }),
  )
  .handler(async ({ data }) => {
    await sameSite();
    const address = assertMailAddress(data.address);
    await hitLogin(address);
    await requireBox(address, data.password);
    if (vps()) {
      try {
        await withImap(IMAP_HOST, IMAP_PORT, address, data.password, async (c) => {
          await c.ensureFolder("Sent");
          await c.ensureFolder("Trash");
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "mail server error";
        throw new Error(
          `Mailbox password matches, but the mail server refused the login (${detail}).`,
        );
      }
    }
    await writeWebmailSession({ addr: address, pw: data.password });
    return { address };
  });

export const webmailLogout = createServerFn({ method: "POST" }).handler(async () => {
  await sameSite();
  await clearWebmailSession();
  return { ok: true as const };
});

export const webmailFolders = createServerFn({ method: "GET" }).handler(async () => {
  await sameSite();
  const s = await sessionOrThrow();
  if (!vps()) return demoStore.folders(s.addr);
  return withImap(IMAP_HOST, IMAP_PORT, s.addr, s.pw, (c) => c.listFolders());
});

export const webmailList = createServerFn({ method: "GET" })
  .validator(z.object({ folder: z.string().min(1).max(80).default("INBOX") }))
  .handler(async ({ data }): Promise<MailListItem[]> => {
    await sameSite();
    const s = await sessionOrThrow();
    const folder = assertImapFolder(data.folder || "INBOX");
    if (!vps()) return demoStore.list(s.addr, folder);
    return withImap(IMAP_HOST, IMAP_PORT, s.addr, s.pw, async (c) => {
      await c.select(folder);
      return c.listMessages();
    });
  });

export const webmailRead = createServerFn({ method: "GET" })
  .validator(
    z.object({
      folder: z.string().min(1).max(80),
      uid: z.number().int().positive(),
      images: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await sameSite();
    const s = await sessionOrThrow();
    const folder = assertImapFolder(data.folder);
    let body: MailBody | null;
    if (!vps()) {
      body = demoStore.get(s.addr, folder, data.uid);
      if (body) demoStore.markSeen(s.addr, folder, data.uid);
    } else {
      body = await withImap(IMAP_HOST, IMAP_PORT, s.addr, s.pw, async (c) => {
        await c.select(folder);
        const msg = await c.fetch(data.uid);
        await c.markSeen(data.uid).catch(() => {});
        return msg;
      });
    }
    if (!body) throw new Error("Message not found");
    const inner = body.html
      ? sanitizeHtml(body.html, Boolean(data.images))
      : textToHtml(body.text || "");
    const imgSrc = data.images ? "img-src data: https: http:;" : "img-src data:;";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body>${inner}</body></html>`;
    return {
      uid: body.uid,
      from: body.from,
      to: body.to,
      subject: body.subject,
      date: body.date,
      flags: body.flags,
      size: body.size,
      text: body.text,
      html,
    };
  });

export const webmailDelete = createServerFn({ method: "POST" })
  .validator(
    z.object({
      folder: z.string().min(1).max(80),
      uid: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    await sameSite();
    const s = await sessionOrThrow();
    const folder = assertImapFolder(data.folder);
    if (!vps()) {
      demoStore.delete(s.addr, folder, data.uid);
      return { ok: true as const };
    }
    await withImap(IMAP_HOST, IMAP_PORT, s.addr, s.pw, async (c) => {
      await c.select(folder);
      await c.deleteUid(data.uid);
    });
    return { ok: true as const };
  });

export const webmailSend = createServerFn({ method: "POST" })
  .validator(
    z.object({
      to: z.string().min(3).max(800),
      cc: z.string().max(800).optional(),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(200_000),
    }),
  )
  .handler(async ({ data }) => {
    await sameSite();
    const s = await sessionOrThrow();
    const to = parseAddressList(data.to);
    const cc = parseAddressList(data.cc || "");
    if (to.length === 0) throw new Error("Enter at least one To address");
    const raw = buildMessage({
      from: s.addr,
      to,
      cc,
      subject: data.subject,
      text: data.text,
    });
    if (!vps()) {
      demoStore.send(s.addr, [...to, ...cc], data.subject, data.text);
      return { ok: true as const };
    }
    await sendSmtp({
      host: SMTP_HOST,
      port: SMTP_PORT,
      from: s.addr,
      to: [...to, ...cc],
      data: raw,
    });
    await withImap(IMAP_HOST, IMAP_PORT, s.addr, s.pw, async (c) => {
      await c.ensureFolder("Sent");
      await c.append("Sent", raw);
    }).catch(() => {});
    return { ok: true as const };
  });
