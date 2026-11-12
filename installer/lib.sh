# Schela installer helpers. Sourced by install.sh and the installer tests.

SCHELA_SUPPORTED_OS="ubuntu-22.04 ubuntu-24.04 ubuntu-26.04 debian-12 debian-13"

# n (Node version manager), pinned to a release and checked before it runs as root.
N_VERSION="11.0.0"
N_SHA256="01b945705082179c7786175555d3b8fa0908ede6feb92353837a6bf7ca4c73df"

PHP_EXTENSIONS="fpm cli common curl mbstring xml zip gd intl bcmath opcache sqlite3 mysql readline"

SURY_KEYRING=/usr/share/keyrings/debsuryorg-archive-keyring.gpg
SURY_SOURCES=/etc/apt/sources.list.d/php-sury.sources

# os_supported ID VERSION_ID
os_supported() {
  case " $SCHELA_SUPPORTED_OS " in
    *" $1-$2 "*) return 0 ;;
  esac
  return 1
}

# versions_list CATALOG RUNTIME KEY  (KEY: supported | retired | default)
versions_list() {
  jq -r --arg rt "$2" --arg key "$3" '.[$rt][$key] | if type == "array" then .[] else . end' "$1"
}

# php_packages VERSION...  -> the PHP-FPM package set, one name per line.
# PHP 8.5 builds OPcache into the core, so there is no php8.5-opcache package.
php_packages() {
  local ver ext major minor
  for ver in "$@"; do
    major="${ver%%.*}"
    minor="${ver#*.}"
    for ext in $PHP_EXTENSIONS; do
      if [ "$ext" = "opcache" ] && { [ "$major" -gt 8 ] || { [ "$major" -eq 8 ] && [ "$minor" -ge 5 ]; }; }; then
        continue
      fi
      printf 'php%s-%s\n' "$ver" "$ext"
    done
  done
}

# sury_sources CODENAME -> deb822 source for packages.sury.org/php
sury_sources() {
  cat <<EOF
Types: deb
URIs: https://packages.sury.org/php/
Suites: $1
Components: main
Signed-By: $SURY_KEYRING
EOF
}

# setup_php_repo CODENAME
# PHP comes from packages.sury.org on every supported system. ppa:ondrej/php is
# being retired (it has no 26.04 build) and an old one-line php.list carried no
# Signed-By, so both are removed.
setup_php_repo() {
  local codename="$1" tmp
  rm -f /etc/apt/sources.list.d/php.list \
    /etc/apt/sources.list.d/ondrej-ubuntu-php-*.list \
    /etc/apt/sources.list.d/ondrej-ubuntu-php-*.sources \
    /etc/apt/trusted.gpg.d/ondrej-ubuntu-php*.gpg
  tmp="$(mktemp)"
  curl -fsSLo "$tmp" https://packages.sury.org/debsuryorg-archive-keyring.deb
  dpkg -i "$tmp"
  rm -f "$tmp"
  [ -s "$SURY_KEYRING" ] || { echo "sury keyring missing at $SURY_KEYRING" >&2; return 1; }
  sury_sources "$codename" >"$SURY_SOURCES"
  chmod 0644 "$SURY_SOURCES"
}

# install_n DEST  -> downloads the pinned n release and installs it only if the
# checksum matches.
install_n() {
  local dest="$1" tmp
  tmp="$(mktemp)"
  curl -fsSL "https://raw.githubusercontent.com/tj/n/v${N_VERSION}/bin/n" -o "$tmp"
  if ! printf '%s  %s\n' "$N_SHA256" "$tmp" | sha256sum -c - >/dev/null 2>&1; then
    rm -f "$tmp"
    echo "n ${N_VERSION}: checksum mismatch" >&2
    return 1
  fi
  install -m 0755 "$tmp" "$dest"
  rm -f "$tmp"
}
