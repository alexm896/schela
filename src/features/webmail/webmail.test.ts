import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeMimeWord,
  decodeQuotedPrintable,
  extractBodies,
  parseAddressList,
  parseHeaders,
} from "./rfc822.ts";
import { webmailCookieSecure } from "./cookie.ts";
import { isMailAddress, assertImapFolder, quoteImap } from "./safe.ts";
import { escapeText, sanitizeHtml } from "./sanitize.ts";

describe("rfc822", () => {
  it("decodes quoted-printable and encoded-words", () => {
    assert.equal(decodeQuotedPrintable("a=3Db").toString("utf8"), "a=b");
    assert.equal(decodeMimeWord("=?UTF-8?B?SGVsbG8=?="), "Hello");
    const h = parseHeaders("From: Ada <ada@example.com>\nSubject: Hi\n");
    assert.equal(h.from, "Ada <ada@example.com>");
    assert.deepEqual(parseAddressList("Ada <ada@example.com>, bob@x.test"), [
      "ada@example.com",
      "bob@x.test",
    ]);
  });

  it("extracts text/plain bodies", () => {
    const raw = "Content-Type: text/plain\n\nhello world";
    assert.equal(extractBodies(raw).text.trim(), "hello world");
  });
});

describe("webmail address and folder guards", () => {
  it("accepts real mailboxes and rejects header/folder injection", () => {
    assert.equal(isMailAddress("ada@example.com"), true);
    assert.equal(isMailAddress("ada@example.com>\r\nBCC:evil@x.test"), false);
    assert.equal(isMailAddress("not-an-email"), false);
    assert.equal(assertImapFolder("INBOX.Sent"), "INBOX.Sent");
    assert.throws(() => assertImapFolder("../etc"), /Invalid folder/);
    assert.throws(() => assertImapFolder('INBOX"\r\nA1 LOGOUT'), /Invalid folder/);
    assert.match(quoteImap('a"b'), /\\"/);
    assert.throws(() => quoteImap("a\nb"), /IMAP/);
  });
});

describe("webmail session cookie", () => {
  it("stays readable on the HTTP panel and Secure only on HTTPS", () => {
    assert.equal(
      webmailCookieSecure({ forwardedProto: "http", url: "http://203.0.113.10/" }),
      false,
    );
    assert.equal(
      webmailCookieSecure({ forwardedProto: "HTTP", url: "https://ignored.example/" }),
      false,
    );
    assert.equal(
      webmailCookieSecure({ forwardedProto: "https", url: "http://203.0.113.10/" }),
      true,
    );
    assert.equal(
      webmailCookieSecure({ forwardedProto: "https, http", url: "http://203.0.113.10/" }),
      true,
    );
    assert.equal(
      webmailCookieSecure({ forwardedProto: null, url: "https://panel.example/webmail" }),
      true,
    );
    assert.equal(
      webmailCookieSecure({ forwardedProto: null, url: "http://127.0.0.1:9090/" }),
      false,
    );
  });
});

describe("html sandbox helpers", () => {
  it("strips script and javascript urls", () => {
    const dirty =
      '<p onclick="alert(1)">x</p><script>alert(1)</script><a href="javascript:alert(1)">y</a>';
    const clean = sanitizeHtml(dirty, false);
    assert.equal(clean.includes("<script"), false);
    assert.equal(clean.toLowerCase().includes("onclick"), false);
    assert.equal(clean.toLowerCase().includes("javascript:"), false);
  });

  it("blocks remote images until allowed", () => {
    const html = '<img src="https://evil.example/t.png">';
    assert.equal(sanitizeHtml(html, false).includes("https://evil.example"), false);
    assert.equal(sanitizeHtml(html, true).includes("https://evil.example"), true);
    assert.equal(escapeText("<b>"), "&lt;b&gt;");
  });
});
