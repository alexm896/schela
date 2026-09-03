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
