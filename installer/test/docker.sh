#!/bin/bash
# Installer tests on every supported system.
#   installer/test/docker.sh                 all systems
#   installer/test/docker.sh ubuntu:26.04    one system
# Set SCHELA_TEST_NETWORK=0 to skip packages.sh and search.sh (they need packages.sury.org,
# nodejs.org, GitHub and dl.typesense.org).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bases=("$@")
[ "${#bases[@]}" -gt 0 ] || bases=(ubuntu:22.04 ubuntu:24.04 ubuntu:26.04 debian:12 debian:13)
failed=()
for base in "${bases[@]}"; do
  tag="schela-installer-test:${base//[:.]/-}"
  echo "######## $base"
  if ! docker build -q --build-arg "BASE=$base" -f installer/test/Dockerfile -t "$tag" . >/dev/null; then
    failed+=("$base (build)")
    continue
  fi
  docker run --rm "$tag" || failed+=("$base")
  if [ "${SCHELA_TEST_NETWORK:-1}" = "1" ]; then
    docker run --rm -v "$ROOT/installer:/opt/schela/installer:ro" "$base" \
      bash /opt/schela/installer/test/packages.sh || failed+=("$base (packages)")
    # The real engines; downloads are verified and kept in .cache between runs.
    mkdir -p "$ROOT/.cache/search-downloads"
    docker run --rm -v "$ROOT/installer:/opt/schela/installer:ro" \
      -v "$ROOT/.cache/search-downloads:/var/cache/schela-downloads" \
      -e SCHELA_DOWNLOAD_CACHE=/var/cache/schela-downloads "$tag" \
      bash /opt/schela/installer/test/search.sh || failed+=("$base (search)")
  fi
done
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'FAILED: %s\n' "${failed[@]}"
  exit 1
fi
echo "all ${#bases[@]} systems passed"
