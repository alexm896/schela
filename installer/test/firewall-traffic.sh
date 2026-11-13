#!/bin/bash
# Real packets through the firewall schela-apply builds: a server container
# applies the state, a client container on the same Docker network connects.
#   installer/test/firewall-traffic.sh IMAGE_TAG
# Run on the Docker host (installer/test/docker.sh does).
set -uo pipefail
tag="$1"
id="$(printf '%s' "$tag" | cksum | cut -d' ' -f1)"
net="schela-fw-$id" srv="schela-fw-srv-$id" cli="schela-fw-cli-$id"
failed=0
out="$(mktemp)"
cleanup() { docker rm -f "$srv" "$cli" >/dev/null 2>&1; docker network rm "$net" >/dev/null 2>&1; rm -f "$out"; }
cleanup
trap cleanup EXIT

echo "== firewall traffic (two containers)"
docker network create "$net" >/dev/null || exit 1
docker run -d --name "$srv" --network "$net" --cap-add NET_ADMIN "$tag" sleep infinity >/dev/null || exit 1
docker run -d --name "$cli" --network "$net" "$tag" sleep infinity >/dev/null || exit 1
ip_of() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"; }
srv_ip="$(ip_of "$srv")"
cli_ip="$(ip_of "$cli")"
[ -n "$srv_ip" ] && [ -n "$cli_ip" ] || { echo "FAIL no container addresses"; exit 1; }

docker exec "$srv" bash -c '
  for p in 80 8080; do nohup python3 -m http.server "$p" --bind 0.0.0.0 >/dev/null 2>&1 & done
  sed "/^log \"applying /,\$d" /opt/schela/installer/schela-apply >/tmp/apply-lib.sh
  sleep 1' || exit 1

# apply RULES_JSON: the state with these panel rules, then apply_firewall.
apply() {
  docker exec -e RULES="$1" "$srv" bash -c '
    export SCHELA_STATE=/tmp/state.json SCHELA_VERSIONS=/opt/schela/installer/versions.json
    jq -n --argjson r "$RULES" "{settings: {sshPort: 22}, modules: {}, firewall: \$r}" >"$SCHELA_STATE"
    ( source /tmp/apply-lib.sh; apply_firewall )' >"$out" 2>&1 \
    || { cat "$out"; echo "FAIL apply"; exit 1; }
}
# reach PORT: 0 when the client gets a TCP connection to the server.
reach() {
  docker exec "$cli" python3 -c 'import socket, sys
socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=2).close()' "$srv_ip" "$1" 2>/dev/null
}
check() { # description, expected (open|closed), port
  local got=closed
  reach "$3" && got=open
  if [ "$got" = "$2" ]; then printf 'ok   %s\n' "$1"; else printf 'FAIL %s (port %s is %s)\n' "$1" "$3" "$got" >&2; failed=1; fi
}

apply "[{\"enabled\":true,\"action\":\"allow\",\"protocol\":\"tcp\",\"port\":\"8080\",\"source\":\"any\"}]"
check "base allow: 80/tcp answers" open 80
check "panel allow: 8080/tcp answers" open 8080

apply "[{\"enabled\":true,\"action\":\"deny\",\"protocol\":\"tcp\",\"port\":\"80\",\"source\":\"$cli_ip\"},
        {\"enabled\":true,\"action\":\"allow\",\"protocol\":\"tcp\",\"port\":\"8080\",\"source\":\"any\"}]"
check "deny from the client wins over the base allow on 80/tcp" closed 80
check "the deny leaves 8080/tcp alone" open 8080

apply "[{\"enabled\":false,\"action\":\"deny\",\"protocol\":\"tcp\",\"port\":\"80\",\"source\":\"$cli_ip\"}]"
check "deny turned off: 80/tcp answers again" open 80
check "allow removed: 8080/tcp is closed" closed 8080

exit "$failed"
