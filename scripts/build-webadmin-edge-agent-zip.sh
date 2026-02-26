#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_SRC="$ROOT_DIR/apps/webadmin-edge-agent"
DIST_DIR="$PLUGIN_SRC/dist"
BUILD_DIR="$(mktemp -d)"
PACKAGE_DIR="$BUILD_DIR/webadmin-edge-agent"
ZIP_PATH="$DIST_DIR/webadmin-edge-agent.zip"

mkdir -p "$DIST_DIR"
mkdir -p "$PACKAGE_DIR"

rsync -a --delete \
  --exclude 'dist' \
  --exclude 'vendor' \
  --exclude 'node_modules' \
  --exclude 'tests' \
  --exclude '*.log' \
  "$PLUGIN_SRC/" "$PACKAGE_DIR/"

(
  cd "$BUILD_DIR"
  zip -qr "$ZIP_PATH" webadmin-edge-agent
)

echo "Created $ZIP_PATH"
