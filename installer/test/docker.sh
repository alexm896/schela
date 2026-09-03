#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
docker build -f installer/test/Dockerfile -t schela-installer-test .
docker run --rm schela-installer-test
