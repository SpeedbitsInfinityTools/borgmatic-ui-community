#!/bin/bash
# Borgmatic UI - Container Startup Script
# 
# This script handles runtime edition detection by looking for commercial
# files mounted at /app/commercial/. Two mount layouts are supported:
#
#   Structured (Infinity Tools default):
#     /app/commercial/nodejs/src/services/director-server.js
#     /app/commercial/nodejs/src/routes/director.js
#     /app/commercial/nodejs/src/routes/git-repos.js
#
#   Flat (simple manual mount):
#     /app/commercial/director-server.js
#     /app/commercial/director.js
#     /app/commercial/git-repos.js
#
# Commercial activation requires director-server.js AND director.js together
# (the Socket.IO server and the HTTP /api/director/* routes are two halves of
# the same feature — injecting only one results in a half-activated install
# where clients connect to Socket.IO but the dashboard still hits a 402 stub
# on /api/director/clients and shows "0 connected" forever).
#
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
TARGET_DIRECTOR_SERVER="/app/src/services/director-server.js"
TARGET_DIRECTOR_ROUTES="/app/src/routes/director.js"
TARGET_GIT_REPOS="/app/src/routes/git-repos.js"

# Resolve source paths: prefer structured (Infinity Tools), fall back to flat
COMMERCIAL_DIRECTOR_SERVER=""
COMMERCIAL_DIRECTOR_ROUTES=""
COMMERCIAL_GIT_REPOS=""

if [ -f "/app/commercial/nodejs/src/services/director-server.js" ]; then
    COMMERCIAL_DIRECTOR_SERVER="/app/commercial/nodejs/src/services/director-server.js"
elif [ -f "/app/commercial/director-server.js" ]; then
    COMMERCIAL_DIRECTOR_SERVER="/app/commercial/director-server.js"
fi

if [ -f "/app/commercial/nodejs/src/routes/director.js" ]; then
    COMMERCIAL_DIRECTOR_ROUTES="/app/commercial/nodejs/src/routes/director.js"
elif [ -f "/app/commercial/director.js" ]; then
    COMMERCIAL_DIRECTOR_ROUTES="/app/commercial/director.js"
fi

if [ -f "/app/commercial/nodejs/src/routes/git-repos.js" ]; then
    COMMERCIAL_GIT_REPOS="/app/commercial/nodejs/src/routes/git-repos.js"
elif [ -f "/app/commercial/git-repos.js" ]; then
    COMMERCIAL_GIT_REPOS="/app/commercial/git-repos.js"
fi

# =============================================================================
# Activate edition
# =============================================================================
# Both the Socket.IO server (director-server.js) AND the HTTP API routes
# (director.js) are required for a usable Commercial install. Activating with
# only one results in the "client connected, dashboard shows 0" half-broken
# state, so we fail loudly instead of silently entering it.
if [ -n "$COMMERCIAL_DIRECTOR_SERVER" ] && [ -z "$COMMERCIAL_DIRECTOR_ROUTES" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ Partial Commercial install detected"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Found:   director-server.js  (Socket.IO server)"
    echo "Missing: director.js         (HTTP /api/director/* routes)"
    echo ""
    echo "Without director.js the Socket.IO server will accept clients but the"
    echo "Director dashboard's /api/director/clients call will hit the 402 stub"
    echo "and show 0 connected clients forever."
    echo ""
    echo "📝 Infinity Tools should mount BOTH files into /app/commercial/, e.g.:"
    echo "   /app/commercial/nodejs/src/services/director-server.js"
    echo "   /app/commercial/nodejs/src/routes/director.js"
    echo ""
    echo "Refusing to activate Commercial edition. Keeping Community stubs."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    COMMERCIAL_DIRECTOR_SERVER=""  # Suppress activation
fi

if [ -z "$COMMERCIAL_DIRECTOR_SERVER" ] && [ -n "$COMMERCIAL_DIRECTOR_ROUTES" ]; then
    echo ""
    echo "⚠️  Found director.js without director-server.js — ignoring."
    echo "    Commercial activation requires both files."
    COMMERCIAL_DIRECTOR_ROUTES=""  # Suppress unpaired injection
fi

if [ -n "$COMMERCIAL_DIRECTOR_SERVER" ] && [ -n "$COMMERCIAL_DIRECTOR_ROUTES" ]; then
    echo ""
    echo "🔓 Commercial edition files detected!"

    cp "$COMMERCIAL_DIRECTOR_SERVER" "$TARGET_DIRECTOR_SERVER"
    echo "   Injected: director-server.js"

    cp "$COMMERCIAL_DIRECTOR_ROUTES" "$TARGET_DIRECTOR_ROUTES"
    echo "   Injected: director.js"

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
        echo "   ⚠️  git-repos.js was found, but Director anchor files are missing."
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
