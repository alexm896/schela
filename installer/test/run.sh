#!/bin/bash
# Security and installer-script checks. Run as root in the test container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

echo "== syntax"
python3 -m py_compile "$INS/schela-files" "$INS/schela-backup" "$INS/schela-workers" "$INS/schela-db"
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
grep -qx 'schela ALL=(root) NOPASSWD: /usr/local/sbin/schela-workers' "$INS/templates/sudoers" \
  || fail "sudoers must allow schela-workers"
pass "sudoers allows schela-workers"
grep -qx 'schela ALL=(root) NOPASSWD: /usr/local/sbin/schela-db ""' "$INS/templates/sudoers" \
  || fail "sudoers must allow schela-db with no arguments only"
pass "sudoers pins schela-db to no arguments"

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

echo "== site workers: unit generation"
# No systemd in the container: record every systemctl call instead.
for bin in systemctl journalctl; do
  [ -e "/usr/bin/$bin" ] && mv "/usr/bin/$bin" "/usr/bin/$bin.real"
done
cat >/usr/bin/systemctl <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>/tmp/systemctl.log
case "$1" in
  is-active) [ -e "/tmp/active-${*: -1}" ] && exit 0; exit 3 ;;
  *) exit 0 ;;
esac
SH
cat >/usr/bin/journalctl <<'SH'
#!/bin/bash
printf '%s\n' "$*" >/tmp/journalctl.log
printf '2026-10-03T17:00:0%sZ host schela-worker-7[1]: line %s\n' 1 1 2 2 3 3
SH
chmod 755 /usr/bin/systemctl /usr/bin/journalctl

id -u s_w >/dev/null 2>&1 || useradd --home /home/s_w --create-home --shell /usr/sbin/nologin s_w
export SCHELA_SYSTEMD_DIR=/tmp/schela-systemd
export SCHELA_STATE=/tmp/schela-workers-state.json
rm -rf "$SCHELA_SYSTEMD_DIR"; mkdir -p "$SCHELA_SYSTEMD_DIR/multi-user.target.wants"

write_state() {
  python3 - "$@" <<'PY'
import json, sys
workers = json.loads(sys.argv[1])
sites = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
apps = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
json.dump({
  "settings": {"hostname": "panel.test"},
  "modules": {"php": True, "node": False, "firewall": False, "mail": False, "dns": False, "ssl": False, "redis": False, "backups": False},
  "sites": sites, "apps": apps, "firewall": [], "mailboxes": [], "cron": [], "backups": [], "dns": {"zones": []},
  "workers": workers,
}, open("/tmp/schela-workers-state.json", "w"))
PY
}
apply_now() { : >/tmp/systemctl.log; bash "$INS/schela-apply" >/tmp/schela-apply.out 2>&1 || { cat /tmp/schela-apply.out; fail "apply failed"; }; }
W='{"id":7,"name":"queue","domain":"w.test","user":"s_w","phpVersion":"8.3","argv":["php","artisan","queue:work","--queue=high,default"],"processes":2,"stopTimeout":3600,"memoryMb":512,"enabled":true}'
U="$SCHELA_SYSTEMD_DIR/schela-worker-7@.service"

write_state "[$W]"
apply_now
[ -f "$U" ] || fail "unit not written"
grep -qx 'ExecStart="/usr/bin/php8.3" "artisan" "queue:work" "--queue=high,default"' "$U" || { cat "$U"; fail "ExecStart wrong"; }
[ "$(grep -c '^ExecStart=' "$U")" = 1 ] || fail "more than one ExecStart"
for line in 'User=s_w' 'Group=s_w' 'WorkingDirectory=/home/s_w/www' 'TimeoutStopSec=3600' 'MemoryMax=512M' \
  'KillMode=mixed' 'Restart=always' 'NoNewPrivileges=yes' 'ProtectSystem=strict' 'ProtectHome=tmpfs' \
  'BindPaths=/home/s_w' 'CapabilityBoundingSet=' 'PrivateTmp=yes'; do
  grep -qx "$line" "$U" || fail "unit missing $line"
done
grep -qx 'daemon-reload' /tmp/systemctl.log || fail "no daemon-reload after writing the unit"
grep -qx 'enable --now --no-block schela-worker-7@1.service' /tmp/systemctl.log || fail "instance 1 not started"
grep -qx 'enable --now --no-block schela-worker-7@2.service' /tmp/systemctl.log || fail "instance 2 not started"
! grep -q 'schela-worker-7@3' /tmp/systemctl.log || fail "started an instance beyond the process count"
pass "unit rendered and both instances started"

apply_now
! grep -qx 'daemon-reload' /tmp/systemctl.log || fail "unchanged unit triggered daemon-reload"
! grep -q '^restart' /tmp/systemctl.log || fail "unchanged unit restarted workers"
pass "unchanged apply leaves running workers alone"

touch /tmp/active-schela-worker-7@1.service
write_state "[${W/\"memoryMb\":512/\"memoryMb\":768}]"
apply_now
grep -qx 'MemoryMax=768M' "$U" || fail "changed limit not written"
grep -qx 'restart --no-block schela-worker-7@1.service' /tmp/systemctl.log || fail "running instance not restarted after change"
rm -f /tmp/active-schela-worker-7@1.service
pass "changed unit restarts running instances gracefully"

ln -sfn ../schela-worker-7@.service "$SCHELA_SYSTEMD_DIR/multi-user.target.wants/schela-worker-7@3.service"
apply_now
grep -qx 'disable --now --no-block schela-worker-7@3.service' /tmp/systemctl.log || fail "extra instance not stopped"
pass "instances above the process count are stopped"

write_state "[${W/\"enabled\":true/\"enabled\":false}]"
ln -sfn ../schela-worker-7@.service "$SCHELA_SYSTEMD_DIR/multi-user.target.wants/schela-worker-7@1.service"
apply_now
! grep -q '^enable' /tmp/systemctl.log || fail "disabled worker was started"
grep -qx 'disable --now --no-block schela-worker-7@1.service' /tmp/systemctl.log || fail "disabled worker not stopped"
pass "disabled worker is stopped and not started"

write_state '[]'
apply_now
[ ! -e "$U" ] || fail "removed worker kept its unit"
[ ! -e "$SCHELA_SYSTEMD_DIR/multi-user.target.wants/schela-worker-7@1.service" ] || fail "removed worker kept boot links"
grep -qx 'disable --now --no-block schela-worker-7@1.service' /tmp/systemctl.log || fail "removed worker not stopped"
pass "removed worker: stopped, unit and boot links deleted"

echo "== site workers: hostile state"
# argv is quoted for systemd: \ " % $ escaped, so they reach the process literally.
write_state '[{"id":8,"name":"q","domain":"w.test","user":"s_w","phpVersion":"8.3","argv":["php","a\"b","100%","$HOME","c\\d","%i"],"processes":1,"stopTimeout":60,"memoryMb":256,"enabled":true}]'
apply_now
grep -qxF 'ExecStart="/usr/bin/php8.3" "a\"b" "100%%" "$$HOME" "c\\d" "%%i"' "$SCHELA_SYSTEMD_DIR/schela-worker-8@.service" \
  || { grep '^ExecStart' "$SCHELA_SYSTEMD_DIR/schela-worker-8@.service"; fail "special characters not escaped"; }
pass "quotes, backslashes, % and \$ are escaped for systemd"

for bad in \
  '"argv":["php","x\nUser=root"]' \
  '"argv":["php","x\rUser=root"]' \
  '"argv":["php",""]' \
  '"argv":[]' \
  '"argv":"php artisan"' \
  '"argv":["php",7]' \
  '"argv":["../bin/sh"]' \
  '"argv":["/usr/../bin/sh"]' \
  '"argv":["php"],"user":"root"' \
  '"argv":["php"],"user":"nobody"' \
  '"argv":["php"],"user":"s_missing"' \
  '"argv":["php"],"name":"x\nUser=root"' \
  '"argv":["php"],"name":"a%i"' \
  '"argv":["php"],"phpVersion":"7.4"' \
  '"argv":["php"],"processes":9' \
  '"argv":["php"],"stopTimeout":4' \
  '"argv":["php"],"memoryMb":9000' \
  '"argv":["php"],"id":"9; rm -rf /"' ; do
  rm -rf "$SCHELA_SYSTEMD_DIR"; mkdir -p "$SCHELA_SYSTEMD_DIR/multi-user.target.wants"
  base='{"id":9,"name":"q","domain":"w.test","user":"s_w","phpVersion":"8.3","processes":1,"stopTimeout":60,"memoryMb":256,"enabled":true}'
  worker="$(python3 -c 'import json,sys; b=json.loads(sys.argv[1]); b.update(json.loads("{"+sys.argv[2]+"}")); print(json.dumps(b))' "$base" "$bad")"
  write_state "[$worker]"
  apply_now
  if ls "$SCHELA_SYSTEMD_DIR"/schela-worker-* >/dev/null 2>&1; then
    fail "hostile worker produced a unit: $bad"
  fi
  ! grep -q '^enable' /tmp/systemctl.log || fail "hostile worker was started: $bad"
done
pass "18 hostile worker definitions rejected without writing a unit"

rm -rf "$SCHELA_SYSTEMD_DIR"; mkdir -p "$SCHELA_SYSTEMD_DIR"
write_state '[{"id":10,"name":"bin","domain":"w.test","user":"s_w","phpVersion":"8.3","argv":["bin/worker","--once"],"processes":1,"stopTimeout":60,"memoryMb":256,"enabled":true}]'
apply_now
grep -qx 'ExecStart="/home/s_w/www/bin/worker" "--once"' "$SCHELA_SYSTEMD_DIR/schela-worker-10@.service" \
  || fail "relative executable not resolved inside the site"
pass "relative executables resolve inside the site's www"

echo "== site document root"
id -u s_root >/dev/null 2>&1 || useradd --home /home/s_root --create-home --shell /usr/sbin/nologin s_root
mkdir -p /run/php
for case_root in "/home/s_root/www/public|/home/s_root/www/public" "/home/s_root/www|/home/s_root/www" \
  "/home/s_other/www/public|/home/s_root/www" "/home/s_root/www/../../etc|/home/s_root/www" \
  "/home/s_root/www/.git|/home/s_root/www" "/etc|/home/s_root/www" "/home/s_root/www/a/b/c/d/e|/home/s_root/www"; do
  given="${case_root%%|*}"; want="${case_root##*|}"
  write_state '[]' "[{\"domain\":\"root.test\",\"systemUser\":\"s_root\",\"pool\":\"php83-s_root\",\"phpVersion\":\"8.3\",\"memoryLimit\":\"256M\",\"root\":\"$given\",\"status\":\"active\",\"isolated\":true,\"ssl\":false,\"forceHttps\":false,\"ip\":\"\"}]"
  apply_now
  got="$(awk '$1=="root"{print $2; exit}' /etc/nginx/schela.d/site-root.test.conf | tr -d ';')"
  [ "$got" = "$want" ] || fail "root $given rendered as $got, expected $want"
done
pass "document root stays inside the site's www"

echo "== site home links"
site_state() {
  write_state '[]' "[{\"domain\":\"link.test\",\"systemUser\":\"s_link\",\"pool\":\"php83-s_link\",\"phpVersion\":\"8.3\",\"memoryLimit\":\"256M\",\"root\":\"/home/s_link/www\",\"status\":\"active\",\"isolated\":true,\"ssl\":false,\"forceHttps\":false,\"ip\":\"\"}]"
}
id -u s_link >/dev/null 2>&1 || useradd --home /home/s_link --create-home --shell /usr/sbin/nologin s_link
site_state

# Fresh site: www, tmp and logs belong to the user, placeholder escapes the domain.
rm -rf /home/s_link/www /home/s_link/tmp /home/s_link/logs
apply_now
[ "$(stat -c %U:%a /home/s_link/www)" = "s_link:750" ] || fail "fresh www has wrong owner/mode"
[ "$(stat -c %U /home/s_link/tmp /home/s_link/logs | sort -u)" = "s_link" ] || fail "tmp/logs not owned by the site user"
[ "$(stat -c %U:%a /home/s_link/www/index.php)" = "s_link:644" ] || fail "placeholder has wrong owner/mode"
grep -qF "htmlspecialchars('link.test'" /home/s_link/www/index.php || fail "placeholder content wrong"
echo 'custom' >/home/s_link/www/index.php
apply_now
[ "$(cat /home/s_link/www/index.php)" = "custom" ] || fail "existing index.php was overwritten"
pass "fresh site gets a user-owned www and a placeholder that is never overwritten"

# The site user replaces www with a link to a directory it does not own.
mkdir -p /etc/schela-www-target && chmod 755 /etc/schela-www-target && echo keep >/etc/schela-www-target/f
rm -rf /home/s_link/www && ln -s /etc/schela-www-target /home/s_link/www && chown -h s_link:s_link /home/s_link/www
apply_now
[ "$(stat -c %U:%a /etc/schela-www-target)" = "root:755" ] || fail "linked www target changed owner/mode"
[ ! -e /etc/schela-www-target/index.php ] || fail "placeholder written through the www link"
[ "$(stat -c %U /etc/schela-www-target/f)" = "root" ] || fail "file behind the www link changed owner"
[ -f /etc/nginx/schela.d/site-link.test.conf ] || fail "site config not written when www is a link"
pass "a www link to another user's directory is not followed with root rights"

# tmp and logs links are not followed either.
rm -rf /home/s_link/www /home/s_link/tmp && mkdir -p /etc/schela-tmp-target && chmod 755 /etc/schela-tmp-target
ln -s /etc/schela-tmp-target /home/s_link/tmp && chown -h s_link:s_link /home/s_link/tmp
apply_now
[ "$(stat -c %U:%a /etc/schela-tmp-target)" = "root:755" ] || fail "linked tmp target changed owner/mode"
[ "$(stat -c %U:%a /home/s_link/www)" = "s_link:750" ] || fail "www not created next to a linked tmp"
pass "tmp and logs links are not followed with root rights"

# A deploy-style link to a directory the user owns keeps working.
rm -rf /home/s_link/www /home/s_link/tmp
as_site() { runuser -u s_link -- "$@"; }
as_site mkdir -p /home/s_link/releases/1 && as_site ln -s /home/s_link/releases/1 /home/s_link/www
apply_now
[ "$(stat -c %U:%a /home/s_link/releases/1)" = "s_link:750" ] || fail "user-owned www target not set to 750"
[ "$(stat -c %U /home/s_link/releases/1/index.php)" = "s_link" ] || fail "placeholder not written into the user's release"
pass "a www link to the user's own release directory still works"
rm -rf /home/s_link/www /home/s_link/releases /etc/schela-www-target /etc/schela-tmp-target

echo "== schela-workers helper"
export SCHELA_STATE=/tmp/schela-workers-state.json
write_state "[$W]"
helper() { printf '%s' "$1" | python3 "$INS/schela-workers"; }
expect_helper_error() {
  out="$(helper "$1" || true)"
  echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is False, d' || fail "helper accepted $1"
}
: >/tmp/systemctl.log
out="$(helper '{"op":"restart","id":7}')"
echo "$out" | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True'
grep -qx 'restart --no-block -- schela-worker-7@1.service schela-worker-7@2.service' /tmp/systemctl.log \
  || { cat /tmp/systemctl.log; fail "restart argv wrong"; }
pass "restart targets exactly the worker's instances"
out="$(helper '{"op":"logs","id":7,"lines":100000}')"
echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] is True and len(d["lines"]) == 3, d'
grep -qx -- '--no-pager --quiet --output=short-iso --lines=500 --unit schela-worker-7@1.service --unit schela-worker-7@2.service' /tmp/journalctl.log \
  || { cat /tmp/journalctl.log; fail "journalctl argv wrong"; }
pass "logs are limited to the worker's units and capped at 500 lines"
for req in '{"op":"restart","id":"7"}' '{"op":"restart","id":true}' '{"op":"restart","id":0}' '{"op":"restart","id":8}' \
  '{"op":"restart","id":-1}' '{"op":"restart","id":7.5}' '{"op":"stop","id":7}' '{"op":"exec","id":7}' '{"op":"logs"}' \
  '[]' 'not json' '{"op":"restart","id":7,"unit":"ssh.service"}'; do
  if [ "$req" = '{"op":"restart","id":7,"unit":"ssh.service"}' ]; then
    : >/tmp/systemctl.log
    helper "$req" >/dev/null
    ! grep -q 'ssh' /tmp/systemctl.log || fail "helper passed a caller-supplied unit"
    continue
  fi
  expect_helper_error "$req"
done
write_state "[${W/\"enabled\":true/\"enabled\":false}]"
expect_helper_error '{"op":"restart","id":7}'
pass "helper rejects bad ids, unknown ops, stopped workers and extra fields"
out="$(printf '%s' '{"op":"logs","id":7}' | SUDO_USER=schela SCHELA_STATE=/tmp/schela-workers-state.json python3 "$INS/schela-workers" || true)"
echo "$out" | grep -q 'Panel state is not readable' || fail "helper honoured SCHELA_STATE under sudo"
pass "helper ignores SCHELA_STATE when run through sudo"

echo "== cron directory"
export SCHELA_STATE=/tmp/schela-workers-state.json
# Minimal images (Debian 13) ship without cron, so /etc/cron.d may not exist.
rm -rf /etc/cron.d
write_state '[]'
apply_now
[ -f /etc/cron.d/schela-jobs ] && [ -f /etc/cron.d/schela-backups ] || fail "cron files not written without /etc/cron.d"
[ "$(stat -c %a /etc/cron.d)" = "755" ] || fail "/etc/cron.d created with the wrong mode"
if ! command -v cron >/dev/null 2>&1; then
  grep -q 'cron is not installed' /tmp/schela-apply.out || fail "missing cron daemon not reported"
fi
pass "apply works without /etc/cron.d and says when cron is missing"

echo "== node app units"
app() { printf '{"name":"%s","domain":"%s","nodeVersion":"22","port":%s,"entry":"index.js","status":"running","ip":""}' "$1" "$2" "$3"; }
rm -f "$SCHELA_SYSTEMD_DIR"/schela-app-*.service
printf '[Unit]\n' >"$SCHELA_SYSTEMD_DIR/schela-app@.service"
printf '[Unit]\n' >"$SCHELA_SYSTEMD_DIR/unrelated.service"
write_state '[]' '[]' "[$(app api api.test 3001),$(app web web.test 3002)]"
apply_now
[ -f "$SCHELA_SYSTEMD_DIR/schela-app-api.service" ] && [ -f "$SCHELA_SYSTEMD_DIR/schela-app-web.service" ] \
  || fail "app units not written"
grep -qx 'enable --now schela-app-api' /tmp/systemctl.log || fail "app not started"
# web is deleted; api stays. A broken entry for a third app keeps its old unit.
printf '[Unit]\n' >"$SCHELA_SYSTEMD_DIR/schela-app-broken.service"
write_state '[]' '[]' "[$(app api api.test 3001),$(app broken broken.test 99999)]"
apply_now
[ ! -e "$SCHELA_SYSTEMD_DIR/schela-app-web.service" ] || fail "deleted app kept its unit"
grep -qx 'disable --now schela-app-web' /tmp/systemctl.log || fail "deleted app was not stopped"
grep -qx 'daemon-reload' /tmp/systemctl.log || fail "no daemon-reload after removing a unit"
[ -f "$SCHELA_SYSTEMD_DIR/schela-app-api.service" ] || fail "kept app lost its unit"
! grep -q 'disable --now schela-app-api' /tmp/systemctl.log || fail "kept app was stopped"
[ -f "$SCHELA_SYSTEMD_DIR/schela-app-broken.service" ] || fail "unit of an app still in the panel was removed"
[ -f "$SCHELA_SYSTEMD_DIR/schela-app@.service" ] && [ -f "$SCHELA_SYSTEMD_DIR/unrelated.service" ] \
  || fail "removed a unit that is not a deleted app's"
apply_now
! grep -q '^disable --now schela-app' /tmp/systemctl.log || { cat /tmp/systemctl.log; fail "second apply stopped an app"; }
pass "units of deleted Node apps are stopped and removed, others are left alone"
rm -f "$SCHELA_SYSTEMD_DIR"/schela-app*.service "$SCHELA_SYSTEMD_DIR/unrelated.service"

for bin in systemctl journalctl; do
  rm -f "/usr/bin/$bin"
  [ -e "/usr/bin/$bin.real" ] && mv "/usr/bin/$bin.real" "/usr/bin/$bin"
done
unset SCHELA_SYSTEMD_DIR

bash "$ROOT/installer/test/databases.sh"

echo "== all installer security tests passed"
