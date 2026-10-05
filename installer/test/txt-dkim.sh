#!/bin/bash
# txt_strings and dkim_key from schela-apply, without a server.
# Run anywhere: bash installer/test/txt-dkim.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# Load only the two helpers; running schela-apply itself would apply state.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed -n '/^txt_strings() {/,/^}/p; /^dkim_key() {/,/^}/p' "$ROOT/installer/schela-apply" >"$TMP/helpers.sh"
# shellcheck source=/dev/null
source "$TMP/helpers.sh"

echo "== txt_strings"
[ "$(txt_strings "ok")" = '"ok"' ] || fail "short value"
pass "short value is one string"
[ "$(txt_strings "")" = '""' ] || fail "empty value"
pass "empty value is an empty string"

long="$(printf 'a%.0s' $(seq 1 600))"
out="$(txt_strings "$long")"
lengths="$(grep -o '"[^"]*"' <<<"$out" | awk '{ print length($0) - 2 }' | tr '\n' ' ')"
[ "$lengths" = "255 255 90 " ] || fail "600 bytes split as: $lengths"
pass "600 bytes become 255 + 255 + 90"
[ "$(grep -o '"[^"]*"' <<<"$out" | tr -d '"\n')" = "$long" ] || fail "split value does not join back"
pass "the strings join back to the value"

echo "== dkim_key"
# Same layout opendkim-genkey writes: tabs, parentheses, the key over two strings.
printf 'mail._domainkey\tIN\tTXT\t( "v=DKIM1; h=sha256; k=rsa; "\n\t  "p=MIIBIjANBgkq"\n\t  "hkiG9w0BAQEFAAOC" )  ; ----- DKIM key mail for example.com\n' >"$TMP/mail.txt"
[ "$(dkim_key "$TMP/mail.txt")" = "MIIBIjANBgkqhkiG9w0BAQEFAAOC" ] || fail "key: $(dkim_key "$TMP/mail.txt")"
pass "key is read from the quoted text only"

printf 'nothing here\n' >"$TMP/empty.txt"
[ -z "$(dkim_key "$TMP/empty.txt")" ] || fail "no key"
pass "a file without a key gives nothing and does not fail"

echo "all txt/dkim checks passed"
