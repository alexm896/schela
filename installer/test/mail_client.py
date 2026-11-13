#!/usr/bin/env python3
"""Mail client checks against a Postfix + Dovecot configured by schela-apply.

  mail_client.py local  <host> <own-ip>   on the mail server itself
  mail_client.py remote <host>            from another machine

Reads the expected server certificate from $SCHELA_HOST_CRT and the mailbox
password from $SCHELA_MAIL_PASS. Every case runs; exit 1 if any failed.
"""
import base64
import imaplib
import os
import smtplib
import socket
import ssl
import sys

HOSTNAME = "mail.schela-ci.dev"
ALICE = "alice@shop.schela-ci.dev"
BOB = "bob@shop.schela-ci.dev"
OUTSIDE = "someone@example.net"
TIMEOUT = 10

mode = sys.argv[1]
host = sys.argv[2]
own_ip = sys.argv[3] if len(sys.argv) > 3 else ""
password = os.environ["SCHELA_MAIL_PASS"]
cert_path = os.environ["SCHELA_HOST_CRT"]
with open(cert_path) as f:
    host_der = ssl.PEM_cert_to_DER_cert(f.read())

failed = []


def case(name):
    def wrap(fn):
        try:
            detail = fn()
            print("ok   " + name + (" [%s]" % detail if detail else ""), flush=True)
        except Exception as e:  # noqa: BLE001 - any error is a failed case
            failed.append(name)
            print("FAIL %s: %s: %s" % (name, type(e).__name__, e), flush=True)
        return fn
    return wrap


def tls_context():
    """Trusts only the expected host certificate, and checks the hostname."""
    ctx = ssl.create_default_context(cafile=cert_path)
    # A self-signed host certificate is its own trust anchor; strict X.509
    # checks (Python 3.13) would reject it for missing CA extensions.
    ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
    return ctx


class Imap(imaplib.IMAP4):
    """IMAP4 with an optional source address and implicit TLS."""

    def __init__(self, port, tls=False, source=None):
        self._tls = tls
        self._source = source
        super().__init__(host, port, timeout=TIMEOUT)

    def _create_socket(self, timeout):
        src = (self._source, 0) if self._source else None
        sock = socket.create_connection((self.host, self.port), timeout, source_address=src)
        if self._tls:
            sock = tls_context().wrap_socket(sock, server_hostname=HOSTNAME)
        return sock


def smtp(port, source=None):
    s = smtplib.SMTP(host, port, timeout=TIMEOUT,
                     source_address=(source, 0) if source else None)
    s._host = HOSTNAME  # starttls() verifies this name
    s.ehlo("client.schela-ci.dev")
    return s


def starttls(s, verify=True):
    ctx = tls_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    code, msg = s.starttls(context=ctx)
    assert code == 220, (code, msg)
    s.ehlo("client.schela-ci.dev")


def peer_der(s):
    return s.sock.getpeercert(binary_form=True)


def expect_refused(code, msg, what):
    """Returns the server's refusal, for the ok line."""
    assert code >= 400, "%s accepted: %s %s" % (what, code, msg)
    return "%d %s" % (code, msg.decode(errors="replace"))


# --- IMAP -------------------------------------------------------------------

@case("993 serves the server hostname certificate")
def _():
    raw = socket.create_connection((host, 993), TIMEOUT)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with ctx.wrap_socket(raw, server_hostname=HOSTNAME) as t:
        assert t.getpeercert(binary_form=True) == host_der, "a different certificate"


@case("TLS login on 993 opens INBOX")
def _():
    m = Imap(993, tls=True)
    typ, _ = m.login(ALICE, password)
    assert typ == "OK", typ
    typ, data = m.select("INBOX")
    assert typ == "OK", (typ, data)
    m.logout()


if mode == "local":
    @case("plaintext LOGIN on 127.0.0.1:143 from the server itself still works (webmail)")
    def _():
        m = Imap(143)
        typ, _ = m.login(ALICE, password)
        assert typ == "OK", typ
        typ, data = m.select("INBOX")
        assert typ == "OK", (typ, data)
        m.logout()

    @case("plaintext LOGIN on 143 from another address (127.0.0.2) is refused")
    def _():
        m = Imap(143, source="127.0.0.2")
        assert "LOGINDISABLED" in m.capabilities, m.capabilities
        try:
            m.login(ALICE, password)
        except imaplib.IMAP4.error as e:
            return str(e)
        raise AssertionError("LOGIN succeeded without TLS")

    @case("143 is not listening on the non-loopback address %s" % own_ip)
    def _():
        try:
            socket.create_connection((own_ip, 143), TIMEOUT).close()
        except ConnectionRefusedError as e:
            return type(e).__name__
        raise AssertionError("connected to %s:143" % own_ip)

if mode == "remote":
    @case("plaintext LOGIN on 143 from another host is impossible")
    def _():
        try:
            m = Imap(143)
        except (ConnectionRefusedError, socket.timeout) as e:
            return type(e).__name__
        try:
            m.login(ALICE, password)
        except imaplib.IMAP4.error as e:
            return str(e)
        raise AssertionError("LOGIN on 143 succeeded from another host")


# --- submission (587) ---------------------------------------------------------

@case("587 refuses AUTH before STARTTLS")
def _():
    s = smtp(587)
    assert not s.has_extn("auth"), "AUTH advertised before STARTTLS"
    token = base64.b64encode(("\0%s\0%s" % (ALICE, password)).encode()).decode()
    code, msg = s.docmd("AUTH", "PLAIN " + token)
    s.close()
    return expect_refused(code, msg, "AUTH before STARTTLS")


@case("587 refuses relay without AUTH")
def _():
    s = smtp(587)
    starttls(s)
    code, msg = s.mail("someone@example.org")
    if code < 400:
        code, msg = s.rcpt(OUTSIDE)
    s.close()
    return expect_refused(code, msg, "unauthenticated relay")


@case("authenticated submission on 587 is queued")
def _():
    s = smtp(587)
    starttls(s)
    assert peer_der(s) == host_der, "587 serves a different certificate"
    s.login(ALICE, password)
    code, msg = s.mail(ALICE)
    assert code == 250, (code, msg)
    for rcpt in (OUTSIDE, BOB):
        code, msg = s.rcpt(rcpt)
        assert code == 250, (rcpt, code, msg)
    code, msg = s.data("From: %s\r\nTo: %s\r\nSubject: schela test\r\n\r\nhello\r\n" % (ALICE, BOB))
    assert code == 250 and b"queued" in msg, (code, msg)
    s.quit()
    return msg.decode()


def send_as(sender):
    s = smtp(587)
    starttls(s)
    s.login(ALICE, password)
    code, msg = s.mail(sender)
    if code < 400:
        code, msg = s.rcpt(OUTSIDE)
    s.close()
    return expect_refused(code, msg, "%s sending as %s" % (ALICE, sender))


@case("587 refuses an authenticated user sending as another mailbox")
def _():
    return send_as(BOB)


@case("587 refuses an authenticated user sending as an outside address")
def _():
    return send_as("ceo@example.org")


# --- inbound (25) -------------------------------------------------------------

@case("25 offers STARTTLS with the server hostname certificate")
def _():
    s = smtp(25)
    assert s.has_extn("starttls"), "no STARTTLS on 25"
    starttls(s)
    assert peer_der(s) == host_der, "25 serves a different certificate"
    s.close()


@case("25 offers no AUTH, before or after STARTTLS")
def _():
    s = smtp(25)
    assert not s.has_extn("auth"), "AUTH advertised on 25"
    starttls(s, verify=False)  # the certificate has its own case
    assert not s.has_extn("auth"), "AUTH advertised on 25 after STARTTLS"
    s.close()


@case("25 accepts mail for a local mailbox without TLS")
def _():
    s = smtp(25)
    code, msg = s.mail("someone@example.org")
    assert code == 250, (code, msg)
    code, msg = s.rcpt(ALICE)
    assert code == 250, (code, msg)
    code, msg = s.data("Subject: inbound\r\n\r\nhello\r\n")
    assert code == 250, (code, msg)
    s.quit()


print("mail client (%s): %d failed" % (mode, len(failed)))
sys.exit(1 if failed else 0)
