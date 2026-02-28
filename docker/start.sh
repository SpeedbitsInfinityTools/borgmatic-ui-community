#!/bin/bash
# Borgmatic UI - Container Startup Script
# 
# This script handles runtime edition detection:
# - If /app/commercial/director-server.js exists: Commercial edition (injected by Infinity Tools)
# - Otherwise: Community edition (built-in stub)
#
# The single Docker image defaults to Community. Infinity Tools mounts the real
# director-server.js file to enable Commercial/Director mode at runtime.

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

# Check for injected Commercial edition file
COMMERCIAL_FILE="/app/commercial/director-server.js"
TARGET_FILE="/app/src/services/director-server.js"

if [ -f "$COMMERCIAL_FILE" ]; then
    echo ""
    echo "🔓 Commercial edition file detected!"
    echo "   Injecting: $COMMERCIAL_FILE"
    
    # Copy the injected file to the services directory
    cp "$COMMERCIAL_FILE" "$TARGET_FILE"
    
    # Set edition environment variable
    export EDITION="commercial"
    
    # Update the .edition marker file
    cat > /app/src/.edition << 'EOF'
{
  "edition": "commercial",
  "features": ["director", "standalone", "client"],
  "requires_injection": false,
  "activated_at": "TIMESTAMP"
}
EOF
    # Replace TIMESTAMP with actual time
    sed -i "s/TIMESTAMP/$(date -Iseconds)/" /app/src/.edition
    
    echo "   ✅ Commercial edition activated"
    echo "   📋 Features: Director, Standalone, Client modes"
else
    echo ""
    echo "📦 Running as Community edition (default)"
    export EDITION="community"
    echo "   📋 Features: Standalone, Client modes"
    echo ""
    echo "   ℹ️  To enable Director mode, deploy via Infinity Tools:"
    echo "      https://www.speedbits.io"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Edition: ${EDITION^^}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the Node.js application
exec node src/server.js
