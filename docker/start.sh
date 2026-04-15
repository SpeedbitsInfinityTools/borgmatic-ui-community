#!/bin/bash
# Borgmatic UI - Container Startup Script
# 
# This script handles runtime edition detection by looking for commercial
# files mounted at /app/commercial/. Two mount layouts are supported:
#
#   Structured (Infinity Tools default):
#     /app/commercial/nodejs/src/services/director-server.js
#     /app/commercial/nodejs/src/routes/git-repos.js
#
#   Flat (simple manual mount):
#     /app/commercial/director-server.js
#     /app/commercial/git-repos.js
#
# Commercial activation requires director-server.js as the anchor file.
# MSSQL & AWS IAM are unlocked by the .edition features array (no separate files).

set -e

# =============================================================================
# Set container-internal paths (critical for Docker deployments)
# =============================================================================
export CONFIG_DIR="${CONFIG_DIR:-/app/config}"
export DATA_DIR="${DATA_DIR:-/app/data}"
export LOGS_DIR="${LOGS_DIR:-/app/logs}"

mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" 2>/dev/null || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Borgmatic UI - Starting Container"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 Paths:"
echo "   Config: $CONFIG_DIR"
echo "   Data:   $DATA_DIR"
echo "   Logs:   $LOGS_DIR"

# =============================================================================
# Detect commercial files (supports structured and flat mount layouts)
# =============================================================================
TARGET_DIRECTOR="/app/src/services/director-server.js"
TARGET_GIT_REPOS="/app/src/routes/git-repos.js"

# Resolve source paths: prefer structured (Infinity Tools), fall back to flat
COMMERCIAL_DIRECTOR=""
COMMERCIAL_GIT_REPOS=""

if [ -f "/app/commercial/nodejs/src/services/director-server.js" ]; then
    COMMERCIAL_DIRECTOR="/app/commercial/nodejs/src/services/director-server.js"
elif [ -f "/app/commercial/director-server.js" ]; then
    COMMERCIAL_DIRECTOR="/app/commercial/director-server.js"
fi

if [ -f "/app/commercial/nodejs/src/routes/git-repos.js" ]; then
    COMMERCIAL_GIT_REPOS="/app/commercial/nodejs/src/routes/git-repos.js"
elif [ -f "/app/commercial/git-repos.js" ]; then
    COMMERCIAL_GIT_REPOS="/app/commercial/git-repos.js"
fi

# =============================================================================
# Activate edition
# =============================================================================
if [ -n "$COMMERCIAL_DIRECTOR" ]; then
    echo ""
    echo "🔓 Commercial edition files detected!"

    cp "$COMMERCIAL_DIRECTOR" "$TARGET_DIRECTOR"
    echo "   Injected: director-server.js"

    if [ -n "$COMMERCIAL_GIT_REPOS" ]; then
        cp "$COMMERCIAL_GIT_REPOS" "$TARGET_GIT_REPOS"
        echo "   Injected: git-repos.js"
    fi

    export EDITION="commercial"

    cat > /app/src/.edition << 'EOF'
{
  "edition": "commercial",
  "features": ["director", "standalone", "client", "git_repos", "mssql", "aws_iam"],
  "requires_injection": false,
  "activated_at": "TIMESTAMP"
}
EOF
    sed -i "s/TIMESTAMP/$(date -Iseconds)/" /app/src/.edition

    echo "   ✅ Commercial edition activated"
    echo "   📋 Features: Director, Standalone, Client, Git Repos, MSSQL, AWS IAM"
else
    echo ""
    echo "📦 Running as Community edition (default)"
    export EDITION="community"
    echo "   📋 Features: Standalone, Client modes"
    echo ""
    echo "   ℹ️  To enable all features, deploy via Infinity Tools:"
    echo "      https://www.speedbits.io"
    if [ -n "$COMMERCIAL_GIT_REPOS" ]; then
        echo ""
        echo "   ⚠️  git-repos.js was found, but Director anchor file is missing."
        echo "   Keeping Community edition to avoid partial/unsafe activation."
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Edition: ${EDITION^^}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the Node.js application
exec node src/server.js
