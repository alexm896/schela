#!/bin/bash
# Schela — install from the repo root.
#   git clone <this-repo> && cd <this-repo>
#   sudo bash install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/installer/install.sh" "$@"
