#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Setup script for thinkube installer build environment
# Installs all required dependencies for building the installer

set -e

echo "🔧 Setting up thinkube installer build environment..."
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

# Check if running as root (we'll need sudo for some installs)
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Please do not run this script as root/sudo"
    echo "   The script will ask for sudo password when needed"
    exit 1
fi

# Elevation helper for the package installs below.
#
# sudo can only prompt for a password when it has a terminal. Under CI or a
# non-interactive ssh session there is none, so a bare `sudo` fails with
# "a terminal is required to read the password" partway through the run.
# Prefer passwordless sudo, then an askpass helper, and fall back to a
# normal prompt only when a terminal is actually attached.
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

# 1. Install Node.js (if not present)
echo "1️⃣  Checking Node.js..."
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js already installed: $(node --version)"
else
    echo "📦 Installing Node.js via nvm..."

    if [ ! -d "$HOME/.nvm" ]; then
        echo "   Installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

        # Load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    else
        # Load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    echo "   Installing Node.js LTS..."
    nvm install --lts
    nvm use --lts

    echo "✅ Node.js installed: $(node --version)"
fi
echo ""

# 2. Install Rust/Cargo (if not present)
echo "2️⃣  Checking Rust/Cargo..."
if command -v cargo >/dev/null 2>&1; then
    echo "✅ Rust/Cargo already installed"
    echo "   Rust: $(rustc --version)"
    echo "   Cargo: $(cargo --version)"
else
    echo "📦 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

    # Source cargo env
    source "$HOME/.cargo/env"

    echo "✅ Rust installed: $(rustc --version)"
    echo "✅ Cargo installed: $(cargo --version)"
    echo ""
    echo "⚠️  IMPORTANT: After this script completes, run:"
    echo "   source \$HOME/.cargo/env"
    echo "   OR restart your terminal"
fi
echo ""

# 3. Check Python3
echo "3️⃣  Checking Python3..."
if command -v python3 >/dev/null 2>&1; then
    echo "✅ Python3 already installed: $(python3 --version)"
else
    echo "❌ Python3 not found"
    if [ "$PLATFORM" = "Linux" ]; then
        echo "   Installing Python3..."
        run_sudo apt update
        run_sudo apt install -y python3 python3-pip python3-venv
        echo "✅ Python3 installed: $(python3 --version)"
    elif [ "$PLATFORM" = "macOS" ]; then
        echo "   Python3 should come with macOS"
        echo "   If missing, install Xcode Command Line Tools:"
        echo "   xcode-select --install"
        exit 1
    fi
fi
echo ""

# 4. Platform-specific dependencies
if [ "$PLATFORM" = "Linux" ]; then
    echo "4️⃣  Installing Linux build dependencies..."

    PACKAGES="build-essential curl wget file libxdo-dev libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev"

    echo "   The following packages will be installed:"
    echo "   $PACKAGES"
    echo ""

    run_sudo apt update
    run_sudo apt install -y $PACKAGES

    echo "✅ Linux build dependencies installed"

elif [ "$PLATFORM" = "macOS" ]; then
    echo "4️⃣  Checking macOS build dependencies..."

    # Check for Xcode Command Line Tools
    if ! xcode-select -p &> /dev/null; then
        echo "📦 Installing Xcode Command Line Tools..."
        echo "   A dialog will appear - please follow the prompts"
        xcode-select --install
        echo ""
        echo "⚠️  After Xcode Command Line Tools installation completes,"
        echo "   please re-run this script to continue setup"
        exit 0
    else
        echo "✅ Xcode Command Line Tools already installed"
    fi
fi
echo ""

# 5. Install Node.js dependencies
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "5️⃣  Installing Node.js dependencies..."
cd "$PROJECT_DIR"
npm install

cd "$PROJECT_DIR/frontend"
npm install

echo "✅ Node.js dependencies installed"
echo ""

# 6. Summary
echo "✨ Build environment setup complete!"
echo ""
echo "Next steps:"
echo "1. If Rust was just installed, run:"
echo "   source \$HOME/.cargo/env"
echo "   OR restart your terminal"
echo ""
echo "2. Build the installer:"
echo "   ./scripts/build.sh"
echo ""
echo "3. Or run in development mode:"
echo "   cd frontend && npm run tauri:dev"
