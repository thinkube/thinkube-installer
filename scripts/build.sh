#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Build script for thinkube installer (Tauri)
# Builds packages for the current platform.
#
# Usage:
#   ./scripts/build.sh [--branch <ref>] [--repo-url <url>] [--metadata-repo <org/repo>]
#
#   --branch <ref>          Bake a default value for THINKUBE_BRANCH into
#                           the binary. Without it the binary defaults to
#                           `main` at runtime. With it, the .desktop-menu
#                           launch path uses <ref> automatically; a user
#                           who launches from a terminal with
#                           THINKUBE_BRANCH set wins.
#
#   --repo-url <url>        Bake a default for THINKUBE_REPO_URL (the
#                           thinkube repo URL the installer clones from).
#                           Useful for distributing a fork-pinned deb.
#
#   --metadata-repo <org/repo>
#                           Bake a default for THINKUBE_METADATA_REPO
#                           (the metadata repo for channels / release
#                           manifests). Useful for distributing a
#                           metadata-fork-pinned deb.
#
# When any --branch / --repo-url / --metadata-repo is set, the output
# .deb filename gets a sanitised suffix so multiple flavours can sit
# side-by-side in installers/.

set -e

# Argument parsing ---------------------------------------------------------
BUILD_BRANCH=""
BUILD_REPO_URL=""
BUILD_METADATA_REPO=""

while [ $# -gt 0 ]; do
    case "$1" in
        --branch)         BUILD_BRANCH="$2";        shift 2 ;;
        --repo-url)       BUILD_REPO_URL="$2";      shift 2 ;;
        --metadata-repo)  BUILD_METADATA_REPO="$2"; shift 2 ;;
        -h|--help)
            sed -n '6,30p' "$0"   # echo the usage block above
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            echo "Try $0 --help" >&2
            exit 2
            ;;
    esac
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🏗️  Building thinkube installer..."
echo ""
if [ -n "$BUILD_BRANCH" ] || [ -n "$BUILD_REPO_URL" ] || [ -n "$BUILD_METADATA_REPO" ]; then
    echo "🔖 Bake-in defaults:"
    [ -n "$BUILD_BRANCH" ]        && echo "     THINKUBE_BRANCH         = $BUILD_BRANCH"
    [ -n "$BUILD_REPO_URL" ]      && echo "     THINKUBE_REPO_URL       = $BUILD_REPO_URL"
    [ -n "$BUILD_METADATA_REPO" ] && echo "     THINKUBE_METADATA_REPO  = $BUILD_METADATA_REPO"
    echo ""
fi

# Export so the Rust build picks them up via option_env!()
export THINKUBE_BUILD_BRANCH="$BUILD_BRANCH"
export THINKUBE_BUILD_REPO_URL="$BUILD_REPO_URL"
export THINKUBE_BUILD_METADATA_REPO="$BUILD_METADATA_REPO"

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

RUST_VERSION=$(rustc --version | awk '{print $2}')
REQUIRED_RUST="1.82.0"
echo "✅ Rust: $(rustc --version)"
echo "✅ Cargo: $(cargo --version)"

# Check and upgrade Rust if needed
if ! printf '%s\n%s\n' "$REQUIRED_RUST" "$RUST_VERSION" | sort -V -C; then
    echo ""
    echo "⚠️  Rust $RUST_VERSION detected, but Tauri v2.9.x requires Rust $REQUIRED_RUST or newer"
    echo "🔄 Updating Rust to latest stable..."
    rustup update stable
    echo "✅ Rust updated: $(rustc --version)"
fi

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
echo "🦀 Updating Rust dependencies..."
cd "$PROJECT_DIR/frontend/src-tauri"
cargo update

echo ""
echo "📦 Building installer..."
cd "$PROJECT_DIR"
npm run build

echo ""
echo "✅ Build complete!"
echo ""

# Show output packages
BUNDLE_DIR="$PROJECT_DIR/frontend/src-tauri/target/release/bundle"
INSTALLERS_DIR="$PROJECT_DIR/installers"

# Create installers directory
mkdir -p "$INSTALLERS_DIR"

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
        echo "📝 Checksums created"

        # Copy to installers directory, with a flavour suffix when any
        # bake-in flag was set so multiple builds can coexist in
        # installers/. Branch names (with `/`) become `-`.
        FLAVOUR=""
        if [ -n "$BUILD_BRANCH" ]; then
            FLAVOUR="-$(echo "$BUILD_BRANCH" | tr '/' '-')"
        fi
        echo ""
        echo "📁 Copying installers to friendly location..."
        for src in *.deb; do
            if [ -n "$FLAVOUR" ]; then
                # thinkube-installer_0.1.0_arm64.deb
                #   → thinkube-installer_0.1.0-FLAVOUR_arm64.deb
                dst=$(echo "$src" | sed -E "s/(_[0-9]+\.[0-9]+\.[0-9]+)(_.*\.deb)/\1${FLAVOUR}\2/")
                cp "$src" "$INSTALLERS_DIR/$dst"
                echo "    $src → $dst"
            else
                cp "$src" "$INSTALLERS_DIR/"
            fi
        done
        cp SHA256SUMS "$INSTALLERS_DIR/"
    fi
elif [ "$PLATFORM" = "macOS" ]; then
    echo "📦 macOS packages created:"
    if [ -d "$BUNDLE_DIR/dmg" ]; then
        ls -lh "$BUNDLE_DIR/dmg/"*.dmg 2>/dev/null || echo "   No .dmg packages found"

        # Copy DMG files (with flavour suffix when bake-in was used)
        if ls "$BUNDLE_DIR/dmg/"*.dmg &> /dev/null; then
            FLAVOUR=""
            if [ -n "$BUILD_BRANCH" ]; then
                FLAVOUR="-$(echo "$BUILD_BRANCH" | tr '/' '-')"
            fi
            echo ""
            echo "📁 Copying installers to friendly location..."
            for src in "$BUNDLE_DIR/dmg/"*.dmg; do
                if [ -n "$FLAVOUR" ]; then
                    base=$(basename "$src")
                    dst=$(echo "$base" | sed -E "s/(_[0-9]+\.[0-9]+\.[0-9]+)(_.*\.dmg)/\1${FLAVOUR}\2/")
                    cp "$src" "$INSTALLERS_DIR/$dst"
                    echo "    $base → $dst"
                else
                    cp "$src" "$INSTALLERS_DIR/"
                fi
            done
        fi
    fi
    if [ -d "$BUNDLE_DIR/macos" ]; then
        ls -lh "$BUNDLE_DIR/macos/"*.app 2>/dev/null || echo "   No .app bundles found"
    fi
fi

echo ""
echo "🎉 Build completed successfully!"
echo ""
echo "📦 Installers available at: $INSTALLERS_DIR"
if [ "$PLATFORM" = "Linux" ]; then
    ls -lh "$INSTALLERS_DIR"/*.deb 2>/dev/null
elif [ "$PLATFORM" = "macOS" ]; then
    ls -lh "$INSTALLERS_DIR"/*.dmg 2>/dev/null
fi
