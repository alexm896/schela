#!/bin/bash
# Cross-site symlinks in nginx (real nginx and PHP-FPM), the Node app sandbox
# and the fail2ban jails written by schela-apply. Run as root in the test
# container. Every case reports on its own; the script fails at the end if
# any case failed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
FAILS=0
fail() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }
pass() { printf 'ok   %s\n' "$*"; }
check() { # check <label> <command...>
  local label="$1"
  shift
  if "$@"; then pass "$label"; else fail "$label"; fi
}

export SCHELA_VERSIONS="${SCHELA_VERSIONS:-$INS/versions.json}"
export SCHELA_TEMPLATES="$INS/templates"
export SCHELA_STATE=/tmp/schela-hardening-state.json
export SCHELA_SYSTEMD_DIR=/tmp/schela-hardening-systemd
rm -rf "$SCHELA_SYSTEMD_DIR"
mkdir -p "$SCHELA_SYSTEMD_DIR" /var/lib/schela /etc/nginx/schela.d /etc/nginx/schela-apps.d /run/php

# No systemd in the container: systemctl and ss are stubs. systemctl logs its
# arguments; a unit counts as active when /tmp/hx-active-<unit> exists.
STUBS=/tmp/schela-hardening-stubs
rm -rf "$STUBS"
mkdir -p "$STUBS"
cat >"$STUBS/systemctl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>/tmp/hx-systemctl.log
case "$1" in
  is-active) [ -e "/tmp/hx-active-${*: -1}" ] && exit 0; exit 3 ;;
  show) [ -e "/tmp/hx-listen-${*: -1}" ] && cat "/tmp/hx-listen-${*: -1}"; exit 0 ;;
  *) exit 0 ;;
esac
SH
cat >"$STUBS/ss" <<'SH'
#!/bin/bash
cat /tmp/hx-ss.out 2>/dev/null
SH
chmod 755 "$STUBS/systemctl" "$STUBS/ss"
export PATH="$STUBS:$PATH"
rm -f /tmp/hx-active-* /tmp/hx-listen-* /tmp/hx-ss.out

PHPV="$(ls /etc/php 2>/dev/null | sort -V | tail -1)"
[ -n "$PHPV" ] && command -v "php-fpm$PHPV" >/dev/null || { echo "FAIL no php-fpm in the container"; exit 1; }

site() { # site <domain> <user>
  printf '{"domain":"%s","systemUser":"%s","pool":"hx-%s","phpVersion":"%s","memoryLimit":"128M","root":"/home/%s/www","status":"active","isolated":true,"ssl":false,"forceHttps":false,"ip":""}' \
    "$1" "$2" "$2" "$PHPV" "$2"
}
write_state() { # write_state <mail true|false> <sshPort>
  cat >"$SCHELA_STATE" <<JSON
{"settings":{"hostname":"panel.test","sshPort":$2},
 "modules":{"php":true,"node":true,"mail":$1},
 "sites":[$(site a.hx.test s_hxa),$(site b.hx.test s_hxb),$(site c.hx.test s_hxc)],
 "apps":[{"name":"hxapp","domain":"hxapp.hx.test","nodeVersion":"22","port":3901,"entry":"index.js","status":"running","ip":""}],
 "firewall":[],"mailboxes":[],"cron":[],"backups":[],"dns":{"zones":[]}}
JSON
}
apply_now() {
  : >/tmp/hx-systemctl.log
  bash "$INS/schela-apply" >/tmp/hx-apply.out 2>&1 || { cat /tmp/hx-apply.out; echo "FAIL schela-apply exited non-zero"; exit 1; }
}

write_state false 2200
printf '%s\n' \
  'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=41,fd=3))' \
  'LISTEN 0 128 [::]:2222 [::]:* users:(("sshd",pid=41,fd=4))' \
  'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=50,fd=6))' >/tmp/hx-ss.out
touch /tmp/hx-active-ssh.socket
printf '[::]:2022 (Stream)\n' >/tmp/hx-listen-ssh.socket
printf 'include /etc/nginx/schela.d/*.conf;\ninclude /etc/nginx/schela-apps.d/*.conf;\n' >/etc/nginx/conf.d/schela-includes.conf
apply_now
cp /tmp/hx-systemctl.log /tmp/hx-systemctl.first

# --- P1.5: nginx and symlinks between sites -----------------------------------
echo "== nginx: symlinks between sites"
as() { runuser -u "$1" -- "${@:2}"; }
as s_hxb sh -c 'printf B-SECRET >/home/s_hxb/www/secret.txt'
as s_hxa sh -c 'cd /home/s_hxa/www && printf A-HELLO >hello.txt && ln -sfn hello.txt own.txt \
  && mkdir -p releases/1 && printf A-RELEASE >releases/1/app.txt && ln -sfn releases/1 current \
  && ln -sfn /home/s_hxb/www/secret.txt steal.txt && ln -sfn /home/s_hxb/www bdir'
# c replaces its whole document root with a link to b's.
as s_hxc sh -c 'cd /home/s_hxc && mv www www.orig && ln -s /home/s_hxb/www www'

"php-fpm$PHPV" -D || { echo "FAIL php-fpm$PHPV did not start"; exit 1; }
nginx -t >/tmp/hx-nginx-t.out 2>&1 || { cat /tmp/hx-nginx-t.out; echo "FAIL nginx -t"; exit 1; }
nginx || { echo "FAIL nginx did not start"; exit 1; }

get() { # get <host> <path>: prints "<status> <body>"
  python3 - "$1" "$2" <<'PY'
import http.client, sys
for _ in range(20):
    try:
        c = http.client.HTTPConnection("127.0.0.1", 80, timeout=5)
        c.request("GET", sys.argv[2], headers={"Host": sys.argv[1]})
        r = c.getresponse()
        print(r.status, r.read().decode(errors="replace").strip())
        break
    except OSError:
        import time; time.sleep(0.25)
PY
}
expect() { # expect <label> <host> <path> <wanted "status body">
  local got
  got="$(get "$2" "$3")"
  if [ "$got" = "$4" ]; then pass "$1"; else fail "$1 (got: $got)"; fi
}
expect "a plain file is served" a.hx.test /hello.txt "200 A-HELLO"
expect "PHP runs through FastCGI" a.hx.test / "200 a.hx.test"
expect "a site's link to its own file is served" a.hx.test /own.txt "200 A-HELLO"
expect "a site's linked release directory is served" a.hx.test /current/app.txt "200 A-RELEASE"
# Refused files count as missing for try_files, so the request ends at the
# site's own front controller instead of the other site's file.
expect "a link to another site's file is not followed" a.hx.test /steal.txt "200 a.hx.test"
expect "a link to another site's directory is not followed" a.hx.test /bdir/secret.txt "200 a.hx.test"
# Everything below c's www is refused, its index.php too: nginx answers 404.
got="$(get c.hx.test /secret.txt)"
case "$got" in
  "404 "*) pass "a document root replaced by a link to another site is not followed" ;;
  *) fail "a document root replaced by a link to another site is not followed (got: $got)" ;;
esac

nginx -s stop 2>/dev/null
kill "$(cat /run/php/php"$PHPV"-fpm.pid 2>/dev/null)" 2>/dev/null || pkill -f "php-fpm: master" || true

# --- P1.6: Node app unit ------------------------------------------------------
echo "== Node app unit sandbox"
U="$SCHELA_SYSTEMD_DIR/schela-app-hxapp.service"
[ -f "$U" ] || { cat /tmp/hx-apply.out; echo "FAIL app unit not written"; exit 1; }
for line in 'NoNewPrivileges=yes' 'CapabilityBoundingSet=' 'PrivateTmp=yes' 'PrivateDevices=yes' \
  'ProtectSystem=strict' 'ProtectHome=tmpfs' 'BindPaths=/home/sa_hxapp' 'ProtectKernelTunables=yes' \
  'ProtectKernelModules=yes' 'ProtectKernelLogs=yes' 'ProtectControlGroups=yes' 'ProtectClock=yes' \
  'ProtectHostname=yes' 'RestrictSUIDSGID=yes' 'RestrictRealtime=yes' 'RestrictNamespaces=yes' \
  'LockPersonality=yes' 'SystemCallArchitectures=native' \
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK'; do
  check "app unit has $line" grep -qx -- "$line" "$U"
done
check "app unit keeps User, WorkingDirectory and PORT" \
  bash -c "grep -qx 'User=sa_hxapp' '$U' && grep -qx 'WorkingDirectory=/home/sa_hxapp/app' '$U' && grep -qx 'Environment=PORT=3901' '$U'"
check "app unit sets no resource limits" bash -c "! grep -qE '^(MemoryMax|MemoryHigh|CPUQuota|TasksMax)=' '$U'"
check "app unit file is 0644" test "$(stat -c %a "$U")" = 644
if command -v systemd-analyze >/dev/null 2>&1; then
  # The real node binary is not in the container; verify the unit as written
  # with only ExecStart pointed at an existing program.
  sed 's|^ExecStart=.*|ExecStart=/bin/true|' "$U" >/tmp/schela-app-hxapp.service
  if systemd-analyze verify /tmp/schela-app-hxapp.service >/tmp/hx-verify.out 2>&1 \
    && ! grep -qi 'unknown\|invalid' /tmp/hx-verify.out; then
    pass "systemd-analyze verify accepts the app unit"
  else
    fail "systemd-analyze verify accepts the app unit: $(cat /tmp/hx-verify.out)"
  fi
  rm -f /tmp/schela-app-hxapp.service
else
  echo "skip systemd-analyze verify (not installed)"
fi

apply_now
check "an unchanged app unit does not restart the app" bash -c "! grep -q '^restart schela-app-hxapp' /tmp/hx-systemctl.log"
# A running app with the unit of an older apply restarts into the new one.
printf '[Unit]\nDescription=old\n[Service]\nNoNewPrivileges=true\nPrivateTmp=true\n' >"$U"
touch /tmp/hx-active-schela-app-hxapp
apply_now
check "a running app restarts when its unit changed" grep -qx 'restart schela-app-hxapp' /tmp/hx-systemctl.log
rm -f /tmp/hx-active-schela-app-hxapp
check "the template unit is gone (apply writes app units)" test ! -e "$INS/templates/schela-app@.service"

# The app name is free text from the panel: a newline in it must not add unit
# lines (ExecStartPre=+ would run as root).
python3 - "$SCHELA_STATE" <<'PY2'
import json, sys
p = sys.argv[1]
s = json.load(open(p))
s["apps"].append({"name": "x\nExecStartPre=+/usr/bin/touch /tmp/hx-pwned", "domain": "evil.hx.test",
                  "nodeVersion": "22", "port": 3902, "entry": "index.js", "status": "running", "ip": ""})
s["apps"].append({"name": "pct %h %i", "domain": "pct.hx.test",
                  "nodeVersion": "22", "port": 3903, "entry": "index.js", "status": "running", "ip": ""})
json.dump(s, open(p, "w"))
PY2
apply_now
EU="$(ls "$SCHELA_SYSTEMD_DIR"/schela-app-x-*.service 2>/dev/null | head -1)"
check "an app with a newline in its name still gets its unit" test -n "$EU"
check "an app name cannot add unit lines" bash -c "[ -n '$EU' ] && ! grep -q '^ExecStartPre' '$EU' && [ \"\$(grep -c '^Description=' '$EU')\" = 1 ] && [ \"\$(grep -c '^ExecStart=' '$EU')\" = 1 ]"
PU="$SCHELA_SYSTEMD_DIR/schela-app-pct-h-i.service"
check "an app name cannot use systemd specifiers" bash -c "[ -f '$PU' ] && ! grep '^Description=' '$PU' | grep -q '%'"
rm -f "$EU" "$PU" /etc/nginx/schela-apps.d/app-evil.hx.test*.conf /etc/nginx/schela-apps.d/app-pct.hx.test*.conf

# --- P1.7: fail2ban -----------------------------------------------------------
echo "== fail2ban jails"
J=/etc/fail2ban/jail.d/schela.conf
F=/etc/fail2ban/filter.d/schela-panel.conf
# jail_get <jail> <key>: the value of one key in one section of $J.
jail_get() {
  python3 - "$J" "$1" "$2" <<'PY'
import configparser, sys
c = configparser.RawConfigParser(interpolation=None)
c.read(sys.argv[1])
print(c.get(sys.argv[2], sys.argv[3], fallback=""))
PY
}
jail_is() { [ "$(jail_get "$1" "$2")" = "$3" ]; }
has_jail() { [ -f "$J" ] && grep -qx "\[$1\]" "$J"; }

check "jail file is written" test -f "$J"
check "sshd jail is enabled" jail_is sshd enabled true
ports=",$(jail_get sshd port),"
check "sshd jail covers settings.sshPort (2200)" bash -c "[[ '$ports' == *,2200,* ]]"
check "sshd jail covers the ports sshd listens on (22, 2222)" bash -c "[[ '$ports' == *,22,* && '$ports' == *,2222,* ]]"
check "sshd jail covers the port of an active ssh.socket (2022)" bash -c "[[ '$ports' == *,2022,* ]]"
check "sshd jail has no port nginx listens on" bash -c "[[ '$ports' != *,80,* ]]"
check "sshd jail reads the journal" jail_is sshd backend systemd
check "sshd jail matches sshd-session (OpenSSH 9.8+)" bash -c "[[ '$(jail_get sshd journalmatch)' == *_COMM=sshd-session* ]]"
check "schela-panel jail is enabled" jail_is schela-panel enabled true
check "schela-panel jail uses the schela-panel filter" jail_is schela-panel filter schela-panel
check "schela-panel jail bans on http and https" jail_is schela-panel port http,https
check "schela-panel jail reads the journal" jail_is schela-panel backend systemd
for j in sshd schela-panel; do
  check "$j bans through nftables" jail_is "$j" banaction 'nftables[type=multiport]'
done
check "no postfix jail while mail is off" bash -c "! grep -qx '\[postfix\]' '$J'"
check "no dovecot jail while mail is off" bash -c "! grep -qx '\[dovecot\]' '$J'"
check "no ban time, find time or retry count of our own" bash -c "! grep -qE '^(bantime|findtime|maxretry)' '$J'"
check "fail2ban was reloaded after the jails changed" grep -qx 'reload-or-restart fail2ban' /tmp/hx-systemctl.first
check "fail2ban -t accepts the configuration" bash -c "fail2ban-client -t >/dev/null 2>&1"

# The jail file of the earlier applies is unchanged by this one.
apply_now
check "unchanged jails do not reload fail2ban" bash -c "! grep -q 'fail2ban' /tmp/hx-systemctl.log"

write_state true 2200
apply_now
check "postfix jail is enabled with the mail module" jail_is postfix enabled true
check "postfix jail uses mode=aggressive" jail_is postfix mode aggressive
check "postfix jail matches postfix@-.service" bash -c "[[ '$(jail_get postfix journalmatch)' == *_SYSTEMD_UNIT=postfix@-.service* ]]"
check "postfix jail reads the journal" jail_is postfix backend systemd
check "dovecot jail is enabled with the mail module" jail_is dovecot enabled true
check "dovecot jail reads the journal" jail_is dovecot backend systemd
for j in postfix dovecot; do
  check "$j bans through nftables" jail_is "$j" banaction 'nftables[type=multiport]'
done
check "fail2ban -t accepts the configuration with mail jails" bash -c "fail2ban-client -t >/dev/null 2>&1"

echo "== fail2ban schela-panel filter"
regex_hits() { # regex_hits <log line>: number of lines the filter matches
  printf '%s\n' "$1" >/tmp/hx-f2b.log
  fail2ban-regex /tmp/hx-f2b.log "$F" 2>/dev/null | sed -n 's/^Lines: .* \([0-9]*\) matched.*/\1/p'
}
P='Nov 13 10:00:00 panel node[812]:'
check "matches the panel's line (IPv4)" test "$(regex_hits "$P schela-auth: failed sign-in from 203.0.113.5")" = 1
check "matches the panel's line (IPv6)" test "$(regex_hits "$P schela-auth: failed sign-in from 2001:db8::5")" = 1
check "ignores a successful sign-in" test "$(regex_hits "$P schela-auth: successful sign-in from 203.0.113.5")" = 0
check "ignores text after the address" test "$(regex_hits "$P schela-auth: failed sign-in from 203.0.113.5 by admin")" = 0
check "ignores the line inside another message" test "$(regex_hits "$P error: user x schela-auth: failed sign-in from 203.0.113.5")" = 0
check "ignores a host name instead of an address" test "$(regex_hits "$P schela-auth: failed sign-in from evil.example")" = 0
check "ignores another prefix" test "$(regex_hits "$P schela-authz: failed sign-in from 203.0.113.5")" = 0
check "filter reads the panel's journal" grep -qx 'journalmatch = _SYSTEMD_UNIT=schela-panel.service' "$F"

echo "== fail2ban config test failure"
before="$(cat "$J")"
printf '#!/bin/sh\n[ "$1" = "-t" ] && exit 1\nexit 0\n' >"$STUBS/fail2ban-client"
chmod 755 "$STUBS/fail2ban-client"
write_state true 2300
apply_now
rm -f "$STUBS/fail2ban-client"
check "a refused configuration is rolled back" test "$(cat "$J")" = "$before"
check "a refused configuration does not reload fail2ban" bash -c "! grep -q 'fail2ban' /tmp/hx-systemctl.log"
check "a refused configuration is reported" grep -q 'fail2ban: configuration test failed' /tmp/hx-apply.out

echo "== install.sh fail2ban"
section="$(sed -n '/^log "Fail2ban"/,/^log /p' "$INS/install.sh")"
check "install.sh installs python3-systemd and nftables for the jails" \
  grep -q 'apt-get install -y --no-install-recommends python3-systemd nftables' <<<"$section"
check "install.sh writes no jail configuration (schela-apply does)" \
  bash -c "! grep -qE 'jail\.(local|d)|filter\.d' '$INS/install.sh'"

# Leave the container as the other tests expect it.
rm -f "$J" "$F" /etc/nginx/conf.d/schela-includes.conf /etc/nginx/schela.d/site-*.hx.test*.conf \
  /etc/nginx/schela-apps.d/app-hxapp.hx.test*.conf /etc/php/*/fpm/pool.d/schela-hx-*.conf
rm -rf "$SCHELA_SYSTEMD_DIR" "$STUBS" /tmp/hx-*
for u in s_hxa s_hxb s_hxc sa_hxapp; do
  gpasswd -d www-data "$u" >/dev/null 2>&1 || true
  userdel -r "$u" >/dev/null 2>&1 || true
done
# The distro PHP-FPM is only here for this script: with its config in place
# every later apply would enable and reload it, which other cases count.
rm -rf "/etc/php/$PHPV/fpm"

if [ "$FAILS" -gt 0 ]; then
  printf 'hardening: %d case(s) failed\n' "$FAILS"
  exit 1
fi
echo "hardening: all cases passed"
