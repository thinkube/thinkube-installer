#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Post-install script for thinkube-installer .deb package
# Sets up Python virtual environment for the backend

set -e

# Find backend in Tauri resources directory
# Tauri installs to /usr/bin/thinkube-installer and resources are typically in /usr/lib
BACKEND_DIR="/usr/lib/thinkube-installer/backend"

# If not found, try finding it in the standard Tauri location
if [ ! -d "$BACKEND_DIR" ]; then
    # Look for backend in possible locations
    for dir in /usr/lib/thinkube-installer /opt/thinkube-installer /usr/share/thinkube-installer; do
        if [ -d "$dir/backend" ]; then
            BACKEND_DIR="$dir/backend"
            break
        fi
    done
fi

VENV_DIR="$BACKEND_DIR/.venv"

echo "Setting up thinkube-installer backend environment..."

# Check if backend directory exists
if [ ! -d "$BACKEND_DIR" ]; then
    echo "ERROR: Backend directory not found"
    echo "Searched locations: /usr/lib/thinkube-installer/backend, /opt/thinkube-installer/backend, /usr/share/thinkube-installer/backend"
    exit 1
fi

# Check if requirements.txt exists
if [ ! -f "$BACKEND_DIR/requirements.txt" ]; then
    echo "ERROR: requirements.txt not found at $BACKEND_DIR/requirements.txt"
    exit 1
fi

# Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"

# Activate and install dependencies
echo "Installing backend dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "Backend environment setup complete"

# Standard debian post-install
#DEBHELPER#

exit 0
