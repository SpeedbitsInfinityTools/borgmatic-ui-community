/**
 * Redis Client Service
 * 
 * Provides a Redis client for caching archive listings (Borg 1.x depth simulation).
 * Gracefully handles connection failures - the application continues to work
 * without caching if Redis is unavailable.
 */

const Redis = require('ioredis');
const fs = require('fs');

// Configuration from environment
// In Docker/Compose, Redis is typically reachable via the service name `redis`.
// Fall back to `redis` when running in a container and REDIS_HOST isn't set.
const DEFAULT_REDIS_HOST = (() => {
  try {
    return fs.existsSync('/.dockerenv') ? 'redis' : 'localhost';
  } catch {
    return 'localhost';
  }
})();

const REDIS_HOST = process.env.REDIS_HOST || DEFAULT_REDIS_HOST;
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Connection state
let redis = null;
let isConnected = false;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Initialize Redis connection
 */
function initRedis() {
  if (redis) {
    return redis;
  }

  redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      connectionAttempts = times;
      if (times > MAX_RECONNECT_ATTEMPTS) {
        console.log(`⚠️ Redis: Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Caching disabled.`);
        return null; // Stop retrying
      }
      const delay = Math.min(times * 500, 3000);
      console.log(`🔄 Redis: Reconnecting in ${delay}ms (attempt ${times}/${MAX_RECONNECT_ATTEMPTS})...`);
      return delay;
    },
    lazyConnect: true, // Don't connect immediately
  });

  redis.on('connect', () => {
    isConnected = true;
    connectionAttempts = 0;
    console.log(`✅ Redis connected: ${REDIS_HOST}:${REDIS_PORT}`);
  });

  redis.on('ready', () => {
    isConnected = true;
    console.log('✅ Redis ready for commands');
  });

  redis.on('error', (err) => {
    // Only log if we were previously connected or this is first attempt
    if (isConnected || connectionAttempts <= 1) {
      console.error(`❌ Redis error: ${err.message}`);
    }
    isConnected = false;
  });

  redis.on('close', () => {
    isConnected = false;
  });

  redis.on('end', () => {
    isConnected = false;
    console.log('📴 Redis connection closed');
  });

  // Attempt to connect
  redis.connect().catch((err) => {
    console.log(`⚠️ Redis not available: ${err.message}. Archive caching disabled.`);
  });

  return redis;
}

/**
 * Get Redis client instance
 * @returns {Redis|null} Redis client or null if not available
 */
function getRedis() {
  if (!redis) {
    initRedis();
  }
  return isConnected ? redis : null;
}

/**
 * Check if Redis is connected and available
 * @returns {boolean}
 */
function isRedisAvailable() {
  return isConnected && redis !== null;
}

/**
 * Gracefully close Redis connection
 */
async function closeRedis() {
  if (redis) {
    try {
      await redis.quit();
      console.log('✅ Redis connection closed gracefully');
    } catch (err) {
      console.error(`Error closing Redis: ${err.message}`);
    }
    redis = null;
    isConnected = false;
  }
}

/**
 * Get Redis connection info for status display
 * @returns {Object}
 */
async function getRedisInfo() {
  const client = getRedis();
  if (!client) {
    return {
      connected: false,
      host: REDIS_HOST,
      port: REDIS_PORT,
      memory_used: null,
      memory_max: null,
      keys_count: null,
    };
  }

  try {
    const info = await client.info('memory');
    const keyCount = await client.dbsize();
    
    // Parse memory info
    const usedMatch = info.match(/used_memory_human:(\S+)/);
    const maxMatch = info.match(/maxmemory_human:(\S+)/);
    
    return {
      connected: true,
      host: REDIS_HOST,
      port: REDIS_PORT,
      memory_used: usedMatch ? usedMatch[1] : 'unknown',
      memory_max: maxMatch ? maxMatch[1] : '100mb',
      keys_count: keyCount,
    };
  } catch (err) {
    return {
      connected: false,
      host: REDIS_HOST,
      port: REDIS_PORT,
      error: err.message,
    };
  }
}

/**
 * Flush all cached archive data
 * @returns {Promise<boolean>}
 */
async function flushArchiveCache() {
  const client = getRedis();
  if (!client) {
    return false;
  }

  try {
    // Only delete keys with our archive cache prefix
    const keys = await client.keys('archive:*');
    if (keys.length > 0) {
      await client.del(...keys);
      console.log(`🗑️ Flushed ${keys.length} archive cache entries`);
    }
    return true;
  } catch (err) {
    console.error(`Error flushing archive cache: ${err.message}`);
    return false;
  }
}

module.exports = {
  initRedis,
  getRedis,
  isRedisAvailable,
  closeRedis,
  getRedisInfo,
  flushArchiveCache,
};

