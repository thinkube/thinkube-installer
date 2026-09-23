#!/bin/bash
# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Starts the installer with screen capture in a tmux session named "capture",
# so it keeps running when the terminal closes.
#
#   window "installer"    run.sh with the arguments given here
#   window "ansible-log"  the installer backend log: the Ansible output,
#                         with secrets blanked
#
# Usage:
#   ./start.sh --server tkamd1
#
# In tmux: Ctrl+B then N switches to the other window, Ctrl+B then D leaves
# it running. `tmux attach -t capture` comes back.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION=capture
BACKEND_LOG=/tmp/thinkube-installer-backend.log

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "❌ A capture is already running. Look at it with: tmux attach -t $SESSION" >&2
    exit 1
fi

tmux new-session -d -s "$SESSION" -n installer -c "$HERE" \
    "./run.sh $(printf '%q ' "$@"); echo; echo 'The capture has ended. Press Enter to close this window.'; read"
tmux new-window -t "$SESSION" -n ansible-log "tail -F $BACKEND_LOG"
tmux select-window -t "$SESSION:installer"

echo "Started. Screenshots go to $HERE/screens/<date-time>/"
echo "Window \"installer\" lists each screenshot as it is saved; Ctrl+B then N shows the Ansible output."
echo "A failed playbook waits in the \"installer\" window: fix it in the clone named there and press Enter to run the step again."
if [ -t 1 ]; then
    tmux attach -t "$SESSION"
else
    echo "Look at it with: tmux attach -t $SESSION"
fi
