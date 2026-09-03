#!/bin/sh
# Schela is installed from git, not a curl pipe.
# On a fresh Ubuntu/Debian VPS:
#
#   git clone https://github.com/imariusalin/schela.git
#   cd schela
#   sudo bash install.sh
set -eu
echo "Schela is installed from the git repo, not this stub."
echo
echo "  git clone https://github.com/imariusalin/schela.git"
echo "  cd schela"
echo "  sudo bash install.sh"
echo
exit 1
