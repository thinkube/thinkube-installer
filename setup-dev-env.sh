#!/bin/bash

# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Development environment setup script for thinkube installer

set -e

echo "🔧 Setting up development environment for thinkube installer"
echo "=========================================================="
echo ""

# Check if running on Ubuntu/Debian
if ! command -v apt &> /dev/null; then
    echo "❌ This script requires apt package manager (Ubuntu/Debian)"
    exit 1
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# 1. Install system dependencies
echo "📦 Installing system dependencies..."
echo "This will require sudo access"
echo ""

PACKAGES="build-essential curl wget file libxdo-dev libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev python3 python3-pip python3-venv"

echo "Installing: $PACKAGES"
sudo apt update
sudo apt install -y $PACKAGES

echo "✅ System dependencies installed"
echo ""

# 2. Install Rust
if ! command_exists cargo; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "✅ Rust installed successfully"
else
    echo "✅ Rust already installed: $(cargo --version)"
fi
echo ""

# 3. Check Node.js
if ! command_exists node || ! command_exists npm; then
    echo "❌ Node.js not found. Please install Node.js v20 or later"
    echo "   Recommended: Use nvm (Node Version Manager)"
    echo "   https://github.com/nvm-sh/nvm"
    exit 1
else
    echo "✅ Node.js found: $(node --version)"
    echo "✅ npm found: $(npm --version)"
fi
echo ""

# 4. Install Python dependencies for backend
echo "🐍 Setting up Python environment..."
cd backend
if [[ ! -d "venv" ]]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt
deactivate
cd ..
echo "✅ Python environment ready"
echo ""

# 5. Install Node dependencies
echo "📦 Installing Node.js dependencies..."
npm install
cd frontend
npm install
cd ..
echo "✅ Node.js dependencies installed"
echo ""

# 6. Final instructions
echo "✨ Development environment setup complete!"
echo ""
echo "To start developing:"
echo "   cd frontend"
echo "   npm run tauri:dev"
echo ""
echo "Note: If you just installed Rust, you may need to run:"
echo "   source $HOME/.cargo/env"
echo "Or restart your terminal"