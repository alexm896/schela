#!/bin/bash
# Mail against real Postfix and Dovecot: a mailbox written by schela-apply can
# log in over IMAP and open its INBOX. Run as root in the test container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

echo "== mail (postfix + dovecot)"
command -v dovecot >/dev/null || { echo "skip mail (no dovecot)"; exit 0; }

# No systemd in the container: schela-apply only needs systemctl to succeed.
restore=0
if [ -e /usr/bin/systemctl ] && [ ! -e /usr/bin/systemctl.real ]; then
  mv /usr/bin/systemctl /usr/bin/systemctl.real
  restore=1
fi
printf '#!/bin/sh\nexit 0\n' >/usr/bin/systemctl
chmod 755 /usr/bin/systemctl
cleanup() {
  doveadm stop >/dev/null 2>&1 || true
  rm -f /usr/bin/systemctl
  [ "$restore" -eq 0 ] || mv /usr/bin/systemctl.real /usr/bin/systemctl
}
trap cleanup EXIT

id -u vmail >/dev/null 2>&1 || useradd --system --home /var/mail/schela --shell /usr/sbin/nologin vmail
mkdir -p /var/lib/schela /var/mail/schela
export SCHELA_STATE=/tmp/schela-mail-state.json
export SCHELA_VERSIONS="${SCHELA_VERSIONS:-$INS/versions.json}"
export SCHELA_TEMPLATES="${SCHELA_TEMPLATES:-/usr/local/share/schela/templates}"
PASS='Secret-123'
HASH="$(doveadm pw -s SSHA512 -p "$PASS")"
cat >"$SCHELA_STATE" <<JSON
{"settings":{"hostname":"mail.schela-ci.dev"},"modules":{"mail":true},"sites":[],"apps":[],"firewall":[],"cron":[],"backups":[],"dns":{"zones":[]},
 "mailboxes":[{"address":"alice@shop.schela-ci.dev","status":"active","passwordHash":"$HASH","quotaMb":1024}]}
JSON
bash "$INS/schela-apply" >/tmp/schela-mail.out 2>&1 || { cat /tmp/schela-mail.out; fail "apply with a mailbox"; }
doveconf -n >/tmp/doveconf.out 2>&1 || { cat /tmp/doveconf.out; fail "doveconf -n"; }
postfix check || fail "postfix check"
pass "dovecot $(dovecot --version | cut -d' ' -f1) and postfix $(postconf -h mail_version) accept the config"

dovecot
for _ in $(seq 1 20); do
  (exec 3<>/dev/tcp/127.0.0.1/143) 2>/dev/null && break
  sleep 0.5
done
python3 - "$PASS" <<'PY' || fail "IMAP"
import imaplib, sys
m = imaplib.IMAP4("127.0.0.1", 143)
typ, _ = m.login("alice@shop.schela-ci.dev", sys.argv[1])
assert typ == "OK", typ
typ, data = m.select("INBOX")
assert typ == "OK", (typ, data)
m.logout()
PY
pass "a mailbox logs in over IMAP and opens its INBOX"
