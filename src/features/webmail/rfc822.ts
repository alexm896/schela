import { isMailAddress } from "./safe.ts";

export function decodeQuotedPrintable(raw: string): Buffer {
  const stripped = raw.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(stripped.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(stripped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(stripped.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function decodeMimeWord(raw: string): string {
  return raw.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_m, charset, enc, payload: string) => {
      try {
        const buf =
          enc.toUpperCase() === "B"
            ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
            : decodeQuotedPrintable(payload.replace(/_/g, " "));
        return buf.toString((charset as string).toLowerCase() === "utf-8" ? "utf8" : "utf8");
      } catch {
        return payload;
      }
    },
  );
}

export function parseHeaders(raw: string): Record<string, string> {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = decodeMimeWord(line.slice(i + 1).trim());
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

export function headerName(from: string): { name: string; email: string } {
  const angle = /^(.*)<([^>]+)>\s*$/.exec(from.trim());
  if (angle) {
    return {
      name: angle[1].replace(/^"|"$/g, "").trim() || angle[2],
      email: angle[2].trim().toLowerCase(),
    };
  }
  const email = from.trim().toLowerCase();
  return { name: email, email };
}

export function splitHeaderBody(raw: string): { headers: string; body: string } {
  const norm = raw.replace(/\r\n/g, "\n");
  const i = norm.indexOf("\n\n");
  if (i < 0) return { headers: raw, body: "" };
  return { headers: norm.slice(0, i), body: norm.slice(i + 2) };
}

function decodePart(body: string, encoding: string): Buffer {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return Buffer.from(body, "utf8");
}

export function extractBodies(raw: string): { text: string; html: string } {
  const { headers, body } = splitHeaderBody(raw);
  const h = parseHeaders(headers);
  const ctype = h["content-type"] || "text/plain";
  const encoding = h["content-transfer-encoding"] || "7bit";
  const boundary = /boundary="?([^";]+)"?/i.exec(ctype)?.[1];
  if (ctype.toLowerCase().includes("multipart/") && boundary) {
    let text = "";
    let html = "";
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    for (const part of parts) {
      if (!part.trim() || part.startsWith("--")) continue;
      const extracted = extractBodies(part.startsWith("\n") ? part.slice(1) : part);
      if (extracted.html && !html) html = extracted.html;
      if (extracted.text && !text) text = extracted.text;
    }
    return { text, html };
  }
  const decoded = decodePart(body, encoding).toString("utf8");
  if (ctype.toLowerCase().includes("text/html")) return { text: "", html: decoded };
  return { text: decoded, html: "" };
}

export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => headerName(s).email)
    .filter((e) => isMailAddress(e));
}
