#!/bin/bash
# Secrets kept on disk: the admin password (install.sh, schela reset-admin-password)
# and the backup secrets (schela-backup-keys, schela-backup). Run as root in the
# test container: it uses /var/lib/schela (moved aside and restored), a real
# sshd on 127.0.0.1:22 and a local S3 endpoint that checks the signature.
#
# The install.sh parts run the script's own sections (bootstrap, last step,
# final screen) with the panel stubbed by a curl that creates the admin from
# bootstrap-admin.json, as the panel's first request does.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
INSTALL="$INS/install.sh"
KEYS_HELPER="$INS/schela-backup-keys"
LIB=/var/lib/schela
ONCE=/run/schela-install.password
failed=0
pass() { printf 'ok   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; failed=$((failed + 1)); }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else bad "$name"; fi; }

echo "== secrets"
TMP="$(mktemp -d)"
id -u schela >/dev/null 2>&1 || useradd --system --home "$LIB" --shell /usr/sbin/nologin schela
[ ! -e "$LIB" ] || mv "$LIB" "$LIB.secrets-keep"
[ ! -e /usr/local/sbin/schela ] || mv /usr/local/sbin/schela /usr/local/sbin/schela.secrets-keep
cleanup() {
  [ -f "$TMP/sshd.pid" ] && kill "$(cat "$TMP/sshd.pid")" 2>/dev/null
  [ -f "$TMP/s3.pid" ] && kill "$(cat "$TMP/s3.pid")" 2>/dev/null
  rm -rf "$LIB" "$ONCE" /usr/local/sbin/schela "$TMP"
  [ ! -e "$LIB.secrets-keep" ] || mv "$LIB.secrets-keep" "$LIB"
  [ ! -e /usr/local/sbin/schela.secrets-keep ] || mv /usr/local/sbin/schela.secrets-keep /usr/local/sbin/schela
  userdel --remove bk >/dev/null 2>&1 || true
  rm -f /root/.ssh/config /root/.ssh/known_hosts
}
trap cleanup EXIT

# ---------------------------------------------------------------- admin password
# The stand-in panel. FAKE_ADMIN is its user table: the admin's password.
FAKE_ADMIN="$TMP/admin-in-db"
mkdir -p "$TMP/bin"
cat >"$TMP/bin/curl" <<SH
#!/bin/bash
[ "\${FAKE_PANEL_DOWN:-0}" = 1 ] && exit 7
mkdir -p $LIB/pglite && touch $LIB/pglite/PG_VERSION
if [ -f $LIB/bootstrap-admin.json ]; then
  [ -f $FAKE_ADMIN ] || jq -r .password $LIB/bootstrap-admin.json >$FAKE_ADMIN
  rm -f $LIB/bootstrap-admin.json
  sed -i '/^SCHELA_ADMIN_PASSWORD=/d' $LIB/admin.env 2>/dev/null
fi
if [ -f $LIB/admin-reset.json ]; then
  jq -r .password $LIB/admin-reset.json >$FAKE_ADMIN
  rm -f $LIB/admin-reset.json
fi
exit 0
SH
printf '#!/bin/sh\necho 10.9.8.7\n' >"$TMP/bin/hostname"
printf '#!/bin/sh\nexit 0\n' >"$TMP/bin/systemctl"
printf '#!/bin/sh\nexit 0\n' >"$TMP/bin/journalctl"
printf '#!/bin/sh\nexit 0\n' >"$TMP/bin/sleep"
chmod 755 "$TMP"/bin/*
printf '#!/bin/sh\nexit 0\n' >/usr/local/sbin/schela
chmod 755 /usr/local/sbin/schela

# install.sh from the first line matching $1 through the next line matching $2.
section() { awk -v a="$1" -v b="$2" '!f && $0 ~ a {f=1; print; next} f {print; if ($0 ~ b) exit}' "$INSTALL"; }
run_install() { # $1: section names to run, in order
  {
    printf 'set -euo pipefail\nlog() { :; }\ndie() { echo "die: $*"; exit 1; }\nPANEL_PORT=9090\ncode=0\nSCHELA_LOGO=\nSCHELA_LOG=/dev/null\n'
    section '^SCHELA_ADMIN_ONCE=' '^}$'
    for part in "$@"; do
      case "$part" in
        bootstrap) section '^ADMIN_EMAIL=' '^log "Copy panel' ;;
        last) section '^# Last step: always take port 80' '^__end_of_file__$' ;;
        screen) section '^  tput cnorm 2>/dev/null [|][|] true$' '^  exit 0$' ;;
      esac
    done
  } >"$TMP/install-part.sh"
  PATH="$TMP/bin:$PATH" SCHELA_INNER=1 bash "$TMP/install-part.sh" 2>&1
}
fresh_lib() {
  rm -rf "$LIB" "$ONCE" "$FAKE_ADMIN"
  install -d -m 0750 -o schela -g schela "$LIB"
}
# An install whose admin exists (panel database and user), as left by $1.
existing_install() {
  fresh_lib
  mkdir -p "$LIB/pglite" && touch "$LIB/pglite/PG_VERSION"
  printf 'old-admin-pass\n' >"$FAKE_ADMIN"
  printf 'BETTER_AUTH_SECRET=x\nBETTER_AUTH_URL=http://127.0.0.1\n' >"$LIB/admin.env"
  if [ "$1" = old ]; then
    printf 'url=http://10.9.8.7/\nuser=admin\npassword=old-admin-pass\n' >"$LIB/credentials"
    printf 'SCHELA_ADMIN_PASSWORD=old-admin-pass\n' >>"$LIB/admin.env"
  fi
  chown -R schela:schela "$LIB"
}
no_file_holds() { ! grep -rqF -- "$1" "$LIB" 2>/dev/null; }

# Fresh install: the password exists only until the final screen shows it.
fresh_lib
log_out="$(run_install bootstrap last)"
pw="$(cat "$FAKE_ADMIN" 2>/dev/null)"
check "fresh install: the panel got an admin password" [ -n "$pw" ]
check "fresh install: no credentials file after bootstrap" [ ! -e "$LIB/credentials" ]
check "fresh install: no file under $LIB holds the admin password" no_file_holds "$pw"
check "fresh install: the install log does not hold the password" bash -c '! grep -qF -- "$1" <<<"$2"' _ "$pw" "$log_out"
screen1="$(run_install screen)"
screen2="$(run_install screen)"
check "fresh install: the final screen shows the password" grep -qF -- "$pw" <<<"$screen1"
check "fresh install: the password is shown once" bash -c '! grep -qF -- "$1" <<<"$2"' _ "$pw" "$screen2"
check "fresh install: nothing holds the password after it was shown" bash -c '[ ! -e "$1" ] && ! grep -rqF -- "$2" "$3"' _ "$ONCE" "$pw" "$LIB"

# Re-run on an install whose admin exists: no new password, nothing reset.
existing_install new
run_install bootstrap >/dev/null
check "re-run: no new bootstrap password is written" [ ! -e "$LIB/bootstrap-admin.json" ]
check "re-run: admin.env gets no password" bash -c '! grep -q "^SCHELA_ADMIN_PASSWORD=" "$1"' _ "$LIB/admin.env"
run_install last >/dev/null
check "re-run: the admin keeps its password" [ "$(cat "$FAKE_ADMIN")" = old-admin-pass ]
check "re-run: the final screen shows no password" bash -c '! grep -q "Password" <<<"$1"' _ "$(run_install screen)"

# An install made by an older Schela: its credentials file goes once the admin exists.
existing_install old
run_install bootstrap last >/dev/null
check "older install: credentials file removed" [ ! -e "$LIB/credentials" ]
check "older install: admin.env password line removed" bash -c '! grep -q "^SCHELA_ADMIN_PASSWORD=" "$1"' _ "$LIB/admin.env"
check "older install: the admin keeps its password" [ "$(cat "$FAKE_ADMIN")" = old-admin-pass ]

# A first install stopped before the panel created the admin: a re-run shows the same password.
fresh_lib
FAKE_PANEL_DOWN=1 run_install bootstrap last >/dev/null
first="$(cat "$ONCE" 2>/dev/null)"
rm -f "$ONCE"
run_install bootstrap last >/dev/null
check "interrupted install: the re-run creates the admin with the first password" \
  bash -c '[ -n "$1" ] && [ "$(cat "$2")" = "$1" ] && [ "$(cat "$3")" = "$1" ]' _ "$first" "$FAKE_ADMIN" "$ONCE"

# schela reset-admin-password
existing_install new
out="$(runuser -u nobody -- bash "$INS/schela" reset-admin-password 2>&1)"; code=$?
check "reset-admin-password: refused for a non-root user" bash -c '[ "$1" -ne 0 ] && grep -q "root required" <<<"$2"' _ "$code" "$out"
out="$(SUDO_USER=schela PATH="$TMP/bin:$PATH" bash "$INS/schela" reset-admin-password 2>&1)"; code=$?
check "reset-admin-password: refused for the panel user through sudo" \
  bash -c '[ "$1" -ne 0 ] && [ "$(cat "$2")" = old-admin-pass ]' _ "$code" "$FAKE_ADMIN"
out="$(PATH="$TMP/bin:$PATH" bash "$INS/schela" reset-admin-password 2>&1)"; code=$?
newpw="$(sed -n 's/^New admin password: //p' <<<"$out")"
check "reset-admin-password: the panel takes the new password and it is printed" \
  bash -c '[ "$1" -eq 0 ] && [ ${#2} -ge 16 ] && [ "$(cat "$3")" = "$2" ]' _ "$code" "$newpw" "$FAKE_ADMIN"
check "reset-admin-password: no file under $LIB holds the new password" no_file_holds "$newpw"
out="$(FAKE_PANEL_DOWN=1 PATH="$TMP/bin:$PATH" bash "$INS/schela" reset-admin-password 2>&1)"; code=$?
check "reset-admin-password: panel down fails and leaves no request behind" \
  bash -c '[ "$1" -ne 0 ] && [ ! -e "$2" ] && [ "$(cat "$3")" = "$4" ]' _ "$code" "$LIB/admin-reset.json" "$FAKE_ADMIN" "$newpw"

# ---------------------------------------------------------------- schela-backup-keys
fresh_lib
export SCHELA_BACKUP_KEYS="$LIB/backup-keys"
keys() { printf '%s' "$1" | python3 "$KEYS_HELPER" "${@:2}" 2>&1; }
answer_ok() { jq -e '.ok == true' >/dev/null <<<"$1"; }

out="$(keys '{"op":"delete","jobs":[1]}' extra)"
check "schela-backup-keys: refuses arguments" bash -c 'grep -q "takes no arguments" <<<"$1"' _ "$out"
out="$(printf '%s' '{"op":"set","job":1,"kind":"s3","value":"x"}' | runuser -u schela -- python3 "$KEYS_HELPER" 2>&1)"
check "schela-backup-keys: refuses a non-root caller" bash -c 'grep -q "root required" <<<"$1" && [ ! -e "$2/job-1.s3" ]' _ "$out" "$SCHELA_BACKUP_KEYS"

S3_SECRET="wJalrXUtnFEMI/K7MDENG/bPxRfiCYsecretAB12"
out="$(keys "{\"op\":\"set\",\"job\":1,\"kind\":\"s3\",\"value\":\"$S3_SECRET\"}")"
check "schela-backup-keys: stores an S3 secret and answers its last 4 characters" \
  bash -c 'jq -e ".ok == true and .hint == \"AB12\"" >/dev/null <<<"$1" && ! grep -qF -- "$2" <<<"$1"' _ "$out" "$S3_SECRET"
check "schela-backup-keys: key file is root 0600, its directory root 0700" bash -c \
  '[ "$(stat -c %U:%a "$1")" = root:700 ] && [ "$(stat -c %U:%a "$1/job-1.s3")" = root:600 ] && [ "$(cat "$1/job-1.s3")" = "$2" ]' \
  _ "$SCHELA_BACKUP_KEYS" "$S3_SECRET"
check "schela-backup-keys: the panel user cannot read the secret" \
  bash -c '! runuser -u schela -- cat "$1/job-1.s3" >/dev/null 2>&1 && ! runuser -u schela -- ls "$1" >/dev/null 2>&1' _ "$SCHELA_BACKUP_KEYS"

ssh-keygen -q -t ed25519 -N "" -C backup -f "$TMP/id_backup"
fp="$(ssh-keygen -l -f "$TMP/id_backup" | awk '{print $2}')"
req="$(jq -n --rawfile v "$TMP/id_backup" '{op:"set",job:2,kind:"ssh",value:$v}')"
out="$(keys "$req")"
check "schela-backup-keys: stores an SSH key and answers its fingerprint" \
  bash -c 'jq -e --arg fp "$2" ".ok == true and .hint == \$fp" >/dev/null <<<"$1" && cmp -s "$3" "$4/job-2.ssh"' \
  _ "$out" "$fp" "$TMP/id_backup" "$SCHELA_BACKUP_KEYS"
out="$(keys "$(jq -n --rawfile v "$TMP/id_backup.pub" '{op:"set",job:3,kind:"ssh",value:$v}')")"
check "schela-backup-keys: refuses a public key" bash -c '! jq -e .ok <<<"$1" >/dev/null && [ ! -e "$2/job-3.ssh" ]' _ "$out" "$SCHELA_BACKUP_KEYS"
out="$(keys '{"op":"import","job":3,"path":"/etc/passwd"}')"
check "schela-backup-keys: import refuses a file that is not a private key" bash -c '! jq -e .ok <<<"$1" >/dev/null && [ ! -e "$2/job-3.ssh" ]' _ "$out" "$SCHELA_BACKUP_KEYS"
cp "$TMP/id_backup" "$TMP/legacy_key"
out="$(keys '{"op":"import","job":3,"path":"'"$TMP"'/legacy_key"}')"
check "schela-backup-keys: import copies an older panel's key file" bash -c 'jq -e ".ok == true" >/dev/null <<<"$1" && cmp -s "$2" "$3/job-3.ssh"' _ "$out" "$TMP/legacy_key" "$SCHELA_BACKUP_KEYS"
out="$(keys '{"op":"set","job":"../x","kind":"s3","value":"y"}')"
check "schela-backup-keys: refuses a job id that is not a number" bash -c '! jq -e .ok <<<"$1" >/dev/null' _ "$out"

keys '{"op":"set","job":4,"kind":"s3","value":"four-secret"}' >/dev/null
keys "$(jq -n --rawfile v "$TMP/id_backup" '{op:"set",job:4,kind:"ssh",value:$v}')" >/dev/null
keys '{"op":"delete","jobs":[4],"kind":"ssh"}' >/dev/null
check "schela-backup-keys: delete of one kind keeps the other" bash -c '[ ! -e "$1/job-4.ssh" ] && [ -e "$1/job-4.s3" ]' _ "$SCHELA_BACKUP_KEYS"
out="$(keys '{"op":"delete","jobs":[3,4]}')"
check "schela-backup-keys: delete removes the job's key files" bash -c 'jq -e ".removed == 2" >/dev/null <<<"$1" && [ ! -e "$2/job-3.ssh" ] && [ ! -e "$2/job-4.s3" ]' _ "$out" "$SCHELA_BACKUP_KEYS"

# The store sits in the panel user's directory: a swapped store is refused.
mv "$SCHELA_BACKUP_KEYS" "$TMP/real-keys"
mkdir -p "$TMP/elsewhere"
ln -s "$TMP/elsewhere" "$SCHELA_BACKUP_KEYS"
out="$(keys '{"op":"set","job":5,"kind":"s3","value":"five"}')"
check "schela-backup-keys: refuses a store replaced by a link" bash -c '! jq -e .ok <<<"$1" >/dev/null && [ ! -e "$2/job-5.s3" ]' _ "$out" "$TMP/elsewhere"
rm "$SCHELA_BACKUP_KEYS"
install -d -m 0700 -o schela "$SCHELA_BACKUP_KEYS"
out="$(keys '{"op":"set","job":5,"kind":"s3","value":"five"}')"
check "schela-backup-keys: refuses a store the panel user owns" bash -c '! jq -e .ok <<<"$1" >/dev/null && [ ! -e "$2/job-5.s3" ]' _ "$out" "$SCHELA_BACKUP_KEYS"
rm -rf "$SCHELA_BACKUP_KEYS"
mv "$TMP/real-keys" "$SCHELA_BACKUP_KEYS"

# ---------------------------------------------------------------- schela-backup
export SCHELA_STATE="$TMP/state.json"
export SCHELA_BACKUP_ROOT="$TMP/archives"

# S3: a local endpoint that accepts a PUT only when it is signed with S3_SECRET.
cat >"$TMP/s3.py" <<'PY'
import hashlib, hmac, http.server, os, sys
SECRET = os.environ["S3_SECRET"]
REGION = "eu-test-1"
def h(key, msg): return hmac.new(key, msg.encode(), hashlib.sha256).digest()
class S3(http.server.BaseHTTPRequestHandler):
    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        amz = self.headers["x-amz-date"]
        payload = hashlib.sha256(body).hexdigest()
        auth = self.headers.get("Authorization", "")
        canonical = "\n".join(["PUT", self.path, "", "host:" + self.headers["Host"],
            "x-amz-content-sha256:" + payload, "x-amz-date:" + amz, "",
            "host;x-amz-content-sha256;x-amz-date", payload])
        scope = f"{amz[:8]}/{REGION}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        key = h(h(h(h(("AWS4" + SECRET).encode(), amz[:8]), REGION), "s3"), "aws4_request")
        want = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        ok = payload == self.headers["x-amz-content-sha256"] and auth.endswith("Signature=" + want)
        self.send_response(200 if ok else 403)
        self.end_headers()
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), S3)
open(sys.argv[1], "w").write(str(srv.server_port))
srv.serve_forever()
PY
S3_SECRET="$S3_SECRET" python3 "$TMP/s3.py" "$TMP/s3.port" &
echo $! >"$TMP/s3.pid"
for _ in $(seq 1 50); do [ -s "$TMP/s3.port" ] && break; sleep 0.1; done
S3_URL="http://127.0.0.1:$(cat "$TMP/s3.port")"
s3_job() { # $1 job id, $2 extra JSON fields
  jq -n --argjson id "$1" --arg url "$S3_URL" --argjson extra "$2" \
    '{modules:{}, sites:[], apps:[], backups:[{id:$id, name:"s3", scope:"all", retain:2, includeMail:false,
      s3Enabled:true, s3Bucket:"schela-test", s3Prefix:"t/", s3Region:"eu-test-1", s3AccessKey:"AKIATEST",
      s3Endpoint:$url} + $extra]}' >"$SCHELA_STATE"
}
backup() { python3 "$INS/schela-backup" run "$1" 2>&1; }

s3_job 1 '{"s3Secret":"job-1.s3"}'
out="$(backup 1)"
check "schela-backup: S3 upload is signed with the secret from its key file" bash -c 'jq -e ".s3Ok == true" >/dev/null <<<"$1"' _ "$out"
keys '{"op":"set","job":6,"kind":"s3","value":"not-the-secret"}' >/dev/null
s3_job 6 '{"s3Secret":"job-6.s3"}'
out="$(backup 6)"
check "schela-backup: S3 upload with another key file is refused by the endpoint" bash -c 'jq -e ".s3Ok == false" >/dev/null <<<"$1" && grep -q "S3 PUT 403" <<<"$1"' _ "$out"
s3_job 7 "{\"s3SecretKey\":\"$S3_SECRET\"}"
out="$(backup 7)"
check "schela-backup: a secret left in state.json is not used" bash -c 'jq -e ".s3Ok == false" >/dev/null <<<"$1"' _ "$out"
s3_job 7 '{"s3Secret":"job-1.s3"}'
out="$(backup 7)"
check "schela-backup: refuses another job's key file" bash -c 'jq -e ".s3Ok == false" >/dev/null <<<"$1" && grep -q "unexpected s3 key reference" <<<"$1"' _ "$out"

# rsync over SSH to a real sshd, with the key from the store.
mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
# Never wait for a password prompt.
printf 'Host *\n  BatchMode yes\n' >/root/.ssh/config
ssh-keygen -A >/dev/null 2>&1
useradd --create-home --shell /bin/bash bk && usermod -p '*' bk
install -d -m 700 -o bk -g bk /home/bk/.ssh /home/bk/dest
install -m 600 -o bk -g bk "$TMP/id_backup.pub" /home/bk/.ssh/authorized_keys
/usr/sbin/sshd -o PidFile="$TMP/sshd.pid" -o ListenAddress=127.0.0.1 -p 22
for _ in $(seq 1 50); do [ -s "$TMP/sshd.pid" ] && break; sleep 0.1; done
rsync_job() {
  jq -n --argjson id "$1" --argjson extra "$2" \
    '{modules:{}, sites:[], apps:[], backups:[{id:$id, name:"rs", scope:"all", retain:2, includeMail:false,
      rsyncEnabled:true, rsyncDest:"bk@127.0.0.1:/home/bk/dest"} + $extra]}' >"$SCHELA_STATE"
}
rsync_job 2 '{"rsyncKey":"job-2.ssh"}'
out="$(backup 2)"
check "schela-backup: rsync over SSH authenticates with the key file" \
  bash -c 'jq -e ".rsyncOk == true" >/dev/null <<<"$1" && ls /home/bk/dest/schela-*.tar.gz >/dev/null 2>&1' _ "$out"
rm -f /home/bk/dest/*
rsync_job 8 '{}'
out="$(backup 8)"
check "schela-backup: rsync without a stored key does not get in" bash -c 'jq -e ".rsyncOk == false" >/dev/null <<<"$1"' _ "$out"
rsync_job 8 "{\"rsyncSshKey\":\"$TMP/id_backup\"}"
out="$(backup 8)"
check "schela-backup: a key path left in state.json is not used" bash -c 'jq -e ".rsyncOk == false" >/dev/null <<<"$1"' _ "$out"
unset SCHELA_STATE SCHELA_BACKUP_ROOT SCHELA_BACKUP_KEYS

if [ "$failed" -gt 0 ]; then
  echo "secrets: $failed failed"
  exit 1
fi
