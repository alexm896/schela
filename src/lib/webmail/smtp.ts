import net from "node:net";
import { isMailAddress } from "./safe.ts";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

function readReply(sock: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("SMTP timed out")), TIMEOUT_MS);
    const onData = (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r\n/);
      for (const line of lines) {
        if (/^\d{3} /.test(line)) {
          sock.off("data", onData);
          clearTimeout(timer);
          resolve(buf);
          return;
        }
      }
    };
    sock.on("data", onData);
    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function expect(sock: net.Socket, cmd: string | null, ok: number): Promise<string> {
  if (cmd != null) sock.write(`${cmd}\r\n`);
  const reply = await readReply(sock);
  const code = Number(reply.slice(0, 3));
  if (code !== ok && Math.floor(code / 100) !== Math.floor(ok / 100)) {
    throw new Error(reply.trim().slice(0, 180) || `SMTP ${ok} expected`);
  }
  return reply;
}

export async function sendSmtp(opts: {
  host: string;
  port: number;
  from: string;
  to: string[];
  data: string;
}): Promise<void> {
  if (!isMailAddress(opts.from)) throw new Error("Invalid sender");
  if (opts.to.length === 0) throw new Error("No recipients");
  if (opts.to.length > 20) throw new Error("Too many recipients");
  if (opts.to.some((a) => !isMailAddress(a))) throw new Error("Invalid recipient");
  if (Buffer.byteLength(opts.data, "utf8") > MAX_BYTES) throw new Error("Message is too large (8 MB)");
  const stuffed = opts.data.replace(/^\./gm, "..");
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect({ host: opts.host, port: opts.port });
    sock.setEncoding("utf8");
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("SMTP connect timed out"));
    }, TIMEOUT_MS);
    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.once("connect", () => {
      clearTimeout(timer);
      void (async () => {
        try {
          await expect(sock, null, 220);
          await expect(sock, "EHLO schela.webmail", 250);
          await expect(sock, `MAIL FROM:<${opts.from}>`, 250);
          for (const rcpt of opts.to) {
            await expect(sock, `RCPT TO:<${rcpt}>`, 250);
          }
          await expect(sock, "DATA", 354);
          sock.write(`${stuffed}\r\n.\r\n`);
          await expect(sock, null, 250);
          sock.write("QUIT\r\n");
          sock.end();
          resolve();
        } catch (err) {
          sock.destroy();
          reject(err);
        }
      })();
    });
  });
}

export function buildMessage(opts: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
}): string {
  const date = new Date().toUTCString();
  const to = opts.to.join(", ");
  const cc = opts.cc?.length ? `Cc: ${opts.cc.join(", ")}\r\n` : "";
  const body = opts.text.replace(/\r?\n/g, "\r\n");
  return (
    `From: ${opts.from}\r\n` +
    `To: ${to}\r\n` +
    cc +
    // Strip CR, LF and NUL so the subject cannot inject headers.
    // eslint-disable-next-line no-control-regex
    `Subject: ${opts.subject.replace(/[\r\n\x00]+/g, " ").slice(0, 200)}\r\n` +
    `Date: ${date}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n` +
    `\r\n` +
    body
  );
}
