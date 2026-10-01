#!/bin/bash

# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

# Updates the installer's dependencies on purpose, npm and Cargo together.
#
# The build (scripts/build.sh) uses only the locked versions. Run this script
# before a release and when Dependabot reports a high or critical issue, then
# build, test, and commit package.json, package-lock.json and
# frontend/src-tauri/Cargo.lock.
#
# Tauri refuses to build when the Rust crate `tauri` and the npm packages
# @tauri-apps/api and @tauri-apps/cli are on different minor versions, so
# the npm packages are set to the minor version Cargo resolves.
#
# Usage: ./scripts/update-deps.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

for tool in npm cargo cargo-audit; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "❌ $tool is required. Run scripts/setup-build-env.sh first." >&2
        exit 1
    fi
done

echo "🦀 Updating Rust dependencies..."
cd "$PROJECT_DIR/frontend/src-tauri"
cargo update
TAURI_VERSION=$(awk '/^name = "tauri"$/ { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock)
if [ -z "$TAURI_VERSION" ]; then
    echo "❌ The tauri crate is not in frontend/src-tauri/Cargo.lock." >&2
    exit 1
fi
TAURI_MINOR="${TAURI_VERSION%.*}"
echo "   tauri crate: $TAURI_VERSION"

echo ""
echo "🔧 Updating Node.js dependencies..."
cd "$PROJECT_DIR"
npm update
cd "$PROJECT_DIR/frontend"
npm update
npm install --save "@tauri-apps/api@~${TAURI_MINOR}.0" "@tauri-apps/cli@~${TAURI_MINOR}.0"
echo "   @tauri-apps/api and @tauri-apps/cli on ${TAURI_MINOR}"

echo ""
echo "🔍 Checking for known vulnerabilities..."
status=0
cd "$PROJECT_DIR/frontend"
npm audit --audit-level=high || status=1
cd "$PROJECT_DIR/frontend/src-tauri"
cargo audit || status=1

echo ""
if [ "$status" -ne 0 ]; then
    echo "❌ Known vulnerabilities remain; see the reports above." >&2
    exit 1
fi
echo "✅ Dependencies updated with no known high or critical vulnerability."
echo "   Build and test, then commit package.json, frontend/package.json,"
echo "   package-lock.json, frontend/package-lock.json and frontend/src-tauri/Cargo.lock."
