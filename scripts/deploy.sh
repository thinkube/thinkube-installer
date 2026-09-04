#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Deploy script for thinkube installer.
# Builds, removes any old install, installs the freshly built deb on
# the local machine. Wrapper around build.sh + dpkg.
#
# All arguments are forwarded to build.sh — so:
#   ./scripts/deploy.sh --branch feature/foo
# produces and installs a deb baked with THINKUBE_BRANCH=feature/foo.
# See scripts/build.sh --help for the full flag list.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INSTALLERS_DIR="$PROJECT_DIR/installers"

# Elevation helper for the dpkg steps below.
#
# sudo can only prompt for a password when it has a terminal. Under CI or a
# non-interactive ssh session there is none, so a bare `sudo` fails after the
# build has already run. Prefer passwordless sudo, then an askpass helper, and
# fall back to a normal prompt only when a terminal is actually attached.
run_sudo() {
    if sudo -n true 2>/dev/null; then
        sudo -n "$@"
    elif [ -n "$SUDO_ASKPASS" ]; then
        sudo -A "$@"
    elif [ -t 0 ]; then
        sudo "$@"
    else
        echo "❌ Root privileges required for: $*" >&2
        echo "   No terminal is attached, so sudo cannot ask for a password." >&2
        echo "   Point SUDO_ASKPASS at a helper that prints it and re-run:" >&2
        echo "     SUDO_ASKPASS=/path/to/askpass $0" >&2
        exit 1
    fi
}

echo "🚀 Deploying thinkube installer..."
echo ""

# Always build first; forward all arguments to build.sh so deploy.sh
# accepts the same flags (--branch, --repo-url, --metadata-repo).
echo "📦 Building installer..."
"$SCRIPT_DIR/build.sh" "$@"
echo ""
echo "✅ Build complete, proceeding with deployment..."
echo ""

# Detect architecture
ARCH=$(dpkg --print-architecture)
echo "📦 Detected architecture: $ARCH"

# Find the freshest .deb for this architecture. With flavour suffixes
# (from build.sh's --branch) the filename varies, so glob + mtime-sort
# instead of hardcoding the path.
DEB_FILE=$(ls -t "$INSTALLERS_DIR"/thinkube-installer_*_${ARCH}.deb 2>/dev/null | head -n1)

if [ -z "$DEB_FILE" ] || [ ! -f "$DEB_FILE" ]; then
    echo "❌ Error: No thinkube-installer .deb for ${ARCH} found in $INSTALLERS_DIR after build"
    exit 1
fi

echo "📦 Found package: $(basename "$DEB_FILE")"
echo ""

# Remove old package if installed
if dpkg -l | grep -q "^ii  thinkube-installer"; then
    echo "🗑️  Removing old thinkube-installer package..."
    run_sudo apt remove -y thinkube-installer
    echo "✅ Old package removed"
    echo ""
else
    echo "ℹ️  No existing package found"
    echo ""
fi

# Install new package
echo "📦 Installing new package..."
run_sudo dpkg -i "$DEB_FILE"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Run 'thinkube-installer' to start the installer"
