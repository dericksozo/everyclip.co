#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Everyclip (v18 or newer)." >&2
  echo "Install it from https://nodejs.org and try again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (this only happens once)…"
  npm install
fi

exec npm start
