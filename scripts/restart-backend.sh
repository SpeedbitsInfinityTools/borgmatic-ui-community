#!/bin/bash

echo "🛑 Stopping existing Node.js processes..."
pkill -9 -f "npm run dev" 2>/dev/null
pkill -9 -f "node.*server" 2>/dev/null
pkill -9 -f "nodemon" 2>/dev/null
sleep 2

echo "🚀 Starting backend server..."
cd /home/martin/projects/borgmatic-ui/nodejs
npm run dev > /tmp/borgmatic-backend.log 2>&1 &

echo "⏳ Waiting for server to start..."
sleep 3

if pgrep -f "npm run dev" > /dev/null; then
    echo "✅ Backend server started successfully!"
    echo "📋 View logs: tail -f /tmp/borgmatic-backend.log"
else
    echo "❌ Failed to start backend server"
    echo "Check the log file for errors:"
    cat /tmp/borgmatic-backend.log
fi

