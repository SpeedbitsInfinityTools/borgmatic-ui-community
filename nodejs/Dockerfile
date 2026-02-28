FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    borgmatic \
    borgbackup \
    openssh-client \
    curl \
    bash

# Create app user
RUN addgroup -g 1001 -S app && \
    adduser -S app -u 1001 -G app

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Create necessary directories
RUN mkdir -p /app/config /app/data /app/logs /app/backups && \
    chown -R app:app /app

# Switch to app user
USER app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start the application
CMD ["node", "src/server.js"]
