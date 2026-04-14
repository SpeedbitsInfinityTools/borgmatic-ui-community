#!/bin/bash
# Borgmatic UI - Container Startup Script
# 
# This script handles runtime edition detection:
# - If /app/commercial/director-server.js exists: Commercial edition (license anchor)
# - Otherwise: Community edition (built-in stubs)
#
# Commercial files:
#   director-server.js  -> /app/src/services/  (enables Director mode)
#   git-repos.js        -> /app/src/routes/    (enables Git repo backup)
#   MSSQL & AWS IAM are unlocked by the .edition features array (no separate files needed)
#
# The single Docker image defaults to Community. Infinity Tools mounts the real
# files to enable Commercial features at runtime.

set -e

# =============================================================================
# Set container-internal paths (critical for Docker deployments)
# =============================================================================
# These paths are where volumes are mounted INSIDE the container.
# Without these, the app would try to use hardcoded /opt/speedbits/... paths
# which don't exist in the container.
export CONFIG_DIR="${CONFIG_DIR:-/app/config}"
export DATA_DIR="${DATA_DIR:-/app/data}"
export LOGS_DIR="${LOGS_DIR:-/app/logs}"

# Ensure directories exist and are writable
mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" 2>/dev/null || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Borgmatic UI - Starting Container"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 Paths:"
echo "   Config: $CONFIG_DIR"
echo "   Data:   $DATA_DIR"
echo "   Logs:   $LOGS_DIR"

# Check for injected Commercial edition files
COMMERCIAL_DIRECTOR="/app/commercial/director-server.js"
COMMERCIAL_GIT_REPOS="/app/commercial/git-repos.js"
TARGET_DIRECTOR="/app/src/services/director-server.js"
TARGET_GIT_REPOS="/app/src/routes/git-repos.js"

if [ -f "$COMMERCIAL_DIRECTOR" ]; then
    echo ""
    echo "🔓 Commercial edition files detected!"

    if [ -f "$COMMERCIAL_DIRECTOR" ]; then
        cp "$COMMERCIAL_DIRECTOR" "$TARGET_DIRECTOR"
        echo "   Injected: director-server.js"
    fi
    if [ -f "$COMMERCIAL_GIT_REPOS" ]; then
        cp "$COMMERCIAL_GIT_REPOS" "$TARGET_GIT_REPOS"
        echo "   Injected: git-repos.js"
    fi

    # Set edition environment variable
    export EDITION="commercial"
    
    # Update the .edition marker file
    cat > /app/src/.edition << 'EOF'
{
  "edition": "commercial",
  "features": ["director", "standalone", "client", "git_repos", "mssql", "aws_iam"],
  "requires_injection": false,
  "activated_at": "TIMESTAMP"
}
EOF
    # Replace TIMESTAMP with actual time
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
    if [ -f "$COMMERCIAL_GIT_REPOS" ]; then
        echo ""
        echo "   ⚠️  git-repos.js was mounted, but Director anchor file is missing:"
        echo "      /app/commercial/director-server.js"
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
