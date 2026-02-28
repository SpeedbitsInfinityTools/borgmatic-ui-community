#!/bin/bash

# Start Backend Only
# Useful when you only want to work on backend

set -e

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "🚀 Starting Backend (Node.js/Express)..."
echo "📍 Directory: $(pwd)/nodejs"
echo ""

cd nodejs
npm run dev

