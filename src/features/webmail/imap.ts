import net from "node:net";
import { extractBodies, parseHeaders, splitHeaderBody } from "./rfc822";
import { quoteImap } from "./safe.ts";

export type MailListItem = {
  uid: number;
  flags: string[];
  size: number;
  from: string;
  to: string;
  subject: string;
  date: string;
};

export type MailBody = MailListItem & {
  text: string;
  html: string;
  rawHeaders: string;
};

const TIMEOUT_MS = 20_000;
const MAX_FETCH = 80;
const MAX_BODY = 512 * 1024;

export class ImapClient {
  private sock!: net.Socket;
  private buf = "";
  private n = 0;
  private waiters: Array<(line: string) => void> = [];

  static async connect(host: string, port: number): Promise<ImapClient> {
    const c = new ImapClient();
    await c.open(host, port);
    return c;
  }

  private open(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("IMAP connect timed out"));
      }, TIMEOUT_MS);
      sock.setEncoding("utf8");
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on("data", (chunk: string) => {
        this.buf += chunk;
        this.drain();
      });
      sock.once("connect", () => {
        this.sock = sock;
      });
      this.waitLine()
        .then((greet) => {
          clearTimeout(timer);
          if (!greet.startsWith("* OK")) reject(new Error("IMAP greeting failed"));
          else resolve();
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  private drain() {
    while (this.waiters.length) {
      const nl = this.buf.indexOf("\r\n");
      if (nl < 0) return;
      const lit = /\{(\d+)\}\r\n$/.exec(this.buf.slice(0, nl + 2));
      if (lit) {
        const size = Number(lit[1]);
        const start = nl + 2;
        if (this.buf.length < start + size + 2) return;
        // Keep literal inline; next drain will consume the completed line after.
      }
      const lineEnd = this.consumeLine();
      if (lineEnd == null) return;
      const waiter = this.waiters.shift();
      waiter?.(lineEnd);
    }
  }

  private consumeLine(): string | null {
    const nl = this.buf.indexOf("\r\n");
    if (nl < 0) return null;
    const head = this.buf.slice(0, nl);
    const lit = /\{(\d+)\}$/.exec(head);
    if (!lit) {
      this.buf = this.buf.slice(nl + 2);
      return head;
    }
    const size = Number(lit[1]);
    const start = nl + 2;
    if (this.buf.length < start + size) return null;
    const literal = this.buf.slice(start, start + size);
    this.buf = this.buf.slice(start + size);
    if (this.buf.startsWith("\r\n")) this.buf = this.buf.slice(2);
    return `${head}\n${literal}`;
  }

  private waitLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IMAP timed out")), TIMEOUT_MS);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
      this.drain();
    });
  }

  private async command(cmd: string): Promise<string[]> {
    this.n += 1;
    const tag = `A${this.n}`;
    this.sock.write(`${tag} ${cmd}\r\n`);
    const lines: string[] = [];
    for (;;) {
      const line = await this.waitLine();
      lines.push(line);
      if (line.startsWith(`${tag} `)) {
        if (!line.startsWith(`${tag} OK`)) {
          throw new Error(line.slice(tag.length + 1) || "IMAP command failed");
        }
        return lines;
      }
    }
  }

  async login(user: string, pass: string): Promise<void> {
    await this.command(`LOGIN ${quoteImap(user)} ${quoteImap(pass)}`);
  }

  async listFolders(): Promise<string[]> {
    const lines = await this.command(`LIST ${quoteImap("")} ${quoteImap("*")}`);
    const names: string[] = [];
    for (const line of lines) {
      const m = /\* LIST \([^)]*\) ".*" (.+)$/.exec(line);
      if (!m) continue;
      let name = m[1].trim();
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
      names.push(name);
    }
    return names.length ? names : ["INBOX"];
  }

  async ensureFolder(name: string): Promise<void> {
    try {
      await this.command(`CREATE ${quoteImap(name)}`);
    } catch {
      /* exists */
    }
  }

  async select(mailbox: string): Promise<void> {
    await this.command(`SELECT ${quoteImap(mailbox)}`);
  }

  async listMessages(): Promise<MailListItem[]> {
    const search = await this.command("UID SEARCH ALL");
    const ids: number[] = [];
    for (const line of search) {
      if (!line.startsWith("* SEARCH")) continue;
      for (const p of line.slice(8).trim().split(/\s+/)) {
        const n = Number(p);
        if (n > 0) ids.push(n);
      }
    }
    const slice = ids.slice(-MAX_FETCH);
    if (slice.length === 0) return [];
    const set = `${slice[0]}:${slice[slice.length - 1]}`;
    const lines = await this.command(
      `UID FETCH ${set} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE)])`,
    );
    const items: MailListItem[] = [];
    for (const line of lines) {
      if (!line.startsWith("* ")) continue;
      const uid = Number(/\bUID (\d+)/.exec(line)?.[1] || 0);
      if (!uid) continue;
      const size = Number(/\bRFC822\.SIZE (\d+)/.exec(line)?.[1] || 0);
      const flagsRaw = /\bFLAGS \(([^)]*)\)/.exec(line)?.[1] || "";
      const flags = flagsRaw.split(/\s+/).filter(Boolean);
      const headerBlock = line.includes("\n") ? line.slice(line.indexOf("\n") + 1) : "";
      const h = parseHeaders(headerBlock);
      items.push({
        uid,
        flags,
        size,
        from: h.from || "",
        to: h.to || "",
        subject: h.subject || "(no subject)",
        date: h.date || "",
      });
    }
    items.sort((a, b) => b.uid - a.uid);
    return items;
  }

  async fetch(uid: number): Promise<MailBody> {
    const lines = await this.command(
      `UID FETCH ${uid} (UID FLAGS RFC822.SIZE BODY.PEEK[]<0.${MAX_BODY}>)`,
    );
    let flags: string[] = [];
    let size = 0;
    let raw = "";
    for (const line of lines) {
      if (!line.startsWith("* ")) continue;
      flags = (/\bFLAGS \(([^)]*)\)/.exec(line)?.[1] || "").split(/\s+/).filter(Boolean);
      size = Number(/\bRFC822\.SIZE (\d+)/.exec(line)?.[1] || 0);
      const nl = line.indexOf("\n");
      if (nl >= 0) raw = line.slice(nl + 1);
    }
    const { headers } = splitHeaderBody(raw.replace(/\r\n/g, "\n"));
    const h = parseHeaders(headers);
    const bodies = extractBodies(raw.replace(/\r\n/g, "\n"));
    return {
      uid,
      flags,
      size,
      from: h.from || "",
      to: h.to || h.cc || "",
      subject: h.subject || "(no subject)",
      date: h.date || "",
      text: bodies.text,
      html: bodies.html,
      rawHeaders: headers,
    };
  }

  async markSeen(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async deleteUid(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS (\\Deleted)`);
    await this.command("EXPUNGE");
  }

  async append(mailbox: string, raw: string): Promise<void> {
    this.n += 1;
    const tag = `A${this.n}`;
    this.sock.write(`${tag} APPEND ${quoteImap(mailbox)} {${Buffer.byteLength(raw, "utf8")}}\r\n`);
    const cont = await this.waitLine();
    if (!cont.startsWith("+")) throw new Error("IMAP APPEND rejected");
    this.sock.write(`${raw}\r\n`);
    for (;;) {
      const line = await this.waitLine();
      if (line.startsWith(`${tag} `)) {
        if (!line.startsWith(`${tag} OK`)) throw new Error(line);
        return;
      }
    }
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      /* closed */
    }
  }

  close() {
    this.sock.destroy();
  }
}

export async function withImap<T>(
  host: string,
  port: number,
  user: string,
  pass: string,
  fn: (c: ImapClient) => Promise<T>,
): Promise<T> {
  const c = await ImapClient.connect(host, port);
  try {
    await c.login(user, pass);
    return await fn(c);
  } finally {
    await c.logout().catch(() => {});
    c.close();
  }
}

export { splitHeaderBody };
