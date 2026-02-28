#!/bin/bash

# Start Frontend Only
# Useful when you only want to work on frontend

set -e

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "🚀 Starting Frontend (React/Vite)..."
echo "📍 Directory: $(pwd)/frontend"
echo ""

cd frontend
npm run dev

