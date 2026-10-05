#!/bin/bash
# Managed databases against real MariaDB and PostgreSQL servers.
# Run as root in the test container, after run.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INS="$ROOT/installer"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# Hashes of PASS as produced by src/features/databases/password.ts (pinned by its unit tests).
PASS='correct horse battery staple'
MHASH='*F4AF2E5D85456A908E0F552F0366375B06267295'
PHASH='SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$ONYbSJBXtKl6bP6PVqw8pm9e7EiacprLnoUQPFS80Hw=:IPOtHuGJ2HifEQg74W2XXqqCrCyQG55GbPRHa6g6n9w='

export SCHELA_STATE=/tmp/schela-db-state.json
export SCHELA_DB_SYNC_DIR=/tmp/schela-db-sync
DB="$INS/schela-db"
rm -rf "$SCHELA_DB_SYNC_DIR"

echo "== database servers"
service mariadb start >/dev/null
service postgresql start >/dev/null
for _ in $(seq 1 30); do
  mariadb-admin --protocol=socket ping >/dev/null 2>&1 && pg_isready -q && break
  sleep 1
done
mariadb-admin --protocol=socket ping >/dev/null 2>&1 || fail "mariadb did not start"
pg_isready -q || fail "postgresql did not start"
pass "mariadb $(mariadb -N -B -e 'SELECT VERSION()'), postgresql $(runuser -u postgres -- psql -X -A -t -c 'SHOW server_version')"

# write_state <mariadb section JSON> <postgresql section JSON> [modules JSON]
write_state() {
  local mods="${3:-}"
  [ -n "$mods" ] || mods='{"mariadb":true,"postgresql":true}'
  jq -n --arg mh "$MHASH" --arg ph "$PHASH" \
    --argjson my "$1" --argjson pg "$2" --argjson mods "$mods" '
    def hashed(h): .users |= map(.passwordHash //= h);
    {
      settings: {hostname: "panel.test"},
      modules: $mods,
      databases: {mariadb: ($my | hashed($mh)), postgresql: ($pg | hashed($ph))}
    }' >"$SCHELA_STATE"
}
sync_db() {
  python3 "$DB" sync "$@" 2>/tmp/schela-db.log || { cat /tmp/schela-db.log; fail "sync failed"; }
}
# Run a statement as a managed user over TCP, like an app would.
my() { local user="$1" db="$2"; shift 2; mariadb --protocol=tcp -h 127.0.0.1 -u "$user" -p"$PASS" -N -B "$db" -e "$*"; }
pg() { local user="$1" db="$2"; shift 2; PGPASSWORD="$PASS" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$user" -d "$db" -c "$*"; }
root_my() { mariadb --protocol=socket -N -B -e "$*"; }
root_pg() { local db="$1"; shift; runuser -u postgres -- psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$db" -c "$*"; }
ok() { "$@" >/dev/null 2>&1 || fail "expected to work: $*"; }
denied() { if "$@" >/dev/null 2>&1; then fail "expected to be refused: $*"; fi; }
helper() { printf '%s' "$1" | python3 "$DB"; }
helper_ok() { helper "$1" | jq -e '.ok == true' >/dev/null || fail "helper refused $1"; }
helper_refuses() {
  local out
  out="$(helper "$1" || true)"
  printf '%s' "$out" | jq -e '.ok == false' >/dev/null || fail "helper accepted $1"
}

echo "== mariadb: databases, users, access"
MY_DBS='[{"name":"shop"},{"name":"stats"}]'
write_state "{\"databases\":$MY_DBS,\"users\":[
  {\"name\":\"app\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]},
  {\"name\":\"report\",\"grants\":[{\"database\":\"shop\",\"level\":\"readonly\"},{\"database\":\"stats\",\"level\":\"readwrite\"}]}
]}" '{"databases":[],"users":[]}'
sync_db mariadb
[ "$(root_my "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='shop'")" = utf8mb4 ] \
  || fail "shop is not utf8mb4"
[ "$(root_my "SELECT GROUP_CONCAT(Host ORDER BY Host) FROM mysql.user WHERE User='app'")" = "127.0.0.1,::1,localhost" ] \
  || fail "app accounts are not exactly the loopback hosts"
pass "databases created as utf8mb4, users on loopback only"

ok my app shop "CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a')"
ok my app shop "ALTER TABLE t ADD COLUMN w INT"
denied my app stats "SELECT 1"
pass "full user owns its database and nothing else"

ok my report shop "SELECT v FROM t"
denied my report shop "INSERT INTO t (v) VALUES ('x')"
denied my report shop "DELETE FROM t"
denied my report shop "CREATE TABLE r (id INT)"
pass "read-only user can only read"

root_my "CREATE TABLE stats.s (id INT AUTO_INCREMENT PRIMARY KEY, v TEXT)"
ok my report stats "INSERT INTO s (v) VALUES ('x'); UPDATE s SET v='y'; DELETE FROM s"
denied my report stats "CREATE TABLE r (id INT)"
denied my report stats "ALTER TABLE s ADD COLUMN w INT"
denied my report stats "DROP TABLE s"
pass "read-write user changes data, not tables"

sync_db mariadb
! grep -q 'sync user' /tmp/schela-db.log || { cat /tmp/schela-db.log; fail "unchanged users were synced again"; }
pass "second sync leaves unchanged users alone"

write_state "{\"databases\":$MY_DBS,\"users\":[
  {\"name\":\"app\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]},
  {\"name\":\"report\",\"grants\":[{\"database\":\"stats\",\"level\":\"full\"}]}
]}" '{"databases":[],"users":[]}'
sync_db mariadb
grep -q 'sync user report' /tmp/schela-db.log || fail "changed user not synced"
! grep -q 'sync user app' /tmp/schela-db.log || fail "unchanged user synced"
ok my report stats "CREATE TABLE r (id INT)"
denied my report shop "SELECT v FROM t"
pass "changing access applies exactly the new grants"

write_state "{\"databases\":$MY_DBS,\"users\":[{\"name\":\"app\",\"passwordHash\":\"$(printf '%s' "$MHASH" | sed 's/F4/00/')\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]}]}" \
  '{"databases":[],"users":[]}'
sync_db mariadb
denied my app shop "SELECT 1"
write_state "{\"databases\":$MY_DBS,\"users\":[{\"name\":\"app\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]}]}" \
  '{"databases":[],"users":[]}'
sync_db mariadb
ok my app shop "SELECT 1"
pass "password changes take effect"

echo "== mariadb: hostile state"
root_my "CREATE DATABASE keepme"
write_state '{"databases":[
  {"name":"shop`; DROP DATABASE keepme; --"},{"name":"mysql"},{"name":"Shop"},{"name":"pg_x"},{"name":"schela_x"}
],"users":[
  {"name":"root","grants":[]},
  {"name":"evil","passwordHash":"x'"'"' OR 1=1","grants":[]},
  {"name":"evil2","passwordHash":"*F4AF2E5D85456A908E0F552F0366375B06267295'"'"'; DROP DATABASE keepme; --","grants":[]},
  {"name":"evil3","grants":[{"database":"mysql","level":"full"},{"database":"keepme","level":"full"},{"database":"shop","level":"owner"}]}
]}' '{"databases":[],"users":[]}'
sync_db mariadb
[ "$(root_my "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='keepme'")" = 1 ] || fail "keepme was dropped"
[ "$(root_my "SELECT COUNT(*) FROM mysql.user WHERE User IN ('evil','evil2')")" = 0 ] || fail "user with bad hash created"
[ "$(root_my "SELECT COUNT(*) FROM mysql.user WHERE User='root' AND Host='localhost' AND plugin='mysql_native_password' AND authentication_string='$MHASH'")" = 0 ] \
  || fail "root password was changed"
denied my evil3 mysql "SELECT 1"
denied my evil3 keepme "SELECT 1"
grep -q 'skip database' /tmp/schela-db.log && grep -q 'bad password hash' /tmp/schela-db.log \
  || { cat /tmp/schela-db.log; fail "hostile entries were not reported"; }
pass "injected names, reserved names, bad hashes and foreign grants are skipped"

echo "== mariadb: helper ops"
write_state "{\"databases\":$MY_DBS,\"users\":[
  {\"name\":\"app\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]},
  {\"name\":\"report\",\"grants\":[{\"database\":\"stats\",\"level\":\"full\"}]}
]}" '{"databases":[],"users":[]}'
sync_db mariadb
helper '{"op":"info"}' | jq -e '.ok and .engines.mariadb.running and (.engines.mariadb.sizes.shop | type == "number") and (.engines.mariadb.sizes | has("keepme") | not)' >/dev/null \
  || fail "info does not report managed sizes only"
helper_refuses '{"op":"drop-database","engine":"mariadb","name":"mysql"}'
helper_refuses '{"op":"drop-database","engine":"mariadb","name":"keepme"}'
helper_refuses '{"op":"drop-database","engine":"mariadb","name":"shop`; DROP DATABASE keepme; --"}'
helper_refuses '{"op":"drop-user","engine":"mariadb","name":"root"}'
helper_refuses '{"op":"drop-user","engine":"oracle","name":"app"}'
helper_refuses '{"op":"shell","cmd":"id"}'
[ "$(root_my "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('keepme','mysql')")" = 2 ] || fail "refused drop dropped something"
pass "helper refuses system, unmanaged and malformed names"
helper_ok '{"op":"drop-user","engine":"mariadb","name":"report"}'
[ "$(root_my "SELECT COUNT(*) FROM mysql.user WHERE User='report'")" = 0 ] || fail "report accounts left behind"
helper_ok '{"op":"drop-database","engine":"mariadb","name":"stats"}'
[ "$(root_my "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='stats'")" = 0 ] || fail "stats not dropped"
ok my app shop "SELECT v FROM t"
pass "helper drops managed users and databases only"

echo "== postgresql: databases, users, access"
PG_DBS='[{"name":"shop"},{"name":"stats"}]'
PG_USERS='[
  {"name":"app","grants":[{"database":"shop","level":"full"}]},
  {"name":"app2","grants":[{"database":"shop","level":"full"}]},
  {"name":"report","grants":[{"database":"shop","level":"readonly"},{"database":"stats","level":"readwrite"}]},
  {"name":"outsider","grants":[]}
]'
write_state '{"databases":[],"users":[]}' "{\"databases\":$PG_DBS,\"users\":$PG_USERS}"
sync_db postgresql
[ "$(root_pg postgres "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='shop'")" = schela_owner_shop ] \
  || fail "shop is not owned by its owner role"
[ "$(root_pg postgres "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname='shop'")" = UTF8 ] || fail "shop is not UTF8"
pass "databases created as UTF8, owned by their owner role"

ok pg app shop "CREATE TABLE t (id serial PRIMARY KEY, v text); INSERT INTO t (v) VALUES ('a')"
[ "$(root_pg shop "SELECT tableowner FROM pg_tables WHERE tablename='t'")" = schela_owner_shop ] \
  || fail "table made by a full user is not owned by the database"
ok pg app2 shop "INSERT INTO t (v) VALUES ('b'); ALTER TABLE t ADD COLUMN w int"
denied pg app stats "SELECT 1"
pass "full users share their database's tables"

ok pg report shop "SELECT v FROM t"
denied pg report shop "INSERT INTO t (v) VALUES ('x')"
denied pg report shop "CREATE TABLE r (id int)"
denied pg outsider shop "SELECT 1"
pass "read-only user can only read; users without access cannot connect"

ok pg app shop "CREATE TABLE later (id serial PRIMARY KEY, v text); INSERT INTO later (v) VALUES ('z')"
ok pg report shop "SELECT v FROM later"
pass "tables created later are readable through default privileges"

root_pg stats "SET ROLE schela_owner_stats; CREATE TABLE s (id serial PRIMARY KEY, v text)"
ok pg report stats "INSERT INTO s (v) VALUES ('x'); UPDATE s SET v='y'; DELETE FROM s"
denied pg report stats "CREATE TABLE r (id int)"
denied pg report stats "ALTER TABLE s ADD COLUMN w int"
denied pg report stats "DROP TABLE s"
pass "read-write user changes data, not tables"

sync_db postgresql
! grep -q 'sync user' /tmp/schela-db.log || { cat /tmp/schela-db.log; fail "unchanged users were synced again"; }
pass "second sync leaves unchanged users alone"

write_state '{"databases":[],"users":[]}' "{\"databases\":$PG_DBS,\"users\":[
  {\"name\":\"app\",\"grants\":[{\"database\":\"shop\",\"level\":\"full\"}]},
  {\"name\":\"app2\",\"grants\":[{\"database\":\"shop\",\"level\":\"readonly\"}]},
  {\"name\":\"report\",\"grants\":[{\"database\":\"shop\",\"level\":\"readonly\"},{\"database\":\"stats\",\"level\":\"readwrite\"}]},
  {\"name\":\"outsider\",\"grants\":[]}
]}"
sync_db postgresql
grep -q 'sync user app2' /tmp/schela-db.log || fail "changed user not synced"
! grep -q 'sync user report' /tmp/schela-db.log || fail "unchanged user synced"
ok pg app2 shop "SELECT v FROM t"
denied pg app2 shop "INSERT INTO t (v) VALUES ('c')"
denied pg app2 shop "ALTER TABLE t ADD COLUMN x int"
pass "downgrading full to read-only takes the owner role away"

echo "== postgresql: hostile state"
root_pg postgres "CREATE DATABASE keepme"
write_state '{"databases":[],"users":[]}' '{"databases":[
  {"name":"shop\"; DROP DATABASE keepme; --"},{"name":"postgres"},{"name":"template1"},{"name":"pg_x"}
],"users":[
  {"name":"postgres","grants":[]},
  {"name":"evil","passwordHash":"md5abc","grants":[]},
  {"name":"evil2","passwordHash":"SCRAM-SHA-256$4096:a$b:c'"'"'; ALTER ROLE evil2 SUPERUSER; --","grants":[]},
  {"name":"evil3","grants":[{"database":"keepme","level":"full"},{"database":"postgres","level":"full"}]}
]}'
sync_db postgresql
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_database WHERE datname='keepme'")" = 1 ] || fail "keepme was dropped"
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_roles WHERE rolname IN ('evil','evil2')")" = 0 ] || fail "user with bad hash created"
[ "$(root_pg postgres "SELECT rolsuper FROM pg_roles WHERE rolname='evil3'")" = f ] || fail "evil3 is a superuser"
# keepme was made by hand, so PostgreSQL's default lets any role connect; the
# point is that the grant listed in the state gave evil3 nothing inside it.
root_pg keepme "CREATE TABLE secret (v text); INSERT INTO secret VALUES ('x')"
denied pg evil3 keepme "SELECT v FROM secret"
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname='evil3'")" = 0 ] \
  || fail "evil3 was given a role membership"
pass "injected names, reserved names, bad hashes and foreign grants are skipped"

echo "== postgresql: helper ops"
write_state '{"databases":[],"users":[]}' "{\"databases\":$PG_DBS,\"users\":$PG_USERS}"
sync_db postgresql
helper '{"op":"info"}' | jq -e '.engines.postgresql.running and (.engines.postgresql.sizes.shop > 0) and (.engines.postgresql.sizes | has("keepme") | not)' >/dev/null \
  || fail "info does not report managed sizes only"
helper_refuses '{"op":"drop-database","engine":"postgresql","name":"postgres"}'
helper_refuses '{"op":"drop-database","engine":"postgresql","name":"keepme"}'
helper_refuses '{"op":"drop-user","engine":"postgresql","name":"postgres"}'
helper_ok '{"op":"drop-user","engine":"postgresql","name":"report"}'
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_roles WHERE rolname='report'")" = 0 ] || fail "report role left behind"
helper_ok '{"op":"drop-database","engine":"postgresql","name":"stats"}'
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_database WHERE datname='stats'")" = 0 ] || fail "stats not dropped"
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_roles WHERE rolname='schela_owner_stats'")" = 0 ] || fail "owner role left behind"
ok pg app shop "SELECT v FROM t"
pass "helper drops managed users and databases only"

echo "== sudo boundary and modules"
out="$(printf '%s' '{"op":"info"}' | SUDO_USER=schela python3 "$DB" || true)"
echo "$out" | grep -q 'Panel state is not readable' || fail "helper honoured SCHELA_STATE under sudo"
out="$(SUDO_USER=schela python3 "$DB" sync 2>&1 || true)"
echo "$out" | grep -q 'Panel state is not readable' || fail "sync honoured SCHELA_STATE under sudo"
mkdir -p /var/lib/schela
cp "$SCHELA_STATE" /var/lib/schela/state.json
SUDO_USER=schela python3 "$DB" sync 2>/tmp/schela-db.log || { cat /tmp/schela-db.log; fail "sync failed when schela-apply runs through sudo"; }
rm -f /var/lib/schela/state.json
pass "under sudo: fixed state file; sync still works for schela-apply"

write_state '{"databases":[{"name":"offdb"}],"users":[]}' '{"databases":[{"name":"offdb"}],"users":[]}' '{"mariadb":false,"postgresql":false}'
sync_db
[ "$(root_my "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='offdb'")" = 0 ] || fail "synced a module that is off"
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_database WHERE datname='offdb'")" = 0 ] || fail "synced a module that is off"
pass "engines whose module is off are not touched"

echo "== schela-apply: database modules"
for bin in systemctl; do
  [ -e "/usr/bin/$bin" ] && mv "/usr/bin/$bin" "/usr/bin/$bin.real"
done
cat >/usr/bin/systemctl <<'SH'
#!/bin/bash
printf '%s\n' "$*" >>/tmp/systemctl.log
exit 0
SH
chmod 755 /usr/bin/systemctl
export SCHELA_DB="$DB"
export SCHELA_SYSTEMD_DIR=/tmp/schela-systemd-db
mkdir -p "$SCHELA_SYSTEMD_DIR" /etc/cron.d
apply_state() {
  jq -n --arg mh "$MHASH" --argjson mods "$1" '{
    settings: {hostname: "panel.test"},
    modules: $mods,
    sites: [], apps: [], firewall: [], mailboxes: [], cron: [], backups: [], workers: [], dns: {zones: []},
    databases: {
      mariadb: {databases: [{name: "applied"}], users: [{name: "applier", passwordHash: $mh, grants: [{database: "applied", level: "full"}]}]},
      postgresql: {databases: [{name: "applied"}], users: []}
    }
  }' >"$SCHELA_STATE"
}
apply_now() { : >/tmp/systemctl.log; bash "$INS/schela-apply" >/tmp/schela-apply.out 2>&1 || { cat /tmp/schela-apply.out; fail "apply failed"; }; }
CNF=/etc/mysql/mariadb.conf.d/99-schela.cnf
PGCONF="$(ls -d /etc/postgresql/*/main | tail -1)/conf.d/99-schela.conf"
rm -f "$CNF" "$PGCONF"

apply_state '{"mariadb":true,"postgresql":true}'
apply_now
grep -qx 'bind-address = 127.0.0.1' "$CNF" || fail "mariadb not bound to localhost"
grep -qx "listen_addresses = 'localhost'" "$PGCONF" || fail "postgresql not bound to localhost"
grep -qx 'restart mariadb' /tmp/systemctl.log || fail "mariadb not restarted after its config changed"
grep -qx 'restart postgresql' /tmp/systemctl.log || fail "postgresql not restarted after its config changed"
ok my applier applied "SELECT 1"
[ "$(root_pg postgres "SELECT COUNT(*) FROM pg_database WHERE datname='applied'")" = 1 ] || fail "apply did not sync postgresql"
pass "apply configures both engines and syncs their databases"

apply_now
! grep -q '^restart' /tmp/systemctl.log || fail "unchanged config restarted a database server"
grep -qx 'start mariadb' /tmp/systemctl.log || fail "mariadb not kept running"
pass "unchanged config does not restart database servers"

apply_state '{"mariadb":false,"postgresql":false}'
apply_now
grep -qx 'disable --now mariadb' /tmp/systemctl.log || fail "mariadb not stopped when its module is off"
grep -qx 'disable --now postgresql' /tmp/systemctl.log || fail "postgresql not stopped when its module is off"
[ "$(root_my "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='applied'")" = 1 ] || fail "data removed with the module"
pass "module off stops the server and keeps the data"

rm -f "$CNF" "$PGCONF"
apply_now
! grep -qE '^disable --now (mariadb|postgresql)$' /tmp/systemctl.log || fail "stopped a database server schela did not set up"
pass "a database server installed by hand is left alone"

apply_state '{"mariadb":true,"postgresql":false}'
export SCHELA_DB=/nonexistent/schela-db
: >/tmp/systemctl.log
if bash "$INS/schela-apply" >/tmp/schela-apply.out 2>&1; then fail "apply hid a failed database sync"; fi
grep -q 'reload nginx' /tmp/systemctl.log || fail "a failed database sync held back nginx"
pass "a failed database sync fails the apply after nginx is reloaded"

rm -f /usr/bin/systemctl
mv /usr/bin/systemctl.real /usr/bin/systemctl 2>/dev/null || true
echo "databases: all checks passed"
