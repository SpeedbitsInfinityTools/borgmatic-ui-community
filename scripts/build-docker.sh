#!/bin/bash
set -e

# Build Docker Image Locally (Quick Build)
#
# For full release builds with verification and testing, use:
#   bash deploy/build-and-push-images.sh [TAG] [--push]
#
# Usage: ./scripts/build-docker.sh [VERSION] [--no-latest]
#   VERSION: Version tag (default: "latest" or auto-detect from git/Dockerfile)
#   --no-latest: Don't tag as 'latest'

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
VERSION=""
NO_LATEST=false
for arg in "$@"; do
    case $arg in
        --no-latest)
            NO_LATEST=true
            shift
            ;;
        *)
            if [ -z "$VERSION" ]; then
                VERSION="$arg"
            fi
            ;;
    esac
done

REGISTRY=${REGISTRY:-"ghcr.io"}
USERNAME=${USERNAME:-"SpeedbitsInfinityTools"}
IMAGE_NAME="borgmatic-ui"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         🐳 Building Borgmatic-UI Docker Image         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# Check if Dockerfile exists
if [ ! -f "docker/Dockerfile" ]; then
    echo -e "${RED}❌ Dockerfile not found at docker/Dockerfile${NC}"
    exit 1
fi

# Verify .dockerignore excludes commercial files
if ! grep -q "nodejs/src/services/director-server.js" .dockerignore 2>/dev/null; then
    echo -e "${RED}❌ CRITICAL: .dockerignore must exclude nodejs/src/services/director-server.js${NC}"
    echo -e "${YELLOW}   Add this line to .dockerignore to prevent commercial code in Community builds${NC}"
    exit 1
fi

# Auto-detect version if not provided
if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
    # Try to get version from git tag
    if git rev-parse --git-dir > /dev/null 2>&1; then
        GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo "")
        if [[ "$GIT_TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]; then
            VERSION="${GIT_TAG#v}"  # Remove 'v' prefix if present
            echo -e "${BLUE}📌 Detected version from git: ${VERSION}${NC}"
        fi
    fi
    
    # Fallback: try to extract from Dockerfile
    if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
        DOCKERFILE_VERSION=$(grep -oP 'io\.borgmatic\.ui\.version="\K[^"]+' docker/Dockerfile 2>/dev/null || echo "")
        if [ -n "$DOCKERFILE_VERSION" ]; then
            VERSION="$DOCKERFILE_VERSION"
            echo -e "${BLUE}📌 Detected version from Dockerfile: ${VERSION}${NC}"
        fi
    fi
    
    # Final fallback
    if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
        VERSION="latest"
        echo -e "${YELLOW}⚠️  Using 'latest' as version (specify version or create git tag)${NC}"
    fi
fi

# Determine if this is a release version (semantic versioning)
IS_RELEASE=false
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    IS_RELEASE=true
fi

# Build frontend first
echo -e "${BLUE}→ Building frontend production bundle...${NC}"
cd frontend
if [ -f "package.json" ]; then
    npm ci --production=false 2>/dev/null || npm install
    npm run build:prod 2>/dev/null || npm run build
else
    echo -e "${YELLOW}⚠️  No frontend package.json found, skipping frontend build${NC}"
fi
cd ..
echo -e "${GREEN}✓ Frontend built${NC}"
echo ""

# Build Docker image
echo -e "${BLUE}→ Building Docker image...${NC}"
echo "   Registry: ${REGISTRY}"
echo "   Image: ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"
if [ "$NO_LATEST" = false ] && [ "$IS_RELEASE" = true ]; then
    echo "   Also tagging as: latest"
fi
echo ""

# Build command
BUILD_CMD="docker build -f docker/Dockerfile"
BUILD_CMD="$BUILD_CMD --build-arg VERSION=${VERSION}"
BUILD_CMD="$BUILD_CMD -t ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"

# Add latest tag for release versions (unless --no-latest)
if [ "$NO_LATEST" = false ] && [ "$IS_RELEASE" = true ]; then
    BUILD_CMD="$BUILD_CMD -t ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:latest"
fi

BUILD_CMD="$BUILD_CMD ."

# Execute build
eval $BUILD_CMD

echo ""
echo -e "${GREEN}✓ Docker image built successfully!${NC}"
echo ""
echo -e "${GREEN}Images created:${NC}"
echo "  ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"
if [ "$NO_LATEST" = false ] && [ "$IS_RELEASE" = true ]; then
echo "  ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:latest"
fi
echo ""

# Show test command
echo -e "${BLUE}Test locally:${NC}"
echo "  docker run -d --name borgmatic-ui-test -p 8000:8000 ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"
echo "  # Access at http://localhost:8000"
echo ""

# Show push commands
if [ "$IS_RELEASE" = true ]; then
    echo -e "${BLUE}Push to registry:${NC}"
echo "  docker push ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"
    if [ "$NO_LATEST" = false ]; then
echo "  docker push ${REGISTRY}/${USERNAME}/${IMAGE_NAME}:latest"
    fi
    echo ""
    echo -e "${YELLOW}💡 Tip: Create a git tag before pushing:${NC}"
    echo "  git tag -a v${VERSION} -m \"Release version ${VERSION}\""
    echo "  git push origin v${VERSION}"
else
    echo -e "${YELLOW}💡 This is a development build. For releases, use semantic versioning (e.g., 1.2.3)${NC}"
fi
echo ""

