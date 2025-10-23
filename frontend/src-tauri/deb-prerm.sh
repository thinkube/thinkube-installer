#!/bin/bash

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Pre-remove script for thinkube-installer .deb package
# Cleans up Python virtual environment created by post-install

set -e

echo "Cleaning up thinkube-installer backend environment..."

# Find and remove backend venv
for base_dir in "/usr/lib/thinkube-installer" "/opt/thinkube-installer" "/usr/share/thinkube-installer"; do
    if [ -d "$base_dir/backend/.venv" ]; then
        echo "Removing virtual environment at $base_dir/backend/.venv"
        rm -rf "$base_dir/backend/.venv"
    fi
done

echo "Backend cleanup complete"

exit 0
