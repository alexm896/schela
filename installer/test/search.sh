#!/bin/bash
# Meilisearch and Typesense: install from the pinned releases, upgrade, and the
# per-site keys of schela-search, against the real engines. Needs the network
# (GitHub and dl.typesense.org). Run as root in the test container.
#   SCHELA_DOWNLOAD_CACHE=/dir keeps the verified downloads between runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

command -v curl >/dev/null 2>&1 || {
  apt-get update -y >/dev/null
  apt-get install -y --no-install-recommends curl >/dev/null
}
# shellcheck disable=SC1091
. /etc/os-release
echo "== search engines on ${PRETTY_NAME} ($(uname -m))"

export SCHELA_STATE=/tmp/search-state.json
export SCHELA_SYSTEMD_DIR=/tmp/search-units
export SCHELA_VERSIONS=/tmp/search-versions.json
export SCHELA_DOWNLOAD_CACHE="${SCHELA_DOWNLOAD_CACHE:-/tmp/search-cache}"
mkdir -p "$SCHELA_SYSTEMD_DIR" "$SCHELA_DOWNLOAD_CACHE" /etc/cron.d
SEARCH="$INS/schela-search"
PINNED="$INS/versions.json"
case "$(uname -m)" in
  x86_64) ARCH=amd64 MEILI_ASSET=meilisearch-linux-amd64 ;;
  aarch64) ARCH=arm64 MEILI_ASSET=meilisearch-linux-aarch64 ;;
  *) fail "no release for $(uname -m)" ;;
esac

# No systemd in the container: record systemctl calls; "is-active" answers from
# /tmp/active-<unit>, which run_engine sets while it runs an engine by hand.
[ -e /usr/bin/systemctl ] && [ ! -e /usr/bin/systemctl.real ] && mv /usr/bin/systemctl /usr/bin/systemctl.real
cat >/usr/bin/systemctl <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>/tmp/systemctl.log
case "$1" in
  is-active) [ -e "/tmp/active-${*: -1}" ] && { echo active; exit 0; }; echo inactive; exit 3 ;;
  is-enabled) echo enabled ;;
esac
exit 0
SH
chmod 755 /usr/bin/systemctl

state() {
  # state <modules JSON> [site ids JSON]
  jq -n --argjson mods "$1" --argjson sites "${2:-[1,10]}" '{
    settings: {hostname: "panel.test"},
    modules: $mods,
    sites: [$sites[] | {id: ., domain: "site\(.).test", systemUser: "s_site\(.)", status: "stopped"}],
    apps: [{id: 1, name: "one", domain: "one.test"}],
    firewall: [], mailboxes: [], cron: [], backups: [], workers: [], dns: {zones: []},
    databases: {mariadb: {databases: [], users: []}, postgresql: {databases: [], users: []}}
  }' >"$SCHELA_STATE"
}
ON='{"meilisearch":true,"typesense":true}'
OFF='{"meilisearch":false,"typesense":false}'
apply_ok() { : >/tmp/systemctl.log; bash "$INS/schela-apply" >/tmp/apply.out 2>&1 || { cat /tmp/apply.out; fail "apply failed"; }; }
apply_fails() { : >/tmp/systemctl.log; if bash "$INS/schela-apply" >/tmp/apply.out 2>&1; then cat /tmp/apply.out; fail "apply did not fail"; fi; }
helper() { printf '%s' "$1" | python3 "$SEARCH"; }
helper_ok() {
  local out
  out="$(helper "$1")" || true
  jq -e '.ok == true' <<<"$out" >/dev/null || fail "helper refused $1: $out"
  printf '%s' "$out"
}
helper_refuses() {
  local out
  out="$(helper "$1" || true)"
  jq -e '.ok == false' <<<"$out" >/dev/null || fail "helper accepted $1: $out"
}

# catalog <meili version> <meili sha> <typesense version> <typesense sha>
catalog() {
  jq --arg mv "$1" --arg ms "$2" --arg tv "$3" --arg ts "$4" --arg a "$ARCH" '
    .meilisearch = {version: $mv, sha256: {($a): $ms}} | .typesense = {version: $tv, sha256: {($a): $ts}}
  ' "$PINNED" >"$SCHELA_VERSIONS"
}
# The release before the pinned one, to test the upgrade. Its checksum comes
# from the GitHub release metadata and from the file itself (test-only trust).
OLD_MEILI=1.55.1
OLD_TS=30.1
old_meili_sha="$(curl -fsSL "https://api.github.com/repos/meilisearch/meilisearch/releases/tags/v${OLD_MEILI}" \
  | jq -r --arg n "$MEILI_ASSET" '.assets[] | select(.name == $n) | .digest' | sed 's/^sha256://')"
[[ "$old_meili_sha" =~ ^[0-9a-f]{64}$ ]] || fail "no digest for meilisearch $OLD_MEILI"
ts_old_file="$SCHELA_DOWNLOAD_CACHE/typesense-$OLD_TS-$ARCH.tar.gz"
[ -s "$ts_old_file" ] || curl -fsSL -o "$ts_old_file" \
  "https://dl.typesense.org/releases/${OLD_TS}/typesense-server-${OLD_TS}-linux-${ARCH}.tar.gz"
old_ts_sha="$(sha256sum "$ts_old_file" | awk '{print $1}')"
cp "$ts_old_file" "$SCHELA_DOWNLOAD_CACHE/$old_ts_sha"
NEW_MEILI="$(jq -r .meilisearch.version "$PINNED")"
NEW_TS="$(jq -r .typesense.version "$PINNED")"

# Run an engine by hand the way its unit would: same user, command and environment.
run_engine() {
  local unit="$1" user exec env port
  user="$(sed -n 's/^User=//p' "$SCHELA_SYSTEMD_DIR/$unit.service")"
  exec="$(sed -n 's/^ExecStart=//p' "$SCHELA_SYSTEMD_DIR/$unit.service")"
  env="$(sed -n 's/^Environment=//p' "$SCHELA_SYSTEMD_DIR/$unit.service")"
  port=7700
  [ "$unit" = typesense ] && port=8108
  # shellcheck disable=SC2086
  setsid runuser -u "$user" -- env $env $exec >"/tmp/$unit.log" 2>&1 &
  echo $! >"/tmp/$unit.pid"
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1 && { touch "/tmp/active-$unit"; return 0; }
    sleep 1
  done
  tail -20 "/tmp/$unit.log"
  fail "$unit did not answer on 127.0.0.1:$port"
}
stop_engine() {
  local unit="$1" pid
  pid="$(cat "/tmp/$unit.pid" 2>/dev/null || true)"
  rm -f "/tmp/active-$unit"
  [ -n "$pid" ] || return 0
  pkill -TERM -s "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do pgrep -s "$pid" >/dev/null 2>&1 || return 0; sleep 1; done
  pkill -KILL -s "$pid" 2>/dev/null || true
}

bin_version() { { "$1" --version 2>&1 || true; } | awk '$1 == "meilisearch" || $1 == "Typesense" {print $2; exit}'; }
meili() { local key="$1"; shift; curl -s -H "Authorization: Bearer $key" -H 'Content-Type: application/json' "$@"; }
ts() { local key="$1"; shift; curl -s -H "X-TYPESENSE-API-KEY: $key" -H 'Content-Type: application/json' "$@"; }
M=http://127.0.0.1:7700
T=http://127.0.0.1:8108
# HTTP status of a request
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
meili_wait() {
  # meili_wait KEY TASK-JSON -> succeeds when the task succeeded
  local key="$1" uid status
  uid="$(jq -r '.taskUid' <<<"$2")"
  [[ "$uid" =~ ^[0-9]+$ ]] || return 1
  for _ in $(seq 1 60); do
    status="$(meili "$key" "$M/tasks/$uid" | jq -r .status)"
    case "$status" in
      succeeded) return 0 ;;
      failed | canceled) return 1 ;;
    esac
    sleep 0.5
  done
  return 1
}

echo "== a release whose checksum does not match is refused"
catalog "$OLD_MEILI" "$(printf '0%.0s' $(seq 1 64))" "$OLD_TS" "$old_ts_sha"
state '{"meilisearch":true,"typesense":false}'
apply_fails
[ ! -e /usr/local/bin/meilisearch ] || fail "binary installed despite a checksum mismatch"
grep -q 'checksum mismatch' /tmp/apply.out || fail "no checksum message: $(cat /tmp/apply.out)"
grep -qx 'reload nginx' /tmp/systemctl.log || fail "a failed search install held back nginx"
pass "checksum mismatch: nothing installed, apply fails after nginx is reloaded"

echo "== install the previous release"
catalog "$OLD_MEILI" "$old_meili_sha" "$OLD_TS" "$old_ts_sha"
state "$ON"
apply_ok
[ "$(bin_version /usr/local/bin/meilisearch)" = "$OLD_MEILI" ] || fail "meilisearch $OLD_MEILI not installed"
[ "$(bin_version /usr/local/bin/typesense-server)" = "$OLD_TS" ] || fail "typesense $OLD_TS not installed"
for unit in meilisearch typesense; do
  f="$SCHELA_SYSTEMD_DIR/$unit.service"
  grep -qx "User=$unit" "$f" || fail "$unit unit does not drop root"
  grep -qx 'ProtectSystem=strict' "$f" || fail "$unit unit is not sandboxed"
  grep -qx 'CapabilityBoundingSet=' "$f" || fail "$unit unit keeps capabilities"
  grep -qx "enable $unit" /tmp/systemctl.log || fail "$unit not enabled at boot"
  grep -qx "restart $unit" /tmp/systemctl.log || fail "$unit not (re)started"
  [ "$(stat -c '%U:%a' "/var/lib/schela/search/$unit.key")" = "root:600" ] || fail "$unit master key is not root-only"
  [ "$(stat -c '%U:%a' /var/lib/schela/search)" = "root:700" ] || fail "search secrets dir is not root-only"
done
[ "$(stat -c '%U:%G:%a' /etc/meilisearch.toml)" = "root:meilisearch:640" ] || fail "meilisearch config readable by others"
[ "$(stat -c '%U:%G:%a' /etc/typesense/typesense-server.ini)" = "root:typesense:640" ] || fail "typesense config readable by others"
grep -qx 'http_addr = "127.0.0.1:7700"' /etc/meilisearch.toml || fail "meilisearch not bound to localhost"
grep -qx 'env = "production"' /etc/meilisearch.toml || fail "meilisearch not in production mode"
grep -qx 'no_analytics = true' /etc/meilisearch.toml || fail "meilisearch telemetry left on"
grep -qx 'api-address = 127.0.0.1' /etc/typesense/typesense-server.ini || fail "typesense not bound to localhost"
pass "meilisearch $OLD_MEILI and typesense $OLD_TS: verified, own users, sandboxed units, root-only master keys"

run_engine meilisearch
run_engine typesense
# Listening sockets on 7700 (1E14) and 8108 (1FAC): all must be 127.0.0.1 (0100007F).
listeners="$(awk '$4 == "0A" {print $2}' /proc/net/tcp /proc/net/tcp6 | grep -E ':(1E14|1FAC)$' || true)"
[ -n "$listeners" ] || fail "no engine socket found"
grep -qv '^0100007F:' <<<"$listeners" && fail "an engine listens beyond 127.0.0.1: $listeners"
MK="$(cat /var/lib/schela/search/meilisearch.key)"
TK="$(cat /var/lib/schela/search/typesense.key)"
[ "$(code "$M/keys")" = 401 ] || fail "meilisearch answers without a key"
[ "$(code "$T/keys")" = 401 ] || fail "typesense answers without a key"
pass "both engines run as their users on 127.0.0.1 and refuse requests without a key"

apply_ok
! grep -qE '^restart (meilisearch|typesense)$' /tmp/systemctl.log || fail "unchanged engines were restarted"
! grep -q 'installing' /tmp/apply.out || fail "a second apply downloaded the engines again"
grep -qx 'start meilisearch' /tmp/systemctl.log || fail "meilisearch not kept running"
pass "a second apply leaves running engines alone"

echo "== schela-search: info"
info="$(helper_ok '{"op":"info"}')"
jq -e --arg v "$OLD_MEILI" '.engines.meilisearch | .enabled and .installed and .running and .healthy and .version == $v and .keys == []' <<<"$info" >/dev/null \
  || fail "meilisearch info: $(jq -c .engines.meilisearch <<<"$info")"
jq -e --arg v "$OLD_TS" '.engines.typesense | .enabled and .healthy and .version == $v and .indexes == 0' <<<"$info" >/dev/null \
  || fail "typesense info: $(jq -c .engines.typesense <<<"$info")"
pass "info: running, healthy, versions, no keys yet"

echo "== schela-search: keys per site"
for eng in meilisearch typesense; do
  for access in admin search; do
    out="$(helper_ok "{\"op\":\"create-key\",\"engine\":\"$eng\",\"owner\":\"site\",\"id\":1,\"access\":\"$access\"}")"
    jq -e '.prefix == "site1_"' <<<"$out" >/dev/null || fail "$eng key prefix: $out"
    declare "${eng}_${access}=$(jq -r .key <<<"$out")"
    declare "${eng}_${access}_id=$(jq -r .keyId <<<"$out")"
  done
done
# shellcheck disable=SC2154
{
  S10="$(helper_ok '{"op":"create-key","engine":"meilisearch","owner":"site","id":10,"access":"admin"}' | jq -r .key)"
  T10="$(helper_ok '{"op":"create-key","engine":"typesense","owner":"site","id":10,"access":"admin"}' | jq -r .key)"
  A1="$(helper_ok '{"op":"create-key","engine":"meilisearch","owner":"app","id":1,"access":"admin"}' | jq -r .key)"
}
pass "admin and search keys for site 1, site 10 and app 1"

# Meilisearch: the site 1 admin key manages site1_* and nothing else.
meili_wait "$meilisearch_admin" "$(meili "$meilisearch_admin" -X POST "$M/indexes" -d '{"uid":"site1_products","primaryKey":"id"}')" \
  || fail "site 1 cannot create site1_products"
meili_wait "$meilisearch_admin" "$(meili "$meilisearch_admin" -X POST "$M/indexes/site1_products/documents" -d '[{"id":1,"name":"blue shirt"}]')" \
  || fail "site 1 cannot add documents"
meili_wait "$S10" "$(meili "$S10" -X POST "$M/indexes" -d '{"uid":"site10_products","primaryKey":"id"}')" \
  || fail "site 10 cannot create site10_products"
meili_wait "$A1" "$(meili "$A1" -X POST "$M/indexes" -d '{"uid":"app1_items","primaryKey":"id"}')" \
  || fail "app 1 cannot create app1_items"
for uid in site10_x xsite1_x site1 app1_x; do
  [ "$(code -H "Authorization: Bearer $meilisearch_admin" -H 'Content-Type: application/json' -X POST "$M/indexes" -d "{\"uid\":\"$uid\"}")" = 403 ] \
    || fail "site 1 key could create $uid"
done
[ "$(code -H "Authorization: Bearer $meilisearch_admin" "$M/indexes/site10_products/documents")" = 403 ] || fail "site 1 key reads site 10"
[ "$(code -H "Authorization: Bearer $meilisearch_admin" -X DELETE "$M/indexes/site10_products")" = 403 ] || fail "site 1 key deletes site 10"
[ "$(code -H "Authorization: Bearer $meilisearch_admin" -H 'Content-Type: application/json' -X POST "$M/swap-indexes" \
  -d '[{"indexes":["site1_products","site10_products"]}]')" = 403 ] || fail "site 1 key swaps with site 10"
[ "$(code -H "Authorization: Bearer $meilisearch_admin" "$M/keys")" = 403 ] || fail "site key lists keys"
[ "$(code -H "Authorization: Bearer $meilisearch_admin" -X POST "$M/dumps")" = 403 ] || fail "site key creates dumps"
[ "$(meili "$meilisearch_admin" "$M/indexes" | jq -c '[.results[].uid]')" = '["site1_products"]' ] || fail "site 1 sees other indexes"
pass "meilisearch: the site 1 admin key manages site1_* only (no site10_, xsite1_, app1_, swap, keys, dumps)"

hits="$(meili "$meilisearch_search" -X POST "$M/indexes/site1_products/search" -d '{"q":"shirt"}' | jq '.hits | length')"
[ "$hits" = 1 ] || fail "site 1 search key cannot search its index"
[ "$(code -H "Authorization: Bearer $meilisearch_search" -H 'Content-Type: application/json' -X POST "$M/indexes/site1_products/documents" -d '[{"id":2}]')" = 403 ] \
  || fail "search key can write"
[ "$(code -H "Authorization: Bearer $meilisearch_search" -H 'Content-Type: application/json' -X POST "$M/indexes/site10_products/search" -d '{"q":""}')" = 403 ] \
  || fail "site 1 search key searches site 10"
pass "meilisearch: the search key only searches site1_*"

# Typesense: the same, with collections.
SCHEMA='"fields":[{"name":"name","type":"string"}]'
[ "$(ts "$typesense_admin" -X POST "$T/collections" -d "{\"name\":\"site1_products\",$SCHEMA}" | jq -r .name)" = site1_products ] \
  || fail "site 1 cannot create site1_products"
ts "$typesense_admin" -X POST "$T/collections/site1_products/documents" -d '{"id":"1","name":"blue shirt"}' | jq -e '.id == "1"' >/dev/null \
  || fail "site 1 cannot add documents"
[ "$(ts "$T10" -X POST "$T/collections" -d "{\"name\":\"site10_products\",$SCHEMA}" | jq -r .name)" = site10_products ] \
  || fail "site 10 cannot create site10_products"
for name in site10_x xsite1_x site1 app1_x; do
  [ "$(code -H "X-TYPESENSE-API-KEY: $typesense_admin" -H 'Content-Type: application/json' -X POST "$T/collections" -d "{\"name\":\"$name\",$SCHEMA}")" = 401 ] \
    || fail "site 1 key could create $name"
done
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_admin" "$T/collections/site10_products")" = 401 ] || fail "site 1 key reads site 10"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_admin" -X DELETE "$T/collections/site10_products")" = 401 ] || fail "site 1 key deletes site 10"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_admin" "$T/keys")" = 401 ] || fail "site key lists keys"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_admin" "$T/synonym_sets")" = 401 ] || fail "site key reaches server-wide synonym sets"
[ "$(ts "$typesense_admin" "$T/collections" | jq -c '[.[].name]')" = '["site1_products"]' ] || fail "site 1 sees other collections"
pass "typesense: the site 1 admin key manages site1_* only (no site10_, xsite1_, app1_, keys, synonym sets)"

hits="$(ts "$typesense_search" "$T/collections/site1_products/documents/search?q=shirt&query_by=name" | jq '.found')"
[ "$hits" = 1 ] || fail "site 1 search key cannot search its collection"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_search" -H 'Content-Type: application/json' -X POST "$T/collections/site1_products/documents" -d '{"id":"2","name":"x"}')" = 401 ] \
  || fail "search key can write"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_search" "$T/collections/site10_products/documents/search?q=*&query_by=name")" = 401 ] \
  || fail "site 1 search key searches site 10"
pass "typesense: the search key only searches site1_*"

echo "== schela-search: refusals"
helper_refuses '{"op":"create-key","engine":"meilisearch","owner":"site","id":99,"access":"admin"}'
helper_refuses '{"op":"create-key","engine":"meilisearch","owner":"user","id":1,"access":"admin"}'
helper_refuses '{"op":"create-key","engine":"meilisearch","owner":"site","id":"1","access":"admin"}'
helper_refuses '{"op":"create-key","engine":"meilisearch","owner":"site","id":1,"access":"root"}'
helper_refuses '{"op":"create-key","engine":"elastic","owner":"site","id":1,"access":"admin"}'
helper_refuses '{"op":"delete-key","engine":"meilisearch","keyId":"../keys"}'
helper_refuses '{"op":"delete-key","engine":"typesense","keyId":"1/../2"}'
helper_refuses '{"op":"drop-indexes","engine":"meilisearch","owner":"site","id":1}'
helper_refuses '{"op":"nope"}'
out="$(printf '{"op":"info"}' | python3 "$SEARCH" extra-arg || true)"
jq -e '.ok == false' <<<"$out" >/dev/null || fail "helper accepted arguments"
hand_meili="$(meili "$MK" -X POST "$M/keys" -d '{"actions":["*"],"indexes":["*"],"expiresAt":null}' | jq -r .uid)"
hand_ts="$(ts "$TK" -X POST "$T/keys" -d '{"actions":["*"],"collections":["*"]}' | jq -r .id)"
helper_refuses "{\"op\":\"delete-key\",\"engine\":\"meilisearch\",\"keyId\":\"$hand_meili\"}"
helper_refuses "{\"op\":\"delete-key\",\"engine\":\"typesense\",\"keyId\":\"$hand_ts\"}"
[ "$(code -H "Authorization: Bearer $MK" "$M/keys/$hand_meili")" = 200 ] || fail "a hand-made meilisearch key was deleted"
state '{"meilisearch":false,"typesense":true}'
helper_refuses '{"op":"create-key","engine":"meilisearch","owner":"site","id":1,"access":"admin"}'
state "$ON"
pass "unknown owners, bad ids, other engines, arguments, hand-made keys, modules that are off: refused"

echo "== schela-search: revoke"
# shellcheck disable=SC2154
helper_ok "{\"op\":\"delete-key\",\"engine\":\"meilisearch\",\"keyId\":\"$meilisearch_search_id\"}" | jq -e '.deleted == true' >/dev/null \
  || fail "meilisearch key not revoked"
# shellcheck disable=SC2154
helper_ok "{\"op\":\"delete-key\",\"engine\":\"typesense\",\"keyId\":\"$typesense_search_id\"}" | jq -e '.deleted == true' >/dev/null \
  || fail "typesense key not revoked"
[ "$(code -H "Authorization: Bearer $meilisearch_search" -H 'Content-Type: application/json' -X POST "$M/indexes/site1_products/search" -d '{"q":""}')" = 403 ] \
  || fail "revoked meilisearch key still works"
[ "$(code -H "X-TYPESENSE-API-KEY: $typesense_search" "$T/collections/site1_products/documents/search?q=*&query_by=name")" = 401 ] \
  || fail "revoked typesense key still works"
helper_ok "{\"op\":\"delete-key\",\"engine\":\"meilisearch\",\"keyId\":\"$meilisearch_search_id\"}" | jq -e '.deleted == false' >/dev/null \
  || fail "revoking twice is not idempotent"
pass "revoked keys stop working at once; revoking again is a no-op"

echo "== schela-search: a deleted site's indexes"
state "$ON" '[1]'
for eng in meilisearch typesense; do
  out="$(helper_ok "{\"op\":\"drop-indexes\",\"engine\":\"$eng\",\"owner\":\"site\",\"id\":10}")"
  jq -e '.dropped == ["site10_products"] and .revokedKeys == 1' <<<"$out" >/dev/null || fail "$eng drop-indexes: $out"
done
left=""
for _ in $(seq 1 30); do
  left="$(meili "$MK" "$M/indexes" | jq -c '[.results[].uid] | sort')"
  [ "$left" = '["app1_items","site1_products"]' ] && break
  sleep 0.5
done
[ "$left" = '["app1_items","site1_products"]' ] || fail "meilisearch dropped the wrong indexes: $left"
[ "$(ts "$TK" "$T/collections" | jq -c '[.[].name]')" = '["site1_products"]' ] || fail "typesense dropped the wrong collections"
[ "$(code -H "Authorization: Bearer $S10" "$M/indexes")" = 403 ] || fail "site 10 meilisearch key survived"
[ "$(code -H "X-TYPESENSE-API-KEY: $T10" "$T/collections")" = 401 ] || fail "site 10 typesense key survived"
pass "drop-indexes removes only site10_* and its keys"

echo "== upgrade to the pinned release"
stop_engine meilisearch
stop_engine typesense
cp "$PINNED" "$SCHELA_VERSIONS"
apply_ok
[ "$(bin_version /usr/local/bin/meilisearch)" = "$NEW_MEILI" ] || fail "meilisearch not upgraded"
[ "$(bin_version /usr/local/bin/typesense-server)" = "$NEW_TS" ] || fail "typesense not upgraded"
[ -d "/var/lib/meilisearch/pre-upgrade-$OLD_MEILI" ] || fail "meilisearch data not kept before the upgrade"
[ -d "/var/lib/typesense/pre-upgrade-$OLD_TS" ] || fail "typesense data not kept before the upgrade"
grep -qx 'restart meilisearch' /tmp/systemctl.log || fail "meilisearch not restarted after the upgrade"
run_engine meilisearch
run_engine typesense
ok=0
for _ in $(seq 1 60); do
  hits="$(meili "$meilisearch_admin" -X POST "$M/indexes/site1_products/search" -d '{"q":"shirt"}' | jq '.hits | length' 2>/dev/null || true)"
  [ "$hits" = 1 ] && { ok=1; break; }
  sleep 1
done
[ "$ok" = 1 ] || fail "meilisearch data or key lost in the upgrade"
[ "$(ts "$typesense_admin" "$T/collections/site1_products/documents/search?q=shirt&query_by=name" | jq '.found')" = 1 ] \
  || fail "typesense data or key lost in the upgrade"
info="$(helper_ok '{"op":"info"}')"
jq -e --arg m "$NEW_MEILI" --arg t "$NEW_TS" '.engines.meilisearch.version == $m and .engines.typesense.version == $t' <<<"$info" >/dev/null \
  || fail "info after upgrade: $(jq -c '.engines | map_values(.version)' <<<"$info")"
pass "meilisearch $OLD_MEILI -> $NEW_MEILI, typesense $OLD_TS -> $NEW_TS: data and keys kept, old data copied aside"

catalog "$OLD_MEILI" "$old_meili_sha" "$OLD_TS" "$old_ts_sha"
apply_ok
[ "$(bin_version /usr/local/bin/meilisearch)" = "$NEW_MEILI" ] || fail "meilisearch was downgraded"
grep -q 'newer than the pinned' /tmp/apply.out || fail "no message about keeping the newer release"
pass "an older pinned release never downgrades the data"
cp "$PINNED" "$SCHELA_VERSIONS"

echo "== module off"
stop_engine meilisearch
stop_engine typesense
state "$OFF"
apply_ok
grep -qx 'disable --now meilisearch' /tmp/systemctl.log || fail "meilisearch not stopped when its module is off"
grep -qx 'disable --now typesense' /tmp/systemctl.log || fail "typesense not stopped when its module is off"
[ -x /usr/local/bin/meilisearch ] && [ -d /var/lib/meilisearch/data ] && [ -s /var/lib/schela/search/meilisearch.key ] \
  || fail "turning the module off removed the binary, data or key"
pass "module off stops the engines and keeps binary, data and keys"

echo "== a unit schela did not write"
printf '[Service]\nExecStart=/bin/true\n' >"$SCHELA_SYSTEMD_DIR/typesense.service"
apply_ok
grep -qE '^disable --now typesense$' /tmp/systemctl.log && fail "stopped a typesense schela did not set up"
state "$ON"
apply_fails
[ "$(cat "$SCHELA_SYSTEMD_DIR/typesense.service")" = "$(printf '[Service]\nExecStart=/bin/true')" ] || fail "overwrote a unit schela did not write"
grep -q 'was not written by schela' /tmp/apply.out || fail "no message about the foreign unit"
pass "a typesense unit installed by hand is left alone (and the apply says so)"

rm -f /usr/bin/systemctl
[ -e /usr/bin/systemctl.real ] && mv /usr/bin/systemctl.real /usr/bin/systemctl
echo "search: all checks passed"
