#!/bin/bash
# Security and installer-script checks. Run as root in the test container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

echo "== syntax"
python3 -m py_compile "$INS/schela-files" "$INS/schela-backup"
bash -n "$INS/schela-apply"
bash -n "$INS/schela"
bash -n "$INS/install.sh"
pass "python/bash syntax"

echo "== sudoers"
grep -q 'NOPASSWD: /usr/local/sbin/schela-backup run \*' "$INS/templates/sudoers" \
  || fail "sudoers must pin schela-backup run/cron"
grep -q 'NOPASSWD: /usr/local/sbin/schela-backup cron' "$INS/templates/sudoers" \
  || fail "sudoers must pin schela-backup cron"
pass "sudoers pins backup argv"

echo "== schela-files jail"
id -u s_demo >/dev/null 2>&1 || useradd --home /home/s_demo --create-home --shell /usr/sbin/nologin s_demo
mkdir -p /home/s_demo/www/css
printf 'secret\n' >/home/s_demo/www/index.php
printf 'nope\n' >/etc/schela-jail-secret
chown -R s_demo:s_demo /home/s_demo
chmod 750 /home/s_demo /home/s_demo/www

list_json="$(printf '%s' '{"op":"list","root":"/home/s_demo/www","rel":"/"}' | python3 "$INS/schela-files")"
echo "$list_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True; names={e["name"] for e in d["entries"]}; assert "index.php" in names'
pass "list jail"

if printf '%s' '{"op":"read","root":"/home/s_demo/www","rel":"../../etc/schela-jail-secret"}' | python3 "$INS/schela-files" >/tmp/schela-files.out 2>/tmp/schela-files.err; then
  if python3 -c 'import json; d=json.load(open("/tmp/schela-files.out")); raise SystemExit(0 if d.get("ok") is False else 1)'; then
    pass "escape via .. rejected"
  else
    fail "path escape succeeded"
  fi
else
  pass "escape via .. rejected (nonzero)"
fi

if printf '%s' '{"op":"read","root":"/etc","rel":"/passwd"}' | python3 "$INS/schela-files" >/tmp/schela-files.out 2>/tmp/schela-files.err; then
  python3 -c 'import json; d=json.load(open("/tmp/schela-files.out")); assert d.get("ok") is False' \
    || fail "non-jail root was allowed"
  pass "non-jail root rejected"
else
  pass "non-jail root rejected (nonzero)"
fi

expect_reject() {
  # $1 = label, $2 = JSON request. Passes when schela-files refuses the op.
  if printf '%s' "$2" | python3 "$INS/schela-files" >/tmp/schela-files.out 2>/tmp/schela-files.err; then
    python3 -c 'import json; d=json.load(open("/tmp/schela-files.out")); raise SystemExit(0 if d.get("ok") is False else 1)' \
      || fail "$1"
  fi
  pass "$1 rejected"
}

echo "== schela-files symlink escapes"
printf 'root-owned\n' >/etc/schela-jail-target
mkdir -p /etc/schela-jail-dir
printf 'root-owned\n' >/etc/schela-jail-dir/target
printf 'root-owned\n' >/etc/schela-jail-dir/victim
ln -sfn /etc/schela-jail-target /home/s_demo/www/link.txt
ln -sfn /etc /home/s_demo/www/etcdir
chown -h s_demo:s_demo /home/s_demo/www/link.txt /home/s_demo/www/etcdir

expect_reject "write through file symlink" \
  '{"op":"write","root":"/home/s_demo/www","rel":"/link.txt","content":"pwned"}'
expect_reject "write through directory symlink" \
  '{"op":"write","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/target","content":"pwned"}'
expect_reject "create through directory symlink" \
  '{"op":"create","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/new"}'
expect_reject "chmod through directory symlink" \
  '{"op":"chmod","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/target","mode":"0666"}'
expect_reject "read through directory symlink" \
  '{"op":"read","root":"/home/s_demo/www","rel":"/etcdir/shadow"}'

expect_reject "copy out through directory symlink" \
  '{"op":"copy","root":"/home/s_demo/www","rel":"/etcdir/shadow","to":"/shadow-copy"}'
expect_reject "rename through directory symlink" \
  '{"op":"rename","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/target","to":"/stolen"}'
expect_reject "delete through directory symlink" \
  '{"op":"delete","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/victim"}'
expect_reject "list through directory symlink" \
  '{"op":"list","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir"}'
expect_reject "mkdir through directory symlink" \
  '{"op":"mkdir","root":"/home/s_demo/www","rel":"/etcdir/schela-jail-dir/sub"}'
expect_reject "read world-readable file through directory symlink" \
  '{"op":"read","root":"/home/s_demo/www","rel":"/etcdir/passwd"}'

# Proves the helper runs as the site user: a root-only file inside the jail is off limits.
printf 'root-only\n' >/home/s_demo/www/root-only.txt
chown root:root /home/s_demo/www/root-only.txt
chmod 600 /home/s_demo/www/root-only.txt
expect_reject "root-only file inside the jail (privilege drop)" \
  '{"op":"read","root":"/home/s_demo/www","rel":"/root-only.txt"}'
grep -q "Permission denied" /tmp/schela-files.out || fail "root-only read was refused for the wrong reason"
pass "refusal came from the kernel"
[ "$(cat /etc/schela-jail-target)" = "root-owned" ] || fail "file symlink target was overwritten"
[ "$(cat /etc/schela-jail-dir/target)" = "root-owned" ] || fail "directory symlink target was overwritten"
[ "$(stat -c %U:%a /etc/schela-jail-dir/target)" = "root:644" ] || fail "directory symlink target changed owner/mode"
[ -e /etc/schela-jail-dir/victim ] || fail "file deleted outside the jail"
[ ! -e /etc/schela-jail-dir/new ] && [ ! -e /etc/schela-jail-dir/sub ] || fail "file created outside the jail"
[ ! -e /home/s_demo/www/shadow-copy ] && [ ! -e /home/s_demo/www/stolen ] || fail "file pulled into the jail"
pass "files outside the jail untouched"

out="$(printf '%s' '{"op":"write","root":"/home/s_demo/www","rel":"/css/site.css","content":"body{}"}' | python3 "$INS/schela-files")"
echo "$out" | python3 -c 'import json,sys; assert json.load(sys.stdin).get("ok") is True'
[ "$(cat /home/s_demo/www/css/site.css)" = "body{}" ] || fail "normal write lost content"
[ "$(stat -c %U:%a /home/s_demo/www/css/site.css)" = "s_demo:644" ] || fail "normal write has wrong owner/mode"
pass "normal write inside the jail"

echo "== schela-files normal operations (as the site user)"
F() { printf '%s' "$1" | python3 "$INS/schela-files"; }
ok() { python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True, d' || fail "$1"; pass "$1"; }
mkdir -p /home/s_demo/www/releases/1
printf 'v1\n' >/home/s_demo/www/releases/1/index.php
ln -sfn releases/1 /home/s_demo/www/current
chown -R -h s_demo:s_demo /home/s_demo/www
F '{"op":"read","root":"/home/s_demo/www","rel":"/current/index.php"}' | ok "read through in-jail symlink"
F '{"op":"mkdir","root":"/home/s_demo/www","rel":"/assets"}' | ok "mkdir"
F '{"op":"create","root":"/home/s_demo/www","rel":"/assets/a.txt"}' | ok "create"
F '{"op":"write","root":"/home/s_demo/www","rel":"/assets/a.txt","content":"aGVsbG8=","encoding":"base64"}' | ok "write base64"
F '{"op":"read","root":"/home/s_demo/www","rel":"/assets/a.txt","binary":true}' \
  | python3 -c 'import json,sys,base64; d=json.load(sys.stdin); assert base64.b64decode(d["content"])==b"hello", d' || fail "read binary"
pass "read binary"
F '{"op":"chmod","root":"/home/s_demo/www","rel":"/assets/a.txt","mode":"0600"}' | ok "chmod"
[ "$(stat -c %a /home/s_demo/www/assets/a.txt)" = "600" ] || fail "chmod not applied"
F '{"op":"copy","root":"/home/s_demo/www","rel":"/assets","to":"/assets2"}' | ok "copy directory"
F '{"op":"copy","root":"/home/s_demo/www","rel":"/assets/a.txt","to":"/b.txt"}' | ok "copy file"
F '{"op":"rename","root":"/home/s_demo/www","rel":"/b.txt","to":"/assets2/c.txt"}' | ok "rename"
F '{"op":"list","root":"/home/s_demo/www","rel":"/assets2"}' \
  | python3 -c 'import json,sys; n={e["name"] for e in json.load(sys.stdin)["entries"]}; assert n=={"a.txt","c.txt"}, n' || fail "list after copy/rename"
pass "list after copy/rename"
F '{"op":"delete","root":"/home/s_demo/www","rel":"/assets2"}' | ok "delete directory tree"
[ ! -e /home/s_demo/www/assets2 ] || fail "delete left files behind"
bad="$(find /home/s_demo -not -user s_demo -not -path /home/s_demo/www/root-only.txt)"
[ -z "$bad" ] || fail "files not owned by the site user: $bad"
pass "everything created is owned by the site user"

echo "== schela-backup path jail"
mkdir -p /var/lib/schela /tmp/schela-b
export SCHELA_STATE=/tmp/schela-state.json
export SCHELA_BACKUP_ROOT=/tmp/schela-b
cat >"$SCHELA_STATE" <<'JSON'
{
  "modules": {},
  "sites": [{"domain":"evil.test","systemUser":"../../../../etc"}],
  "apps": [],
  "backups": [{"id":1,"name":"t","scope":"all","enabled":true,"retain":3,"includeMail":false}]
}
JSON
python3 "$INS/schela-backup" run 1 >/tmp/schela-b1.json
python3 - <<'PY'
import json, tarfile, glob
d = json.load(open("/tmp/schela-b1.json"))
assert d.get("localOk") is True, d
assert str(d.get("localPath") or "").startswith("/tmp/schela-b"), d
paths = glob.glob("/tmp/schela-b/*/*.tar.gz")
assert paths, "no archive"
with tarfile.open(paths[0], "r:gz") as t:
    names = t.getnames()
assert not any("passwd" in n.split("/")[-1] and "etc" in n for n in names), names
PY
pass "backup refuses /etc via systemUser traversal"

# A real jail user should be included
id -u s_ok >/dev/null 2>&1 || useradd --home /home/s_ok --create-home --shell /usr/sbin/nologin s_ok
mkdir -p /home/s_ok/www
echo 'ok' >/home/s_ok/www/index.php
chown -R s_ok:s_ok /home/s_ok
cat >"$SCHELA_STATE" <<'JSON'
{
  "modules": {},
  "sites": [{"domain":"ok.test","systemUser":"s_ok"}],
  "apps": [],
  "backups": [{"id":2,"name":"ok","scope":"all","enabled":true,"retain":3,"includeMail":false}]
}
JSON
python3 "$INS/schela-backup" run 2 >/tmp/schela-b2.json
python3 - <<'PY'
import json, tarfile, glob
d=json.load(open("/tmp/schela-b2.json"))
assert d.get("localOk") is True
paths=glob.glob("/tmp/schela-b/2-ok/*.tar.gz")
assert paths
with tarfile.open(paths[0],"r:gz") as t:
    names=t.getnames()
assert any("index.php" in n for n in names), names
PY
pass "backup includes real site jail"

echo "== schela-apply dry-run"
command -v nginx >/dev/null || { echo "skip apply (no nginx)"; exit 0; }
mkdir -p /usr/local/share/schela/templates /var/lib/schela
cp -a "$INS/templates/." /usr/local/share/schela/templates/
export SCHELA_STATE=/tmp/schela-apply-state.json
export SCHELA_TEMPLATES=/usr/local/share/schela/templates
cat >"$SCHELA_STATE" <<'JSON'
{
  "settings": {"hostname":"panel.test","isolation":true,"sshPort":22,"autoUpdates":true},
  "modules": {"php":true,"node":false,"firewall":false,"mail":false,"dns":false,"ssl":false,"redis":false,"backups":false},
  "sites": [],
  "apps": [],
  "firewall": [],
  "mailboxes": [],
  "cron": [],
  "backups": [],
  "dns": {"zones": []}
}
JSON
bash "$INS/schela-apply" --dry-run >/tmp/schela-apply.out
grep -q 'schela-apply: applying' /tmp/schela-apply.out || fail "apply dry-run did not run"
pass "schela-apply --dry-run"

echo "== all installer security tests passed"
