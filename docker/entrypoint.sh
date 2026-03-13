#!/bin/bash
# =============================================================================
# Borgmatic UI Docker Entrypoint
# =============================================================================
# This script runs as root on container start to:
# 1. Ensure config/data directories exist with correct permissions
# 2. Drop privileges to 'node' user for the actual application
# =============================================================================

set -e

# Directories that need to be writable by the node user
WRITABLE_DIRS=(
    "/app/config"
    "/app/data"
    "/app/logs"
)

# Ensure directories exist and have correct ownership
for dir in "${WRITABLE_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
    fi
    # Fix ownership (node user has uid 1000 in Alpine)
    chown -R node:node "$dir"
done

# Also ensure borgmatic.d subdirectory exists
mkdir -p /app/config/borgmatic.d
chown -R node:node /app/config/borgmatic.d

# If SSH directory is mounted, ensure correct permissions
if [ -d "/home/node/.ssh" ]; then
    chown -R node:node /home/node/.ssh
    chmod 700 /home/node/.ssh
    chmod 600 /home/node/.ssh/* 2>/dev/null || true
fi

# Drop privileges and execute the main command as 'node' user
# Using su-exec (Alpine's lightweight alternative to gosu)
exec su-exec node "$@"
