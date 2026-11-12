#!/bin/bash
# Network test: the PHP repository and the pinned n install every version in
# installer/versions.json on this OS. Run as root in a fresh container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
CATALOG="$INS/versions.json"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

# shellcheck source=installer/lib.sh
. "$INS/lib.sh"
# shellcheck disable=SC1091
. /etc/os-release

echo "== packages on ${PRETTY_NAME}"
os_supported "$ID" "$VERSION_ID" || fail "$ID $VERSION_ID is not in the supported list"
pass "$ID $VERSION_ID is supported"

apt-get update -y >/dev/null
# The same prerequisites install.sh puts in before PHP and Node (libatomic1:
# the official Node binaries link against it).
apt-get install -y --no-install-recommends ca-certificates curl jq libatomic1 >/dev/null

# Leftovers of older installs: ppa:ondrej/php (no 26.04 build, and its changed
# label stops apt-get update on 22.04/24.04) and the old php.list without Signed-By.
L=/etc/apt/sources.list.d
printf 'deb https://ppa.launchpadcontent.net/ondrej/php/ubuntu %s main\n' "$VERSION_CODENAME" >"$L/ondrej-ubuntu-php-$VERSION_CODENAME.list"
printf 'Types: deb\nURIs: https://ppa.launchpadcontent.net/ondrej/php/ubuntu\nSuites: %s\nComponents: main\n' "$VERSION_CODENAME" \
  >"$L/ondrej-ubuntu-php-$VERSION_CODENAME.sources"
printf 'deb https://packages.sury.org/php/ %s main\n' "$VERSION_CODENAME" >"$L/php.list"
mkdir -p /etc/apt/trusted.gpg.d && : >/etc/apt/trusted.gpg.d/ondrej-ubuntu-php.gpg

setup_php_repo "$VERSION_CODENAME" >/dev/null
grep -qx "Signed-By: $SURY_KEYRING" "$SURY_SOURCES" || fail "PHP source is not pinned to its keyring"
left="$(ls "$L"/ondrej-ubuntu-php-* "$L/php.list" /etc/apt/trusted.gpg.d/ondrej-ubuntu-php* 2>/dev/null || true)"
[ -z "$left" ] || fail "old PHP sources left behind: $left"
pass "old ondrej PPA and unsigned php.list sources are removed"
apt-get update -y >/tmp/apt-update.log 2>&1 || { cat /tmp/apt-update.log; fail "apt-get update with the PHP repo"; }
pass "packages.sury.org/php for $VERSION_CODENAME"

mapfile -t php_versions < <(versions_list "$CATALOG" php supported)
mapfile -t pkgs < <(php_packages "${php_versions[@]}")
apt-get install -y --no-install-recommends "${pkgs[@]}" >/tmp/apt-php.log 2>&1 \
  || { tail -20 /tmp/apt-php.log; fail "PHP packages"; }
for ver in "${php_versions[@]}"; do
  "php-fpm${ver}" -t >/dev/null 2>&1 || fail "php-fpm${ver} -t"
  "php${ver}" -m | grep -qx 'Zend OPcache' || fail "php${ver} has no OPcache"
done
pass "PHP ${php_versions[*]}: ${#pkgs[@]} packages, FPM config valid, OPcache loaded"

if (N_SHA256=0000000000000000000000000000000000000000000000000000000000000000; install_n /tmp/n-bad) 2>/dev/null; then
  fail "n installed despite a checksum mismatch"
fi
[ ! -e /tmp/n-bad ] || fail "n written despite a checksum mismatch"
pass "n with a wrong checksum is refused"

install_n /usr/local/bin/n
mapfile -t node_versions < <(versions_list "$CATALOG" node supported)
for ver in "${node_versions[@]}"; do
  n "$ver" >/dev/null 2>&1 || fail "n $ver"
  got="$(/usr/local/bin/node --version)"
  [[ "$got" == "v${ver}."* ]] || fail "node $ver reports $got"
done
pass "Node ${node_versions[*]} via n ${N_VERSION}"
