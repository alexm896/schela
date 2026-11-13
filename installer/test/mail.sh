#!/bin/bash
# Mail against real Postfix and Dovecot configured by schela-apply: IMAPS on
# 993 and submission on 587 with the server hostname certificate, passwords
# never accepted without TLS except from the server to itself, 143 on loopback
# only, opportunistic STARTTLS and no AUTH on 25. Run as root in the test
# container. With SCHELA_MAIL_KEEP=1 the daemons keep running afterwards, so
# mail-remote.sh can test them from a second container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }
failed=0
check() {
  local name="$1"
  shift
  if "$@"; then pass "$name"; else printf 'FAIL %s\n' "$name"; failed=$((failed + 1)); fi
}

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
  [ "${SCHELA_MAIL_KEEP:-0}" = "1" ] && return
  doveadm stop >/dev/null 2>&1 || true
  postfix stop >/dev/null 2>&1 || true
  rm -f /usr/bin/systemctl
  [ "$restore" -eq 0 ] || mv /usr/bin/systemctl.real /usr/bin/systemctl
}
trap cleanup EXIT

id -u vmail >/dev/null 2>&1 || useradd --system --home /var/mail/schela --shell /usr/sbin/nologin vmail
mkdir -p /var/lib/schela /var/mail/schela
export SCHELA_STATE=/tmp/schela-mail-state.json
export SCHELA_VERSIONS="${SCHELA_VERSIONS:-$INS/versions.json}"
export SCHELA_TEMPLATES="${SCHELA_TEMPLATES:-/usr/local/share/schela/templates}"
[ -d "$SCHELA_TEMPLATES" ] || SCHELA_TEMPLATES="$INS/templates"
export SCHELA_MAIL_PASS='Secret-123'
export SCHELA_HOST_CRT=/var/lib/schela/tls/host.crt
HASH="$(doveadm pw -s SSHA512 -p "$SCHELA_MAIL_PASS")"
cat >"$SCHELA_STATE" <<JSON
{"settings":{"hostname":"mail.schela-ci.dev"},"modules":{"mail":true},"sites":[],"apps":[],"firewall":[],"cron":[],"backups":[],"dns":{"zones":[]},
 "mailboxes":[{"address":"alice@shop.schela-ci.dev","status":"active","passwordHash":"$HASH","quotaMb":1024},
              {"address":"bob@shop.schela-ci.dev","status":"active","passwordHash":"$HASH","quotaMb":1024}]}
JSON
apply() { bash "$INS/schela-apply" >/tmp/schela-mail.out 2>&1 || { cat /tmp/schela-mail.out; fail "schela-apply"; }; }
if dovecot --version | grep -q '^2\.3'; then cleartext_off='disable_plaintext_auth=yes'; else cleartext_off='auth_allow_cleartext=no'; fi
dove_set() { [ "$(doveconf -h "${1%%=*}" 2>/dev/null)" = "${1#*=}" ]; }
sub_opt() { [ "$(postconf -Ph "submission/inet/$1" 2>/dev/null)" = "$2" ]; }

# Hostname certificate gone: apply makes it (ensure_host_cert) before mail.
rm -rf /var/lib/schela/tls
apply
check "missing hostname certificate: apply recreates it before mail" \
  bash -c "[ -s /var/lib/schela/tls/host.crt ] && [ -s /var/lib/schela/tls/host.key ] && ! grep -q 'warning: /var/lib/schela/tls/host.crt' /tmp/schela-mail.out"
doveconf -n >/tmp/doveconf.out 2>&1 || { cat /tmp/doveconf.out; fail "doveconf -n"; }
check "missing hostname certificate: dovecot still refuses passwords without TLS ($cleartext_off, ssl=required)" \
  bash -c "$(declare -f dove_set); dove_set $cleartext_off && dove_set ssl=required"
check "missing hostname certificate: 587 still requires TLS before AUTH" \
  bash -c "$(declare -f sub_opt); sub_opt smtpd_tls_security_level encrypt && sub_opt smtpd_tls_auth_only yes"

# The hostname certificate, as the certificate step leaves it: root only.
install -d -m 0700 /var/lib/schela/tls
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=mail.schela-ci.dev" \
  -addext "subjectAltName=DNS:mail.schela-ci.dev" \
  -keyout /var/lib/schela/tls/host.key -out /var/lib/schela/tls/host.crt >/dev/null 2>&1
chmod 600 /var/lib/schela/tls/host.key
chmod 644 /var/lib/schela/tls/host.crt
apply
apply
doveconf -n >/tmp/doveconf.out 2>&1 || { cat /tmp/doveconf.out; fail "doveconf -n"; }
postfix check >/tmp/postfix-check.out 2>&1 || { cat /tmp/postfix-check.out; fail "postfix check"; }
pass "dovecot $(dovecot --version | cut -d' ' -f1) and postfix $(postconf -h mail_version) accept the config"
check "a second apply leaves one submission service in master.cf" \
  bash -c '[ "$(postconf -M | grep -c "^submission ")" -eq 1 ]'
check "port 25 does not offer AUTH (smtpd_sasl_auth_enable = no)" \
  bash -c '[ "$(postconf -h smtpd_sasl_auth_enable)" = no ]'

dovecot
postfix start >/dev/null 2>&1 || fail "postfix start"
for port in 993 25 587; do
  for _ in $(seq 1 40); do
    (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
    sleep 0.25
  done
done
own_ip="$(hostname -I | awk '{print $1}')"
python3 "$ROOT/installer/test/mail_client.py" local 127.0.0.1 "$own_ip" || failed=$((failed + 1))

[ "$failed" -eq 0 ] || fail "mail: $failed check(s) failed"
