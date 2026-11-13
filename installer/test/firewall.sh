#!/bin/bash
# The firewall and automatic updates against the real ufw, sshd and apt-config:
# apply_firewall and apply_auto_updates from schela-apply, and the matching
# install.sh sections. Root in the test container, with NET_ADMIN
# (installer/test/docker.sh runs it so). Every case runs on its own and the
# script fails at the end if any case failed.
# No pipefail: checks like `sshd -T | grep -q` would fail at random on SIGPIPE.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
export SCHELA_VERSIONS="${SCHELA_VERSIONS:-$INS/versions.json}"
export SCHELA_TEMPLATES="${SCHELA_TEMPLATES:-/usr/local/share/schela/templates}"
export SCHELA_STATE=/tmp/schela-fw-state.json
FAILED=()
OUT=/tmp/schela-fw.out

echo "== firewall (real ufw, sshd and apt-config)"
for bin in ufw sshd ss iptables ip6tables apt-config; do
  command -v "$bin" >/dev/null || { echo "FAIL $bin is missing from the test image"; exit 1; }
done
iptables -S INPUT >/dev/null 2>&1 \
  || { echo "FAIL iptables is not usable: run the container with --cap-add NET_ADMIN"; exit 1; }
UFW_BIN="$(command -v ufw)"
SSHD_CONF=/etc/ssh/sshd_config.d/schela-test.conf
mkdir -p /etc/ssh/sshd_config.d /usr/local/share/schela/templates
[ -n "$(ls -A /usr/local/share/schela/templates)" ] || cp -a "$INS/templates/." /usr/local/share/schela/templates/

# schela-apply up to its main flow: the functions, without applying anything.
APPLY_LIB=/tmp/schela-apply-lib.sh
sed '/^log "applying /,$d' "$INS/schela-apply" >"$APPLY_LIB"
apply() { ( source "$APPLY_LIB"; "$@" ) >"$OUT" 2>&1; }
apply_fw() { apply apply_firewall || { cat "$OUT"; return 1; }; }

# write_state SSH_PORT MODULES_JSON RULES_JSON [AUTO_UPDATES]
write_state() {
  jq -n --argjson ssh "$1" --argjson m "$2" --argjson r "$3" --argjson a "${4:-true}" \
    '{settings: {hostname: "fw.schela-ci.dev", isolation: true, sshPort: $ssh, autoUpdates: $a},
      modules: $m, sites: [], apps: [], firewall: $r, mailboxes: [], cron: [], backups: [],
      dns: {zones: []}}' >"$SCHELA_STATE"
}
rule() { # action protocol port source [enabled]
  jq -nc --arg a "$1" --arg p "$2" --arg port "$3" --arg s "$4" --argjson e "${5:-true}" \
    '{enabled: $e, action: $a, protocol: $p, port: $port, source: $s}'
}

held() { LC_ALL=C "$UFW_BIN" show added | sed -n 's/^ufw //p' | sort; }
has() { held | grep -qxF "$1"; }
active() { LC_ALL=C "$UFW_BIN" status | grep -qx 'Status: active'; }
v4() { iptables -S ufw-user-input; }
v6() { ip6tables -S ufw6-user-input; }
# open4/open6 PORT PROTO: accepted from everywhere in the live table.
open4() { v4 | grep -qx -- "-A ufw-user-input -p $2 -m $2 --dport $1 -j ACCEPT"; }
open6() { v6 | grep -qx -- "-A ufw6-user-input -p $2 -m $2 --dport $1 -j ACCEPT"; }
# line CHAIN_OUTPUT REGEX: line number of the first match, 0 when none.
line() { grep -nE -- "$2" <<<"$1" | head -1 | cut -d: -f1 | grep . || echo 0; }
rules_hash() { cat /etc/ufw/user.rules /etc/ufw/user6.rules | sha256sum; }

reset_fw() {
  "$UFW_BIN" --force reset >/dev/null 2>&1
  rm -f /etc/ufw/*.rules.[0-9]* /etc/ufw/*.rules.*_[0-9]* 2>/dev/null
  rm -f "$SSHD_CONF"
  pkill -f 'sshd -o Port=2022' 2>/dev/null
  return 0
}

TOTAL=0
t() { # name, function
  local name="$1"
  shift
  TOTAL=$((TOTAL + 1))
  reset_fw
  CASE_ERR=0
  if "$@" && [ "$CASE_ERR" -eq 0 ]; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name" >&2
    FAILED+=("$name")
  fi
}
# Every check that fails reports, and the case fails even if later checks pass.
err() { printf '     %s\n' "$*" >&2; CASE_ERR=1; return 1; }

# --- schela-apply: firewall --------------------------------------------------

fresh_box() {
  write_state 22 '{}' '[]'
  apply_fw || return 1
  active || err "ufw is not active"
  [ "$(held | tr '\n' ',')" = "allow 22/tcp,allow 443/tcp,allow 80/tcp," ] || err "rules: $(held | tr '\n' ',')"
  for p in 22 80 443; do
    open4 "$p" tcp || err "$p/tcp not open on IPv4"
    open6 "$p" tcp || err "$p/tcp not open on IPv6"
  done
  grep -qx 'DEFAULT_INPUT_POLICY="DROP"' /etc/default/ufw || err "incoming policy is not deny"
}

unchanged_state() {
  write_state 22 '{"mail":true}' "[$(rule allow tcp 8080 any), $(rule deny tcp 80 192.0.2.1)]"
  apply_fw || return 1
  local before
  before="$(rules_hash)"
  apply_fw || return 1
  [ "$(rules_hash)" = "$before" ] || err "a second apply rewrote the rules"
}

rule_turned_off() {
  write_state 22 '{}' "[$(rule allow tcp 8080 any)]"
  apply_fw && open4 8080 tcp && open6 8080 tcp || err "8080/tcp was not opened"
  write_state 22 '{}' "[$(rule allow tcp 8080 any false)]"
  apply_fw || return 1
  ! has "allow 8080/tcp" || err "rule turned off is still in ufw"
  ! open4 8080 tcp && ! open6 8080 tcp || err "8080/tcp still open"
}

rule_deleted() {
  write_state 22 '{}' "[$(rule allow udp 5000 any), $(rule allow tcp 6000 203.0.113.0/24)]"
  apply_fw && has "allow 5000/udp" && has "allow from 203.0.113.0/24 to any port 6000 proto tcp" \
    || err "rules were not added"
  write_state 22 '{}' '[]'
  apply_fw || return 1
  ! has "allow 5000/udp" && ! has "allow from 203.0.113.0/24 to any port 6000 proto tcp" \
    || err "deleted rules are still in ufw: $(held | tr '\n' ',')"
}

deny_wins() {
  write_state 22 '{}' "[$(rule deny tcp 80 192.0.2.1), $(rule deny any 443 2001:db8::1)]"
  apply_fw || return 1
  has "deny from 192.0.2.1 to any port 80 proto tcp" || err "IPv4 deny missing: $(held | tr '\n' ',')"
  has "deny from 2001:db8::1 to any port 443" || err "IPv6 deny missing: $(held | tr '\n' ',')"
  local c4 c6 d a
  c4="$(v4)"
  c6="$(v6)"
  d="$(line "$c4" '^-A ufw-user-input -s 192.0.2.1/32 -p tcp -m tcp --dport 80 -j DROP$')"
  a="$(line "$c4" '^-A ufw-user-input -p tcp -m tcp --dport 80 -j ACCEPT$')"
  [ "$d" -gt 0 ] && [ "$a" -gt 0 ] && [ "$d" -lt "$a" ] || err "IPv4: deny at line $d, allow 80 at line $a"$'\n'"$c4"
  d="$(line "$c6" '^-A ufw6-user-input -s 2001:db8::1/128 -p tcp -m tcp --dport 443 -j DROP$')"
  a="$(line "$c6" '^-A ufw6-user-input -p tcp -m tcp --dport 443 -j ACCEPT$')"
  [ "$d" -gt 0 ] && [ "$a" -gt 0 ] && [ "$d" -lt "$a" ] || err "IPv6: deny at line $d, allow 443 at line $a"$'\n'"$c6"
}

deny_replaces_base() {
  write_state 22 '{}' "[$(rule deny tcp 443 any)]"
  apply_fw || return 1
  has "deny 443/tcp" && ! has "allow 443/tcp" || err "rules: $(held | tr '\n' ',')"
  v4 | grep -qx -- '-A ufw-user-input -p tcp -m tcp --dport 443 -j DROP' || err "443/tcp not dropped on IPv4"
  v6 | grep -qx -- '-A ufw6-user-input -p tcp -m tcp --dport 443 -j DROP' || err "443/tcp not dropped on IPv6"
}

allow_becomes_deny() {
  write_state 22 '{}' "[$(rule allow tcp 9000 198.51.100.0/24), $(rule allow tcp 9001 any)]"
  apply_fw || return 1
  write_state 22 '{}' "[$(rule deny tcp 9000 198.51.100.0/24), $(rule allow tcp 9001 any)]"
  apply_fw || return 1
  has "deny from 198.51.100.0/24 to any port 9000 proto tcp" || err "deny missing: $(held | tr '\n' ',')"
  local c d a
  c="$(v4)"
  d="$(line "$c" 'dport 9000 -j DROP$')"
  a="$(line "$c" '-j ACCEPT$')"
  [ "$d" -gt 0 ] && [ "$d" -lt "$a" ] || err "deny at line $d, first allow at line $a"$'\n'"$c"
}

ssh_never_denied_to_all() {
  write_state 22 '{}' "[$(rule deny tcp 22 any), $(rule deny any 22 0.0.0.0/0), $(rule deny tcp 22 192.0.2.9)]"
  apply_fw || return 1
  has "allow 22/tcp" && open4 22 tcp && open6 22 tcp || err "SSH closed: $(held | tr '\n' ',')"
  ! has "deny 22/tcp" && ! has "deny 22" || err "deny-all on SSH applied"
  grep -q "kept SSH open" "$OUT" || err "skipped deny not logged"
  has "deny from 192.0.2.9 to any port 22 proto tcp" || err "deny of one source on SSH not applied"
}

module_ports() {
  write_state 22 '{"mail":true,"dns":true}' '[]'
  apply_fw || return 1
  for r in "allow 25/tcp" "allow 587/tcp" "allow 993/tcp" "allow 53/tcp" "allow 53/udp"; do
    has "$r" || err "$r missing"
  done
  ! has "allow 143/tcp" && ! has "allow 143" || err "143 is open"
  open4 53 udp && open6 53 udp || err "53/udp not open on both families"
  write_state 22 '{"mail":false,"dns":false}' '[]'
  apply_fw || return 1
  [ "$(held | tr '\n' ',')" = "allow 22/tcp,allow 443/tcp,allow 80/tcp," ] \
    || err "module ports still open: $(held | tr '\n' ',')"
}

legacy_rules_removed() {
  "$UFW_BIN" allow 22/tcp >/dev/null
  "$UFW_BIN" allow 53 >/dev/null
  "$UFW_BIN" allow 993/tcp >/dev/null
  "$UFW_BIN" allow 3306/tcp comment 'by hand' >/dev/null
  "$UFW_BIN" limit 2222/tcp >/dev/null
  "$UFW_BIN" allow from 203.0.113.0/24 >/dev/null
  "$UFW_BIN" allow from 2001:db8::/32 to any port 5432 proto tcp >/dev/null
  "$UFW_BIN" --force enable >/dev/null
  write_state 22 '{}' '[]'
  apply_fw || return 1
  [ "$(held | tr '\n' ',')" = "allow 22/tcp,allow 443/tcp,allow 80/tcp," ] \
    || err "left over: $(held | tr '\n' ',')"
  ! v6 | grep -q 'dport 5432' || err "IPv6-only rule left in the live table"
}

ssh_setting_opened() {
  write_state 2222 '{}' '[]'
  apply_fw || return 1
  has "allow 2222/tcp" || err "2222/tcp from the setting missing"
  has "allow 22/tcp" || err "22/tcp closed although sshd is configured for it"
}

ssh_configured_port_kept() {
  printf 'Port 2200\n' >"$SSHD_CONF"
  sshd -T | grep -qx 'port 2200' || err "test setup: sshd -T does not report port 2200"
  write_state 22 '{}' '[]'
  apply_fw || return 1
  has "allow 2200/tcp" || err "2200/tcp (sshd_config) missing: $(held | tr '\n' ',')"
}

ssh_listening_port_kept() {
  mkdir -p /run/sshd
  "$(command -v sshd)" -o Port=2022 || return 1
  for _ in $(seq 1 20); do ss -Hltnp | grep -q ':2022 .*"sshd"' && break; sleep 0.2; done
  ss -Hltnp | grep -q ':2022 .*"sshd"' || err "test setup: sshd is not listening on 2022"
  write_state 22 '{}' '[]'
  apply_fw || return 1
  has "allow 2022/tcp" || err "2022/tcp (sshd listening) missing: $(held | tr '\n' ',')"
}

ssh_old_port_closed() {
  printf 'Port 2200\n' >"$SSHD_CONF"
  "$UFW_BIN" allow 22/tcp >/dev/null
  write_state 2200 '{}' '[]'
  apply_fw || return 1
  has "allow 2200/tcp" || err "2200/tcp missing"
  ! has "allow 22/tcp" || err "22/tcp still open although neither the setting nor sshd use it"
}

ssh_always_allowed() {
  # A legacy box (SSH under `limit`, stray ports, an old deny), then one run
  # that changes actions in place, removes, adds and reorders. A ufw wrapper
  # checks SSH and ufw's state after every call.
  "$UFW_BIN" limit 22/tcp >/dev/null
  "$UFW_BIN" allow 53 >/dev/null
  "$UFW_BIN" deny 8080/tcp >/dev/null
  "$UFW_BIN" allow from 198.51.100.0/24 to any port 9000 proto tcp >/dev/null
  "$UFW_BIN" --force enable >/dev/null
  printf 'Port 22\nPort 2200\n' >"$SSHD_CONF"
  cat >/usr/local/sbin/ufw <<SH
#!/bin/bash
v=/tmp/ufw-violations.log
case " \$* " in *" reset "*|*" disable "*) echo "forbidden: ufw \$*" >>\$v ;; esac
"$UFW_BIN" "\$@"; rc=\$?
iptables -S ufw-user-input | grep -qxE -- '-A ufw-user-input -p tcp -m tcp --dport 22 -j (ACCEPT|ufw-user-limit-accept)' || echo "no IPv4 SSH after: ufw \$*" >>\$v
ip6tables -S ufw6-user-input | grep -qxE -- '-A ufw6-user-input -p tcp -m tcp --dport 22 -j (ACCEPT|ufw6-user-limit-accept)' || echo "no IPv6 SSH after: ufw \$*" >>\$v
LC_ALL=C "$UFW_BIN" status | grep -qx 'Status: active' || echo "inactive after: ufw \$*" >>\$v
exit \$rc
SH
  chmod 755 /usr/local/sbin/ufw
  : >/tmp/ufw-violations.log
  write_state 2200 '{"mail":true}' \
    "[$(rule deny tcp 9000 198.51.100.0/24), $(rule deny tcp 22 192.0.2.5), $(rule allow tcp 8080 any)]"
  local ok=0
  apply_fw || ok=1
  rm -f /usr/local/sbin/ufw
  [ "$ok" -eq 0 ] || return 1
  [ ! -s /tmp/ufw-violations.log ] || err "$(cat /tmp/ufw-violations.log)"
  has "allow 22/tcp" && has "allow 2200/tcp" && has "allow 25/tcp" && has "allow 8080/tcp" && ! has "allow 53" \
    && has "deny from 198.51.100.0/24 to any port 9000 proto tcp" || err "did not converge: $(held | tr '\n' ',')"
}

old_deny_becomes_allow() {
  "$UFW_BIN" deny 8080/tcp >/dev/null
  "$UFW_BIN" allow 22/tcp >/dev/null
  write_state 22 '{}' "[$(rule allow tcp 8080 any), $(rule deny tcp 80 192.0.2.1)]"
  apply_fw || return 1
  has "allow 8080/tcp" && ! has "deny 8080/tcp" || err "rules: $(held | tr '\n' ',')"
  local c d a
  c="$(v4)"
  d="$(line "$c" '-s 192.0.2.1/32 .*dport 80 -j DROP$')"
  a="$(line "$c" '-j ACCEPT$')"
  [ "$d" -gt 0 ] && [ "$d" -lt "$a" ] || err "deny at line $d, first allow at line $a"$'\n'"$c"
}

invalid_rules_skipped() {
  write_state 22 '{}' "[$(rule allow tcp 80-90 any), $(rule allow tcp 8443 nonsense), $(rule allow icmp 8444 any), $(rule allow tcp 8446 fe80::1%eth0), $(rule allow tcp 8445 any)]"
  apply_fw || return 1
  has "allow 8445/tcp" || err "valid rule not applied"
  [ "$(grep -c 'skipped invalid rule' "$OUT")" -eq 4 ] || err "invalid rules not logged: $(cat "$OUT")"
}

sources_converge() {
  write_state 22 '{}' "[$(rule allow tcp 8080 10.1.2.3/8), $(rule allow tcp 8080 2001:DB8::5/64), $(rule allow tcp 8080 192.0.2.7/32), $(rule allow tcp 8090 0.0.0.0/0)]"
  apply_fw || return 1
  has "allow from 10.0.0.0/8 to any port 8080 proto tcp" && has "allow from 2001:db8::/64 to any port 8080 proto tcp" \
    && has "allow from 192.0.2.7 to any port 8080 proto tcp" && has "allow 8090/tcp" || err "rules: $(held | tr '\n' ',')"
  local before
  before="$(rules_hash)"
  apply_fw || return 1
  [ "$(rules_hash)" = "$before" ] || err "a second apply rewrote the rules"
}

dry_run_touches_nothing() {
  write_state 22 '{"mail":true}' "[$(rule allow tcp 8080 any)]"
  local before
  before="$(rules_hash)"
  ( source "$APPLY_LIB"; DRY=1; apply_firewall ) >"$OUT" 2>&1 || { cat "$OUT"; return 1; }
  [ "$(rules_hash)" = "$before" ] && ! active || err "dry run changed ufw"
  grep -q 'ufw allow 25/tcp' "$OUT" || err "dry run does not list the rules: $(cat "$OUT")"
}

# --- schela-apply: automatic updates ----------------------------------------

# The value apt itself reads, after every file in apt.conf.d.
periodic() { local V=""; eval "$(apt-config shell V "APT::Periodic::$1")"; echo "$V"; }

auto_updates_off() {
  write_state 22 '{}' '[]' false
  apply apply_auto_updates || { cat "$OUT"; return 1; }
  [ "$(periodic Update-Package-Lists)" = 0 ] && [ "$(periodic Unattended-Upgrade)" = 0 ] \
    || err "apt-config: Update-Package-Lists=$(periodic Update-Package-Lists) Unattended-Upgrade=$(periodic Unattended-Upgrade)"
}

auto_updates_on() {
  write_state 22 '{}' '[]' false
  apply apply_auto_updates
  write_state 22 '{}' '[]' true
  apply apply_auto_updates || { cat "$OUT"; return 1; }
  [ "$(periodic Update-Package-Lists)" = 1 ] && [ "$(periodic Unattended-Upgrade)" = 1 ] || err "not on after true"
  jq 'del(.settings.autoUpdates)' "$SCHELA_STATE" >"$SCHELA_STATE.tmp" && mv "$SCHELA_STATE.tmp" "$SCHELA_STATE"
  apply apply_auto_updates || { cat "$OUT"; return 1; }
  [ "$(periodic Unattended-Upgrade)" = 1 ] || err "not on when the setting is missing"
}

main_flow_calls_both() {
  grep -qx 'apply_firewall' "$INS/schela-apply" && grep -qx 'apply_auto_updates' "$INS/schela-apply" \
    || err "schela-apply does not call apply_firewall and apply_auto_updates"
  # Code only: comments may name the commands.
  ! grep -vE '^[[:space:]]*#' "$INS/schela-apply" | grep -qE 'ufw (--force )?(reset|disable)' \
    || err "schela-apply resets or disables ufw"
}

# --- install.sh sections ------------------------------------------------------

# install_section FIRST_LOG NEXT_LOG: run install.sh from one log line to the next.
install_section() {
  sed -n "/^log \"$1\"\$/,/^log \"$2\"\$/p" "$INS/install.sh" | sed '1d;$d' >/tmp/schela-section.sh
  [ -s /tmp/schela-section.sh ] || { echo "no install.sh section $1"; return 1; }
  # MODULES_CSV as install.sh sets it by default.
  MODULES_CSV=php,node,firewall,ssl,mail,dns \
    bash -c 'set -euo pipefail; log() { :; }; . /tmp/schela-section.sh' >"$OUT" 2>&1 || { cat "$OUT"; return 1; }
}

install_keeps_rules() {
  "$UFW_BIN" allow 22/tcp >/dev/null
  "$UFW_BIN" allow 8080/tcp >/dev/null
  "$UFW_BIN" prepend deny from 192.0.2.1 to any port 80 proto tcp >/dev/null 2>&1 \
    || "$UFW_BIN" insert 1 deny from 192.0.2.1 to any port 80 proto tcp >/dev/null
  "$UFW_BIN" --force enable >/dev/null
  install_section Firewall "Unattended upgrades" || return 1
  active || err "ufw is not active after install.sh"
  has "allow 8080/tcp" && has "deny from 192.0.2.1 to any port 80 proto tcp" \
    || err "install.sh dropped the panel's rules: $(held | tr '\n' ',')"
  has "allow 80/tcp" && has "allow 443/tcp" && has "allow 22/tcp" || err "base missing: $(held | tr '\n' ',')"
}

install_base_only() {
  printf 'Port 2200\n' >"$SSHD_CONF"
  install_section Firewall "Unattended upgrades" || return 1
  active || err "ufw is not active after install.sh"
  [ "$(held | tr '\n' ',')" = "allow 2200/tcp,allow 443/tcp,allow 80/tcp," ] \
    || err "install.sh base: $(held | tr '\n' ',')"
  grep -qx 'IPV6=yes' /etc/default/ufw || err "IPv6 is off"
}

install_auto_updates() {
  local saved=""
  [ -f /var/lib/schela/state.json ] && saved="$(cat /var/lib/schela/state.json)"
  mkdir -p /var/lib/schela
  printf '{"settings":{"autoUpdates":false}}\n' >/var/lib/schela/state.json
  local r=0
  install_section "Unattended upgrades" Fail2ban || r=1
  [ "$(periodic Unattended-Upgrade)" = 0 ] && [ "$(periodic Update-Package-Lists)" = 0 ] \
    || { err "install.sh ignored autoUpdates=false"; r=1; }
  rm -f /var/lib/schela/state.json
  install_section "Unattended upgrades" Fail2ban || r=1
  [ "$(periodic Unattended-Upgrade)" = 1 ] || { err "install.sh: not on without a saved state"; r=1; }
  grep -qx 'Unattended-Upgrade::Automatic-Reboot "false";' /etc/apt/apt.conf.d/52schela || { err "52schela"; r=1; }
  [ -z "$saved" ] || printf '%s\n' "$saved" >/var/lib/schela/state.json
  return "$r"
}

t "fresh box: SSH, HTTP, HTTPS on IPv4 and IPv6, ufw on, incoming denied" fresh_box
t "unchanged state: a second apply leaves ufw alone" unchanged_state
t "a rule turned off in the panel closes its port" rule_turned_off
t "a rule deleted in the panel closes its port" rule_deleted
t "deny rules are applied above the allows they override (IPv4 and IPv6)" deny_wins
t "a deny on the exact match of a base allow replaces it" deny_replaces_base
t "an allow that becomes a deny moves above every allow" allow_becomes_deny
t "deny-all on an SSH port is refused, a deny of one source is applied" ssh_never_denied_to_all
t "mail opens 25, 587, 993 (not 143), DNS opens 53 tcp+udp, off closes them" module_ports
t "rules from older installs or added by hand are removed" legacy_rules_removed
t "SSH: the port from the setting is opened" ssh_setting_opened
t "SSH: the port in sshd_config stays open whatever the setting" ssh_configured_port_kept
t "SSH: a port sshd listens on stays open" ssh_listening_port_kept
t "SSH: a port neither the setting nor sshd uses is closed" ssh_old_port_closed
t "SSH allowed and ufw active after every ufw call; no reset or disable" ssh_always_allowed
t "an old deny that becomes an allow does not end up above the panel's denies" old_deny_becomes_allow
t "invalid rules are skipped and logged, valid ones applied" invalid_rules_skipped
t "sources are written as ufw stores them, so applies converge" sources_converge
t "dry run lists the rules and touches nothing" dry_run_touches_nothing
t "autoUpdates false: apt periodic refresh and unattended-upgrades off" auto_updates_off
t "autoUpdates true or missing: both on" auto_updates_on
t "main flow calls apply_firewall and apply_auto_updates, never resets ufw" main_flow_calls_both
t "install.sh Firewall keeps the rules the panel applied" install_keeps_rules
t "install.sh Firewall: base only (sshd ports, 80, 443), IPv6 on" install_base_only
t "install.sh Unattended upgrades follows the saved setting" install_auto_updates

reset_fw
"$UFW_BIN" --force disable >/dev/null 2>&1
rm -f "$SCHELA_STATE" "$APPLY_LIB"
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf 'FAIL firewall: %s of %s cases failed\n' "${#FAILED[@]}" "$TOTAL" >&2
  exit 1
fi
echo "ok   firewall: all $TOTAL cases passed"
