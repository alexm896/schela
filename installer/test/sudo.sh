#!/bin/bash
# The sudoers template under every sudo this OS ships (sudo, and sudo-rs where
# it exists: the default on Ubuntu 26.04). Run as root in the test container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

echo "== sudo rules"
command -v sudo >/dev/null || { echo "skip sudo (not installed)"; exit 0; }
id -u schela >/dev/null 2>&1 || useradd --system --home /var/lib/schela --shell /usr/sbin/nologin schela

stubs=(schela-apply schela schela-files schela-workers schela-backup schela-db schela-purge schela-search)
for b in "${stubs[@]}"; do
  [ ! -e "/usr/local/sbin/$b" ] || mv "/usr/local/sbin/$b" "/usr/local/sbin/$b.keep"
  printf '#!/bin/sh\necho RAN\n' >"/usr/local/sbin/$b"
  chmod 755 "/usr/local/sbin/$b"
done
mkdir -p /etc/sudoers.d
install -m 0440 "$INS/templates/sudoers" /etc/sudoers.d/schela
cleanup() {
  rm -f /etc/sudoers.d/schela
  for b in "${stubs[@]}"; do
    rm -f "/usr/local/sbin/$b"
    [ ! -e "/usr/local/sbin/$b.keep" ] || mv "/usr/local/sbin/$b.keep" "/usr/local/sbin/$b"
  done
}
trap cleanup EXIT

cases=(
  "allow|/usr/local/sbin/schela-apply"
  "allow|/usr/local/sbin/schela-apply --dry-run"
  "allow|/usr/local/sbin/schela fix"
  "allow|/usr/local/sbin/schela-files"
  "allow|/usr/local/sbin/schela-workers"
  "allow|/usr/local/sbin/schela-backup run 1"
  "allow|/usr/local/sbin/schela-backup cron"
  "deny|/usr/local/sbin/schela-backup cron x"
  "deny|/usr/local/sbin/schela-backup"
  "deny|/usr/local/sbin/schela-backup restore 1"
  "allow|/usr/local/sbin/schela-db"
  "deny|/usr/local/sbin/schela-db sync"
  "allow|/usr/local/sbin/schela-purge"
  "deny|/usr/local/sbin/schela-purge x"
  "allow|/usr/local/sbin/schela-search"
  "deny|/usr/local/sbin/schela-search info"
  "deny|/bin/id"
)

impls="$(update-alternatives --list sudo 2>/dev/null || true)"
[ -n "$impls" ] || impls="$(readlink -f "$(command -v sudo)")"
default="$(readlink -f "$(command -v sudo)")"
for impl in $impls; do
  if [ "$impl" != "$default" ]; then
    update-alternatives --set sudo "$impl" >/dev/null
  fi
  name="$("$impl" --version 2>/dev/null | head -1)"
  visudo -cf /etc/sudoers.d/schela >/dev/null || fail "$name: visudo rejects the template"
  for c in "${cases[@]}"; do
    want="${c%%|*}"
    read -r -a cmd <<<"${c#*|}"
    if out="$(runuser -u schela -- sudo -n "${cmd[@]}" 2>&1)" && [ "$out" = "RAN" ]; then got=allow; else got=deny; fi
    [ "$got" = "$want" ] || fail "$name: sudo -n ${cmd[*]} was ${got}ed, expected $want"
  done
  pass "$name: template valid, ${#cases[@]} pinned commands behave"
done
[ "$(readlink -f "$(command -v sudo)")" = "$default" ] || update-alternatives --set sudo "$default" >/dev/null
