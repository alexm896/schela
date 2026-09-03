import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

const COOKIE = "schela_webmail";
const MAX_AGE = 8 * 60 * 60;

export type WebmailSession = {
  addr: string;
  pw: string;
};

type Stored = WebmailSession & { exp: number };

const store = new Map<string, Stored>();

function secretBytes(): Buffer {
  const raw =
    process.env.BETTER_AUTH_SECRET?.trim() || process.env.SCHELA_WEBMAIL_SECRET?.trim() || "";
  if (process.env.SCHELA_APPLY === "1" && raw.length < 16) {
    throw new Error("Webmail requires BETTER_AUTH_SECRET on the server");
  }
  return Buffer.from(raw || "schela-webmail-dev-only", "utf8");
}

function sign(id: string): string {
  return createHmac("sha256", secretBytes()).update(id).digest("base64url");
}

function cookieSecure(): boolean {
  const req = getRequest();
  const proto = req?.headers.get("x-forwarded-proto") || "";
  return proto === "https" || process.env.SCHELA_APPLY === "1";
}

function prune() {
  const now = Date.now();
  for (const [id, s] of store) {
    if (s.exp <= now) store.delete(id);
  }
}

export async function writeWebmailSession(sess: WebmailSession): Promise<void> {
  prune();
  const id = randomBytes(32).toString("base64url");
  store.set(id, { addr: sess.addr, pw: sess.pw, exp: Date.now() + MAX_AGE * 1000 });
  setCookie(COOKIE, `${id}.${sign(id)}`, {
    path: "/",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "strict",
    maxAge: MAX_AGE,
  });
}

export async function clearWebmailSession(): Promise<void> {
  const raw = getCookie(COOKIE);
  if (raw) {
    const id = raw.split(".")[0];
    if (id) store.delete(id);
  }
  setCookie(COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "strict",
    maxAge: 0,
  });
}

export async function readWebmailSession(): Promise<WebmailSession | null> {
  prune();
  const raw = getCookie(COOKIE);
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expect = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const sess = store.get(id);
  if (!sess || sess.exp <= Date.now()) {
    store.delete(id);
    return null;
  }
  return { addr: sess.addr, pw: sess.pw };
}
