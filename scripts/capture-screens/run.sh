#!/bin/bash
# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Runs the installer in the browser and captures every page.
#
# Starts the installer backend and page with scripts/dev-services.sh, runs
# capture.mjs with the arguments given here, then stops the services.
#
# The values capture.mjs types are read from ~/.config/thinkube-capture.env
# (mode 600): THINKUBE_SUDO_PASSWORD, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL.
#
# Usage:
#   ./run.sh --server tkamd1                                  # the whole install
#   ./run.sh --server tkamd1 --stop-at tailscale-operator-setup  # stop before anything is installed

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(dirname "$HERE")"
VALUES="$HOME/.config/thinkube-capture.env"

if [ ! -f "$VALUES" ]; then
    echo "❌ $VALUES is missing. It holds THINKUBE_SUDO_PASSWORD, GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL." >&2
    exit 1
fi
set -a
# shellcheck source=/dev/null
source "$VALUES"
set +a

# shellcheck source=/dev/null
source "$HOME/.nvm/nvm.sh"

"$SCRIPTS/dev-services.sh" --no-wait
trap '"$SCRIPTS/dev-services.sh" stop' EXIT

cd "$HERE"
[ -d node_modules ] || npm install --no-fund --no-audit
node capture.mjs "$@"
