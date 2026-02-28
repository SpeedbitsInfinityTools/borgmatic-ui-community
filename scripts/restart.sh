#!/bin/bash
pkill -9 -f "npm run dev"
pkill -9 -f "nodemon"
sleep 2
cd /home/martin/projects/borgmatic-ui/nodejs
npm run dev > /tmp/borgmatic-backend.log 2>&1 &
sleep 3
echo "Backend restarted. Refresh your browser!"

