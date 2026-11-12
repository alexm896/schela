#!/bin/bash
# installer/lib.sh: supported systems, PHP package set, PHP repository source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

echo "== installer lib"
[ -f "$INS/lib.sh" ] || fail "installer/lib.sh missing"
# shellcheck source=installer/lib.sh
. "$INS/lib.sh"

for os in ubuntu-22.04 ubuntu-24.04 ubuntu-26.04 debian-12 debian-13; do
  os_supported "${os%%-*}" "${os#*-}" || fail "$os should be supported"
done
pass "Ubuntu 22.04, 24.04, 26.04 and Debian 12, 13 are supported"

for os in ubuntu-20.04 ubuntu-25.10 debian-11 fedora-41 ubuntu-26.04.1 ubuntu-; do
  if os_supported "${os%%-*}" "${os#*-}"; then fail "$os should not be supported"; fi
done
pass "other systems are refused"

grep -q 'os_supported "${ID:-}" "${VERSION_ID:-}"' "$INS/install.sh" || fail "install.sh does not use os_supported"
pass "install.sh gates on os_supported"

[ "$(versions_list "$INS/versions.json" php supported | tr '\n' ' ')" = "8.2 8.3 8.4 8.5 " ] || fail "php supported list"
[ "$(versions_list "$INS/versions.json" node default)" = "26" ] || fail "node default"
pass "versions_list reads installer/versions.json"

pkgs="$(php_packages 8.4 8.5)"
grep -qx php8.4-opcache <<<"$pkgs" || fail "php8.4-opcache missing"
! grep -qx php8.5-opcache <<<"$pkgs" || fail "php8.5-opcache requested (does not exist: OPcache is built in)"
[ "$(grep -c '^php8.4-' <<<"$pkgs")" -eq 14 ] && [ "$(grep -c '^php8.5-' <<<"$pkgs")" -eq 13 ] || fail "package counts"
grep -qx php8.5-fpm <<<"$pkgs" && grep -qx php8.5-mysql <<<"$pkgs" || fail "php8.5 core packages"
pass "PHP package set: 14 per version, 13 from 8.5 on (no opcache package)"

src="$(sury_sources resolute)"
grep -qx 'URIs: https://packages.sury.org/php/' <<<"$src" || fail "sury URI"
grep -qx 'Suites: resolute' <<<"$src" || fail "sury suite"
grep -qx "Signed-By: $SURY_KEYRING" <<<"$src" || fail "sury Signed-By"
pass "PHP repository source is deb822 and pinned to the sury keyring"

[[ "$N_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$N_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "n pin"
! grep -q 'tj/n/master' "$INS/install.sh" || fail "install.sh still downloads n from master"
pass "n is pinned to ${N_VERSION} with a sha256"
