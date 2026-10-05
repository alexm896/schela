#!/bin/bash
# schela-purge against temporary folders: what it removes and what it refuses.
# Needs python3. Run anywhere: bash installer/test/purge.sh
# The account op deletes real users, so only its refusals are covered here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PURGE="$ROOT/installer/schela-purge"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export SCHELA_STATE="$TMP/state.json"
export SCHELA_MAIL_ROOT="$TMP/mail"
export SCHELA_BACKUP_ROOT="$TMP/backups"

cat >"$SCHELA_STATE" <<'JSON'
{
  "sites": [{ "domain": "shop.example", "systemUser": "s_shop_example" }],
  "apps": [{ "name": "API Server" }],
  "mailboxes": [{ "address": "kept@shop.example" }],
  "backups": [{ "id": 1 }]
}
JSON

# purge <json>: prints the helper's answer
purge() { printf '%s' "$1" | python3 "$PURGE"; }
expect_ok() { grep -q '"ok": true' <<<"$1" || fail "$2: $1"; }
expect_error() { grep -q "$3" <<<"$1" || fail "$2: $1"; }

echo "== refusals"
expect_error "$(purge '{"op":"account","user":"root"}')" "root" "Not a site or app user"
pass "root is not a site or app user"
expect_error "$(purge '{"op":"account","user":"s_shop_example"}')" "site user in use" "still belongs"
pass "a site's user is refused while the site exists"
expect_error "$(purge '{"op":"account","user":"sa_api-server"}')" "app user in use" "still belongs"
pass "an app's user is refused while the app exists"
expect_error "$(purge '{"op":"maildir","address":"kept@shop.example"}')" "mailbox in use" "still a mailbox"
pass "an existing mailbox's messages are refused"
expect_error "$(purge '{"op":"maildir","address":"../../etc@shop.example"}')" "path in address" "Not a mailbox address"
pass "an address with a path is refused"
expect_error "$(purge '{"op":"backups","jobId":1}')" "job in use" "still exists"
pass "an existing job's archives are refused"
expect_error "$(purge '{"op":"backups","jobId":"1"}')" "job id as text" "Not a backup job"
pass "a job id that is not a number is refused"
expect_error "$(purge '{"op":"nope"}')" "unknown op" "Unknown op"
pass "an unknown op is refused"

echo "== maildir"
mkdir -p "$SCHELA_MAIL_ROOT/shop.example/gone/new" "$SCHELA_MAIL_ROOT/shop.example/kept/new"
expect_ok "$(purge '{"op":"maildir","address":"gone@shop.example"}')" "remove maildir"
[ ! -e "$SCHELA_MAIL_ROOT/shop.example/gone" ] || fail "gone maildir still there"
[ -d "$SCHELA_MAIL_ROOT/shop.example/kept" ] || fail "kept maildir was removed"
pass "removes one mailbox and leaves the others"
mkdir -p "$SCHELA_MAIL_ROOT/other.example/last/new"
expect_ok "$(purge '{"op":"maildir","address":"last@other.example"}')" "remove last maildir"
[ ! -e "$SCHELA_MAIL_ROOT/other.example" ] || fail "empty domain folder left behind"
pass "drops the domain folder with its last mailbox"
ln -s "$TMP" "$SCHELA_MAIL_ROOT/shop.example/link"
expect_error "$(purge '{"op":"maildir","address":"link@shop.example"}')" "symlinked maildir" "Refusing"
[ -L "$SCHELA_MAIL_ROOT/shop.example/link" ] || fail "symlinked maildir was touched"
pass "a maildir that is a symlink is refused and left alone"

echo "== backups"
mkdir -p "$SCHELA_BACKUP_ROOT/2-nightly" "$SCHELA_BACKUP_ROOT/12-weekly" "$SCHELA_BACKUP_ROOT/1-kept"
printf '%s\n' '{"jobId": 2, "status": "ok"}' '{"jobId": 1, "status": "ok"}' '{"jobId": 12, "status": "ok"}' \
  >"$SCHELA_BACKUP_ROOT/history.jsonl"
expect_ok "$(purge '{"op":"backups","jobId":2}')" "remove archives"
[ ! -e "$SCHELA_BACKUP_ROOT/2-nightly" ] || fail "archives of job 2 still there"
[ -d "$SCHELA_BACKUP_ROOT/12-weekly" ] || fail "job 12 was removed with job 2"
[ -d "$SCHELA_BACKUP_ROOT/1-kept" ] || fail "job 1 was removed"
pass "removes only the job's own folder"
[ "$(grep -c '"jobId": 2,' "$SCHELA_BACKUP_ROOT/history.jsonl" || true)" = 0 ] || fail "history of job 2 kept"
[ "$(wc -l <"$SCHELA_BACKUP_ROOT/history.jsonl" | tr -d ' ')" = 2 ] || fail "other history lines lost"
pass "drops the job's run history and keeps the rest"

echo "all purge checks passed"
