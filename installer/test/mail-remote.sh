#!/bin/bash
# Mail as seen from another host: a second container on a private Docker
# network logs in and submits against a server configured by mail.sh. Dovecot
# treats a connection as secured when the client IP equals the server IP, so
# only a client on a different address shows what an outside client gets.
#   installer/test/mail-remote.sh <image tag built by docker.sh>
set -uo pipefail
tag="$1"
net="schela-mail-$$-${RANDOM}"
srv=""
cleanup() {
  [ -z "$srv" ] || docker rm -f "$srv" >/dev/null 2>&1
  docker network rm "$net" >/dev/null 2>&1
}
trap cleanup EXIT

echo "== mail from another host"
docker network create "$net" >/dev/null || exit 1
srv="$(docker run -d --network "$net" "$tag" sleep infinity)" || exit 1
# Its own report comes from run.sh; here it only prepares the server. Go on
# even if it fails, so every remote case still reports.
rc=0
if ! out="$(docker exec -e SCHELA_MAIL_KEEP=1 "$srv" bash /opt/schela/installer/test/mail.sh 2>&1)"; then
  printf '%s\n' "$out"
  echo "FAIL mail server setup"
  rc=1
fi
ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$srv")"
[ -n "$ip" ] || { echo "FAIL no server address"; exit 1; }
docker exec "$srv" cat /var/lib/schela/tls/host.crt |
  docker run --rm -i --network "$net" -e SCHELA_MAIL_PASS='Secret-123' -e SCHELA_HOST_CRT=/tmp/host.crt "$tag" \
    sh -c 'cat >/tmp/host.crt && exec python3 /opt/schela/installer/test/mail_client.py remote "$0"' "$ip" || rc=1
exit "$rc"
