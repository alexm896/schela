import type { MailBody, MailListItem } from "./imap";
import { extractBodies, parseHeaders, splitHeaderBody } from "./rfc822";
import { buildMessage } from "./smtp";

type DemoBox = {
  folders: Record<string, MailBody[]>;
  next: number;
};

const boxes = new Map<string, DemoBox>();

function seed(addr: string): DemoBox {
  const now = new Date().toUTCString();
  const welcomeRaw =
    `From: Schela <noreply@${addr.split("@")[1] || "schela.local"}>\r\n` +
    `To: ${addr}\r\n` +
    `Subject: Welcome to Schela webmail\r\n` +
    `Date: ${now}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    `This is the on-server webmail for ${addr}.\r\n` +
    `HTML is shown in a sandbox. Remote images stay blocked until you allow them.\r\n`;
  const { headers, body } = splitHeaderBody(welcomeRaw.replace(/\r\n/g, "\n"));
  const h = parseHeaders(headers);
  const bodies = extractBodies(welcomeRaw.replace(/\r\n/g, "\n"));
  const msg: MailBody = {
    uid: 1,
    flags: [],
    size: Buffer.byteLength(welcomeRaw),
    from: h.from || "",
    to: h.to || addr,
    subject: h.subject || "Welcome",
    date: h.date || now,
    text: bodies.text || body,
    html: bodies.html,
    rawHeaders: headers,
  };
  return {
    next: 2,
    folders: {
      INBOX: [msg],
      Sent: [],
      Trash: [],
    },
  };
}

function box(addr: string): DemoBox {
  let b = boxes.get(addr);
  if (!b) {
    b = seed(addr);
    boxes.set(addr, b);
  }
  return b;
}

function asList(m: MailBody): MailListItem {
  return {
    uid: m.uid,
    flags: m.flags,
    size: m.size,
    from: m.from,
    to: m.to,
    subject: m.subject,
    date: m.date,
  };
}

export const demoStore = {
  folders(addr: string): string[] {
    return Object.keys(box(addr).folders);
  },
  list(addr: string, folder: string): MailListItem[] {
    const items = box(addr).folders[folder] || [];
    return [...items].map(asList).sort((a, b) => b.uid - a.uid);
  },
  get(addr: string, folder: string, uid: number): MailBody | null {
    return (box(addr).folders[folder] || []).find((m) => m.uid === uid) || null;
  },
  markSeen(addr: string, folder: string, uid: number) {
    const m = demoStore.get(addr, folder, uid);
    if (m && !m.flags.includes("\\Seen")) m.flags.push("\\Seen");
  },
  delete(addr: string, folder: string, uid: number) {
    const b = box(addr);
    const cur = b.folders[folder] || [];
    const msg = cur.find((m) => m.uid === uid);
    b.folders[folder] = cur.filter((m) => m.uid !== uid);
    if (msg && folder !== "Trash") {
      b.folders.Trash = b.folders.Trash || [];
      b.folders.Trash.push(msg);
    }
  },
  append(addr: string, folder: string, raw: string) {
    const b = box(addr);
    const { headers } = splitHeaderBody(raw.replace(/\r\n/g, "\n"));
    const h = parseHeaders(headers);
    const bodies = extractBodies(raw.replace(/\r\n/g, "\n"));
    const uid = b.next++;
    const msg: MailBody = {
      uid,
      flags: ["\\Seen"],
      size: Buffer.byteLength(raw),
      from: h.from || addr,
      to: h.to || "",
      subject: h.subject || "(no subject)",
      date: h.date || new Date().toUTCString(),
      text: bodies.text,
      html: bodies.html,
      rawHeaders: headers,
    };
    b.folders[folder] = b.folders[folder] || [];
    b.folders[folder].push(msg);
  },
  send(addr: string, to: string[], subject: string, text: string) {
    const raw = buildMessage({ from: addr, to, subject, text });
    demoStore.append(addr, "Sent", raw);
  },
};
