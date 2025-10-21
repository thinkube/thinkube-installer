#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Build script for thinkube installer (Tauri)
# Builds packages for the current platform

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🏗️  Building thinkube installer..."
echo ""

# Detect platform
OS="$(uname -s)"
case "$OS" in
    Linux*)  PLATFORM="Linux";;
    Darwin*) PLATFORM="macOS";;
    *)       echo "Unsupported platform: $OS"; exit 1;;
esac

echo "Platform detected: $PLATFORM"
echo ""

# Check required dependencies
echo "🔍 Checking dependencies..."

command -v node >/dev/null 2>&1 || {
    echo "❌ Node.js is required but not installed."
    echo "   Install: https://nodejs.org/ or use nvm"
    exit 1
}
echo "✅ Node.js: $(node --version)"

command -v npm >/dev/null 2>&1 || {
    echo "❌ npm is required but not installed."
    exit 1
}
echo "✅ npm: $(npm --version)"

command -v cargo >/dev/null 2>&1 || {
    echo "❌ Rust/Cargo is required but not installed."
    echo "   Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
}
echo "✅ Rust: $(rustc --version)"
echo "✅ Cargo: $(cargo --version)"

command -v python3 >/dev/null 2>&1 || {
    echo "❌ Python 3 is required but not installed."
    exit 1
}
echo "✅ Python3: $(python3 --version)"

# Platform-specific dependency checks
if [ "$PLATFORM" = "Linux" ]; then
    echo ""
    echo "Checking Linux-specific dependencies..."

    MISSING_DEPS=()
    for pkg in build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev; do
        if ! dpkg -l | grep -q "^ii  $pkg"; then
            MISSING_DEPS+=("$pkg")
        fi
    done

    if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
        echo "❌ Missing system dependencies: ${MISSING_DEPS[*]}"
        echo ""
        echo "Install with:"
        echo "   sudo apt update && sudo apt install -y ${MISSING_DEPS[*]}"
        exit 1
    fi
    echo "✅ All Linux system dependencies installed"
elif [ "$PLATFORM" = "macOS" ]; then
    # Check for Xcode Command Line Tools
    if ! xcode-select -p &> /dev/null; then
        echo "❌ Xcode Command Line Tools not installed"
        echo "   Install: xcode-select --install"
        exit 1
    fi
    echo "✅ Xcode Command Line Tools installed"
fi

echo ""
echo "🔧 Installing Node.js dependencies..."

# Install root dependencies
cd "$PROJECT_DIR"
npm install

# Install frontend dependencies
cd "$PROJECT_DIR/frontend"
npm install

echo ""
echo "📦 Building installer..."
cd "$PROJECT_DIR"
npm run build

echo ""
echo "✅ Build complete!"
echo ""

# Show output packages
BUNDLE_DIR="$PROJECT_DIR/frontend/src-tauri/target/release/bundle"

if [ "$PLATFORM" = "Linux" ]; then
    echo "📦 Linux packages created:"
    if [ -d "$BUNDLE_DIR/deb" ]; then
        ls -lh "$BUNDLE_DIR/deb/"*.deb 2>/dev/null || echo "   No .deb packages found"
    fi

    # Create checksums
    if [ -d "$BUNDLE_DIR/deb" ] && ls "$BUNDLE_DIR/deb/"*.deb &> /dev/null; then
        cd "$BUNDLE_DIR/deb"
        sha256sum *.deb > SHA256SUMS
        echo ""
        echo "📝 Checksums created: $BUNDLE_DIR/deb/SHA256SUMS"
    fi
elif [ "$PLATFORM" = "macOS" ]; then
    echo "📦 macOS packages created:"
    if [ -d "$BUNDLE_DIR/dmg" ]; then
        ls -lh "$BUNDLE_DIR/dmg/"*.dmg 2>/dev/null || echo "   No .dmg packages found"
    fi
    if [ -d "$BUNDLE_DIR/macos" ]; then
        ls -lh "$BUNDLE_DIR/macos/"*.app 2>/dev/null || echo "   No .app bundles found"
    fi
fi

echo ""
echo "🎉 Build completed successfully!"
echo ""
echo "Output directory: $BUNDLE_DIR"
