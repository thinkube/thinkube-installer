#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Deploy script for thinkube installer
# Removes old package and installs the newly built one

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INSTALLERS_DIR="$PROJECT_DIR/installers"

echo "🚀 Deploying thinkube installer..."
echo ""

# Always build first
echo "📦 Building installer..."
"$SCRIPT_DIR/build.sh"
echo ""
echo "✅ Build complete, proceeding with deployment..."
echo ""

# Detect architecture
ARCH=$(dpkg --print-architecture)
echo "📦 Detected architecture: $ARCH"

# Find the .deb package
DEB_FILE="$INSTALLERS_DIR/thinkube-installer_0.1.0_${ARCH}.deb"

if [ ! -f "$DEB_FILE" ]; then
    echo "❌ Error: Package not found at $DEB_FILE after build"
    exit 1
fi

echo "📦 Found package: $(basename "$DEB_FILE")"
echo ""

# Remove old package if installed
if dpkg -l | grep -q "^ii  thinkube-installer"; then
    echo "🗑️  Removing old thinkube-installer package..."
    sudo apt remove -y thinkube-installer
    echo "✅ Old package removed"
    echo ""
else
    echo "ℹ️  No existing package found"
    echo ""
fi

# Install new package
echo "📦 Installing new package..."
sudo dpkg -i "$DEB_FILE"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Run 'thinkube-installer' to start the installer"
