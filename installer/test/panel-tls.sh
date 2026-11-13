#!/bin/bash
# Panel on HTTPS against real nginx: a box with the old HTTP-only panel vhost
# is migrated by schela-apply, unknown names never reach the panel, the host
# certificate contract files exist, and the certbot deploy hook deploys a
# renewal. Run as root in the test container.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
FAILED=0
ok()   { printf 'ok   %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; FAILED=$((FAILED + 1)); }
# check <name> <command...>: one isolated case; the run goes on after a failure.
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

echo "== panel on https (nginx $(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p'))"
command -v curl >/dev/null || { echo "FAIL curl missing from the test image"; exit 1; }

HOST=panel.schela-ci.dev
PORT=19090
IP="$(hostname -I | awk '{print $1}')"
[ -n "$IP" ] || { echo "FAIL no address from hostname -I"; exit 1; }
TLS=/var/lib/schela/tls
LIVE=/etc/letsencrypt/live
HOOK=/etc/letsencrypt/renewal-hooks/deploy/schela
NGV="$(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p')"
REJECTS=0
[ "$(printf '%s\n1.19.4\n' "$NGV" | sort -V | head -n1)" = "1.19.4" ] && REJECTS=1

export SCHELA_VERSIONS="${SCHELA_VERSIONS:-$INS/versions.json}"
export SCHELA_TEMPLATES=/usr/local/share/schela/templates
export SCHELA_STATE=/tmp/schela-panel-state.json
export SCHELA_PANEL_PORT=$PORT
mkdir -p "$SCHELA_TEMPLATES" /var/lib/schela /etc/nginx/sites-available /etc/nginx/sites-enabled
cp -a "$INS/templates/." "$SCHELA_TEMPLATES/"
# The hook calls the installed copy, as on a server.
install -m 0755 "$INS/schela-apply" /usr/local/sbin/schela-apply

# No systemd here: record calls; nginx reloads for real; is-active answers
# from /tmp/panel-active-<unit>.
restore=0
if [ -e /usr/bin/systemctl ] && [ ! -e /usr/bin/systemctl.real ]; then
  mv /usr/bin/systemctl /usr/bin/systemctl.real
  restore=1
fi
cat >/usr/bin/systemctl <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>/tmp/panel-systemctl.log
case "$1" in
  reload|restart)
    if [ "$2" = "nginx" ]; then nginx -s reload || exit 1; sleep 1; fi
    exit 0 ;;
  is-active) [ -e "/tmp/panel-active-${*: -1}" ] && exit 0; exit 3 ;;
  *) exit 0 ;;
esac
SH
chmod 755 /usr/bin/systemctl
STUBBIN="$(mktemp -d)"
cleanup() {
  nginx -s stop >/dev/null 2>&1 || true
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null
  rm -f /usr/bin/systemctl /tmp/panel-active-*
  [ "$restore" -eq 0 ] || mv /usr/bin/systemctl.real /usr/bin/systemctl
  rm -rf "$STUBBIN" "$TLS" "$LIVE/$HOST" "$LIVE/site.schela-ci.dev" "$LIVE/le.schela-ci.dev" "$HOOK"
  rm -f /etc/nginx/sites-available/schela-panel.conf /etc/nginx/sites-enabled/schela-panel.conf /var/lib/schela/certs.json
}
trap cleanup EXIT

# Stub panel: answers every request with the headers it got, as JSON.
python3 - "$PORT" >/dev/null 2>&1 <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"stub": "schela-panel", "headers": {k.lower(): v for k, v in self.headers.items()}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
BACKEND_PID=$!

write_state() { # hostname
  printf '{"settings":{"hostname":"%s"},"modules":{},"sites":[],"apps":[],"firewall":[],"mailboxes":[],"cron":[],"backups":[],"dns":{"zones":[]}}\n' "$1" >"$SCHELA_STATE"
}
apply() {
  : >/tmp/panel-systemctl.log
  bash "$INS/schela-apply" "$@" >/tmp/panel-apply.out 2>&1 || { cat /tmp/panel-apply.out; return 1; }
}

# The box as earlier installers left it: HTTP-only panel, default_server on 80
# for any Host, X-Forwarded-For appended from the client.
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.conf
cat >/etc/nginx/sites-available/schela-panel.conf <<CONF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 64m;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/schela/acme;
        default_type text/plain;
        allow all;
    }
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF
ln -sfn /etc/nginx/sites-available/schela-panel.conf /etc/nginx/sites-enabled/schela-panel.conf
nginx -t >/dev/null 2>&1 || { nginx -t; echo "FAIL old panel vhost"; exit 1; }
nginx || { echo "FAIL nginx did not start"; exit 1; }
for _ in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break; sleep 0.25; done

write_state "$HOST"
apply || bad "apply on a box with the old HTTP-only panel"

# Helpers. Every request goes to this machine; --resolve sets SNI and Host.
https_host() { curl -sk --max-time 5 --resolve "${HOST}:443:127.0.0.1" "$@" "https://${HOST}/"; }
https_ip()   { curl -sk --max-time 5 "$@" "https://${IP}/"; }
is_stub()    { grep -q '"stub": "schela-panel"' <<<"$1"; }
header_of()  { python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["headers"].get(sys.argv[1], ""))' "$1"; }

# --- happy path
body="$(https_host)"
check "https://hostname reaches the panel" is_stub "$body"
body="$(https_ip)"
check "https://IP reaches the panel (no SNI, self-signed)" is_stub "$body"

# --- unknown names never reach the panel
# A 444 closes the connection without a response: curl 52 (empty reply), or 56
# when this curl and OpenSSL report the missing TLS close_notify instead. Over
# HTTP/2 it is a stream reset, so the requests on 443 use HTTP/1.1.
no_response() { # rc
  { [ "$1" -eq 52 ] || [ "$1" -eq 56 ]; } && [ ! -s /tmp/panel-out ]
}
rm -f /tmp/panel-out
curl -s --max-time 5 -o /tmp/panel-out -H 'Host: evil.schela-ci.dev' http://127.0.0.1/; rc=$?
check "unknown Host on 80 gets 444 (curl $rc)" no_response "$rc"
rm -f /tmp/panel-out
curl -sk --http1.1 --max-time 5 -o /tmp/panel-out --resolve evil.schela-ci.dev:443:127.0.0.1 https://evil.schela-ci.dev/; rc=$?
if [ "$REJECTS" -eq 1 ]; then
  check "unknown SNI on 443: handshake rejected (curl $rc)" [ "$rc" -eq 35 ]
else
  check "unknown SNI on 443: closed without a response on nginx $NGV (curl $rc)" no_response "$rc"
fi
rm -f /tmp/panel-out
https_host --http1.1 -o /tmp/panel-out -H 'Host: evil.schela-ci.dev'; rc=$?
check "unknown Host on 443 with the panel SNI gets 444 (curl $rc)" no_response "$rc"
rm -f /tmp/panel-out
https_ip --http1.1 -o /tmp/panel-out -H 'Host: evil.schela-ci.dev'; rc=$?
check "unknown Host on 443 without SNI gets 444 (curl $rc)" no_response "$rc"
got="$(python3 - "$IP" <<'PY' 2>&1
import socket, ssl, sys
c = ssl._create_unverified_context()
s = c.wrap_socket(socket.create_connection((sys.argv[1], 443), timeout=5))
s.sendall(b"GET / HTTP/1.0\r\n\r\n")
print(repr(s.recv(4096)))
PY
)"
check "request without Host on 443 gets nothing" [ "$got" = "b''" ]

# --- port 80 for the panel names
loc="$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: ${HOST}" 'http://127.0.0.1/sites?x=1')"
check "http://hostname redirects to https ($loc)" [ "$loc" = "301 https://${HOST}/sites?x=1" ]
loc="$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' "http://${IP}/")"
check "http://IP redirects to https ($loc)" [ "$loc" = "301 https://${IP}/" ]

# --- ACME challenges on 80 for every Host
mkdir -p /var/lib/schela/acme/.well-known/acme-challenge
printf 'tok-123' >/var/lib/schela/acme/.well-known/acme-challenge/tok-123
for h in site.schela-ci.dev "$HOST" "$IP"; do
  got="$(curl -s --max-time 5 -H "Host: $h" http://127.0.0.1/.well-known/acme-challenge/tok-123)"
  check "ACME challenge served on 80 for Host $h" [ "$got" = "tok-123" ]
done

# --- proxy headers
body="$(https_host -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 6.6.6.6')"
xff="$(header_of x-forwarded-for <<<"$body")"
check "forged X-Forwarded-For is not passed to the panel (got '$xff')" [ "$xff" = "127.0.0.1" ]
xri="$(header_of x-real-ip <<<"$body")"
check "X-Real-IP is the client address (got '$xri')" [ "$xri" = "127.0.0.1" ]
xfp="$(header_of x-forwarded-proto <<<"$body")"
check "X-Forwarded-Proto is https (got '$xfp')" [ "$xfp" = "https" ]

# --- security headers, no HSTS with the self-signed certificate
for target in host ip; do
  hdrs="$("https_$target" -D - -o /dev/null | tr -d '\r')"
  check "panel by $target: X-Content-Type-Options nosniff" grep -qix 'x-content-type-options: nosniff' <<<"$hdrs"
  check "panel by $target: X-Frame-Options DENY" grep -qix 'x-frame-options: DENY' <<<"$hdrs"
  check "panel by $target: Referrer-Policy" grep -qi '^referrer-policy: ' <<<"$hdrs"
  check "panel by $target: no HSTS with the self-signed certificate" bash -c '! grep -qi "^strict-transport-security" <<<"$1"' _ "$hdrs"
done

# --- host certificate contract
same_text() { [ -n "$1" ] && [ "$1" = "$2" ]; }
same_key() { same_text "$(openssl x509 -noout -pubkey -in "$1" 2>/dev/null)" "$(openssl pkey -pubout -in "$2" 2>/dev/null)"; }
both_files() { [ -s "$1" ] && [ -s "$2" ]; }
check "host.crt and host.key exist" both_files "$TLS/host.crt" "$TLS/host.key"
check "host.key matches host.crt" same_key "$TLS/host.crt" "$TLS/host.key"
check "host.key is root-only (0600 root)" [ "$(stat -c '%a %U' "$TLS/host.key" 2>/dev/null)" = "600 root" ]
check "host.crt is the self-signed certificate without Let's Encrypt" cmp -s "$TLS/host.crt" "$TLS/self-signed.crt"
san="$(openssl x509 -noout -ext subjectAltName -in "$TLS/self-signed.crt" 2>/dev/null)"
check "self-signed certificate names the hostname and the IP" bash -c 'grep -q "DNS:$1" <<<"$3" && grep -q "IP Address:$2" <<<"$3"' _ "$HOST" "$IP" "$san"
served="$(openssl s_client -connect 127.0.0.1:443 -servername "$HOST" </dev/null 2>/dev/null | openssl x509 -noout -fingerprint 2>/dev/null)"
check "nginx serves host.crt for the hostname" same_text "$served" "$(openssl x509 -noout -fingerprint -in "$TLS/host.crt" 2>/dev/null)"
check "schela url gives https://IP with the self-signed certificate" [ "$(bash "$INS/schela" url)" = "https://${IP}/" ]

# --- a link at /var/lib/schela/tls is not followed
rm -rf "$TLS" /tmp/panel-tls-target
mkdir -p /tmp/panel-tls-target
ln -s /tmp/panel-tls-target "$TLS"
apply || bad "apply with a link at $TLS"
check "a link at $TLS is replaced by a root directory" bash -c '[ ! -L "$1" ] && [ -d "$1" ] && [ -z "$(ls -A /tmp/panel-tls-target)" ]' _ "$TLS"
check "host.crt and host.key exist after that apply" both_files "$TLS/host.crt" "$TLS/host.key"

# --- Let's Encrypt certificate for the hostname: used, HSTS on the hostname only
mkcert() { # dir name
  mkdir -p "$1"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$2" -addext "subjectAltName=DNS:$2" \
    -keyout "$1/privkey.pem" -out "$1/fullchain.pem" >/dev/null 2>&1
}
mkcert "$LIVE/$HOST" "$HOST"
apply || bad "apply with a Let's Encrypt certificate for the hostname"
check "host.crt is the Let's Encrypt certificate when one is live" cmp -s "$TLS/host.crt" "$LIVE/$HOST/fullchain.pem"
check "host.key is its key" cmp -s "$TLS/host.key" "$LIVE/$HOST/privkey.pem"
hsts="$(https_host -D - -o /dev/null | tr -d '\r' | grep -i '^strict-transport-security:' || true)"
check "HSTS on the hostname with a trusted certificate ($hsts)" grep -qi 'max-age=' <<<"$hsts"
check "HSTS without includeSubDomains or preload" bash -c '! grep -qiE "includesubdomains|preload" <<<"$1"' _ "$hsts"
hdrs="$(https_ip -D - -o /dev/null | tr -d '\r')"
check "no HSTS on the panel by IP" bash -c '! grep -qi "^strict-transport-security" <<<"$1"' _ "$hdrs"
served="$(openssl s_client -connect "${IP}:443" </dev/null 2>/dev/null | openssl x509 -noout -fingerprint 2>/dev/null)"
check "the panel by IP keeps the self-signed certificate" same_text "$served" "$(openssl x509 -noout -fingerprint -in "$TLS/self-signed.crt" 2>/dev/null)"
check "schela url gives https://hostname with Let's Encrypt" [ "$(bash "$INS/schela" url)" = "https://${HOST}/" ]

# --- deploy hook
check "deploy hook installed and executable" [ -x "$HOOK" ]
mkcert "$LIVE/site.schela-ci.dev" site.schela-ci.dev
printf '{"site.schela-ci.dev":{"status":"live","message":"Certificate is active","expires":"stale"}}\n' >/var/lib/schela/certs.json
mkcert "$LIVE/$HOST" "$HOST"   # certbot renewed: new key, new certificate
touch /tmp/panel-active-dovecot /tmp/panel-active-postfix
: >/tmp/panel-systemctl.log
RENEWED_LINEAGE="$LIVE/$HOST" RENEWED_DOMAINS="$HOST" "$HOOK" >/tmp/panel-hook.out 2>&1; rc=$?
check "deploy hook succeeds" [ "$rc" -eq 0 ]
check "deploy hook copies the renewed host certificate to host.crt" cmp -s "$TLS/host.crt" "$LIVE/$HOST/fullchain.pem"
check "deploy hook copies the renewed key to host.key" same_key "$TLS/host.crt" "$TLS/host.key"
check "deploy hook reloads nginx" grep -qx 'reload nginx' /tmp/panel-systemctl.log
check "deploy hook reloads dovecot when active" grep -qx 'reload dovecot' /tmp/panel-systemctl.log
check "deploy hook reloads postfix when active" grep -qx 'reload postfix' /tmp/panel-systemctl.log
served="$(openssl s_client -connect 127.0.0.1:443 -servername "$HOST" </dev/null 2>/dev/null | openssl x509 -noout -fingerprint 2>/dev/null)"
check "nginx serves the renewed certificate" same_text "$served" "$(openssl x509 -noout -fingerprint -in "$LIVE/$HOST/fullchain.pem" 2>/dev/null)"
exp="$(jq -r '."site.schela-ci.dev".expires' /var/lib/schela/certs.json 2>/dev/null)"
check "deploy hook refreshes certs.json ($exp)" [ "$exp" = "$(openssl x509 -enddate -noout -in "$LIVE/site.schela-ci.dev/fullchain.pem" | sed 's/notAfter=//')" ]

rm -f /tmp/panel-active-dovecot /tmp/panel-active-postfix
before="$(cat "$TLS/host.crt" 2>/dev/null)"
: >/tmp/panel-systemctl.log
RENEWED_LINEAGE="$LIVE/site.schela-ci.dev" "$HOOK" >/tmp/panel-hook.out 2>&1
check "renewal of a site certificate leaves host.crt alone" same_text "$(cat "$TLS/host.crt" 2>/dev/null)" "$before"
check "deploy hook does not reload stopped dovecot and postfix" bash -c '! grep -qE "reload (dovecot|postfix)" /tmp/panel-systemctl.log'

# certbot can run the hook from inside an apply, which holds the lock.
exec 8>/run/schela-apply.lock
flock 8
RENEWED_LINEAGE="$LIVE/$HOST" timeout 20 "$HOOK" >/tmp/panel-hook.out 2>&1; rc=$?
exec 8>&-
check "deploy hook does not wait for the apply lock" [ "$rc" -eq 0 ]

# --- Let's Encrypt issuance for the hostname (certbot and DNS stubbed)
LEH=le.schela-ci.dev
cat >"$STUBBIN/certbot" <<SH
#!/bin/bash
printf '%s\n' "\$*" >>/tmp/panel-certbot.log
d=""; prev=""
for a in "\$@"; do [ "\$prev" = "-d" ] && d="\$a"; prev="\$a"; done
mkdir -p "$LIVE/\$d"
openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=\$d" -keyout "$LIVE/\$d/privkey.pem" -out "$LIVE/\$d/fullchain.pem" >/dev/null 2>&1
SH
cat >"$STUBBIN/getent" <<SH
#!/bin/bash
if [ "\$*" = "-s dns ahosts $LEH" ]; then
  [ -e /tmp/panel-dns-points-here ] || exit 2
  printf '%s STREAM %s\n' "$IP" "$LEH"
  exit 0
fi
exec /usr/bin/getent "\$@"
SH
chmod 755 "$STUBBIN/certbot" "$STUBBIN/getent"
write_state "$LEH"
rm -f /tmp/panel-certbot.log /tmp/panel-dns-points-here
PATH="$STUBBIN:$PATH" apply || bad "apply with a hostname that does not resolve here"
check "no certbot run for a hostname that does not resolve here" [ ! -e /tmp/panel-certbot.log ]
check "the panel keeps the self-signed certificate then" cmp -s "$TLS/host.crt" "$TLS/self-signed.crt"
touch /tmp/panel-dns-points-here
PATH="$STUBBIN:$PATH" apply || bad "apply with a hostname that resolves here"
check "certbot webroot run for the hostname when it resolves here" \
  grep -q -- "certonly --webroot -w /var/lib/schela/acme -d ${LEH} " /tmp/panel-certbot.log
check "host.crt is the newly issued certificate" cmp -s "$TLS/host.crt" "$LIVE/$LEH/fullchain.pem"
loc="$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: ${LEH}" http://127.0.0.1/)"
check "the new hostname redirects to https ($loc)" [ "$loc" = "301 https://${LEH}/" ]
rm -f /tmp/panel-dns-points-here /tmp/panel-certbot.log

if [ "$FAILED" -gt 0 ]; then
  echo "== panel on https: $FAILED FAILED"
  exit 1
fi
echo "== panel on https passed"
