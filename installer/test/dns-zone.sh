#!/bin/bash
# Zone-file helpers from schela-apply (txt_strings, dkim_key, fqdn, ns_glue),
# without a server. Needs bash and jq.
# Run anywhere: bash installer/test/dns-zone.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# Load only the helpers; running schela-apply itself would apply state.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed -n '/^ok_ipv4()/p; /^txt_strings() {/,/^}/p; /^dkim_key() {/,/^}/p; /^fqdn() {/,/^}/p; /^ns_glue() {/,/^}/p' \
  "$ROOT/installer/schela-apply" >"$TMP/helpers.sh"
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

echo "== fqdn"
[ "$(fqdn "ns1.example.com")" = "ns1.example.com." ] || fail "adds the dot"
[ "$(fqdn "ns1.example.com.")" = "ns1.example.com." ] || fail "keeps one dot"
pass "always exactly one final dot"

echo "== ns_glue"
zone='{"records":[
  {"type":"A","name":"@","value":"203.0.113.10"},
  {"type":"NS","name":"@","value":"ns1.example.com"},
  {"type":"NS","name":"@","value":"ns2.example.com."},
  {"type":"NS","name":"@","value":"ns.other.net"},
  {"type":"A","name":"ns2","value":"203.0.113.20"}]}'
glue="$(ns_glue "$zone" "example.com")"
[ "$glue" = "ns1 300 IN A 203.0.113.10" ] || fail "glue: $glue"
pass "in-zone NS without an A gets one at the apex IP; others are left alone"

[ -z "$(ns_glue '{"records":[{"type":"NS","name":"@","value":"ns1.example.com"}]}' "example.com")" ] || fail "no apex"
pass "no apex A, no glue"

echo "all zone helper checks passed"
