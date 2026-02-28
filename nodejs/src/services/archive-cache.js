/**
 * Archive Cache Service
 * 
 * Provides caching for Borg 1.x archive listings to simulate depth-limited browsing.
 * Borg 2.x has native --depth support, but Borg 1.x returns all files at once.
 * This cache stores the full listing and filters by depth on-demand.
 */

const { getRedis, isRedisAvailable } = require('./redis-client');

// Cache key prefix
const CACHE_PREFIX = 'archive:';

// Default TTL: 24 hours (in seconds)
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Generate cache key for an archive
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @returns {string}
 */
function getCacheKey(repoPath, archiveName) {
  // Normalize paths to prevent duplicate keys
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${CACHE_PREFIX}${normalizedRepo}:${archiveName}`;
}

/**
 * Store archive listing in cache
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @param {Array} entries - Array of file/directory entries from borg list
 * @param {number} ttlSeconds - Time to live in seconds (default 24h)
 * @returns {Promise<boolean>} - True if cached successfully
 */
async function cacheArchiveListing(repoPath, archiveName, entries, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }

  try {
    const key = getCacheKey(repoPath, archiveName);
    const data = JSON.stringify(entries);
    
    await redis.setex(key, ttlSeconds, data);
    console.log(`📦 Cached ${entries.length} entries for ${archiveName} (TTL: ${ttlSeconds}s)`);
    return true;
  } catch (err) {
    console.error(`Failed to cache archive listing: ${err.message}`);
    return false;
  }
}

/**
 * Get cached archive listing
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @returns {Promise<Array|null>} - Array of entries or null if not cached
 */
async function getCachedListing(repoPath, archiveName) {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  try {
    const key = getCacheKey(repoPath, archiveName);
    const data = await redis.get(key);
    
    if (!data) {
      return null;
    }
    
    return JSON.parse(data);
  } catch (err) {
    console.error(`Failed to get cached listing: ${err.message}`);
    return null;
  }
}

/**
 * Check if an archive listing is cached
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @returns {Promise<boolean>}
 */
async function isListingCached(repoPath, archiveName) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }

  try {
    const key = getCacheKey(repoPath, archiveName);
    return await redis.exists(key) === 1;
  } catch (err) {
    return false;
  }
}

/**
 * Filter cached entries by path and depth
 * Simulates Borg 2.x's --depth flag for Borg 1.x repos
 * 
 * @param {Array} entries - All cached entries
 * @param {string} basePath - Base path to filter from (e.g., '/home/user')
 * @param {number} depth - Maximum depth from basePath (1 = immediate children only)
 * @returns {Array} - Filtered entries
 */
function filterByDepth(entries, basePath = '/', depth = 1) {
  // Normalize base path
  let normalizedBase = basePath.replace(/\\/g, '/');
  if (!normalizedBase.startsWith('/')) {
    normalizedBase = '/' + normalizedBase;
  }
  if (!normalizedBase.endsWith('/') && normalizedBase !== '/') {
    normalizedBase += '/';
  }
  
  // Special case: root path
  if (normalizedBase === '/') {
    normalizedBase = '';
  }

  const baseDepth = normalizedBase === '' ? 0 : normalizedBase.split('/').filter(Boolean).length;
  const maxDepth = baseDepth + depth;

  return entries.filter(entry => {
    let entryPath = entry.path || entry.name || '';
    if (!entryPath.startsWith('/')) {
      entryPath = '/' + entryPath;
    }

    // Must be under base path
    if (normalizedBase && !entryPath.startsWith(normalizedBase === '' ? '/' : normalizedBase)) {
      return false;
    }

    // Check depth
    const entryDepth = entryPath.split('/').filter(Boolean).length;
    return entryDepth <= maxDepth && entryDepth > baseDepth;
  });
}

/**
 * Get archive listing at a specific path and depth
 * This is the main function for depth-limited browsing of Borg 1.x archives
 * 
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @param {string} path - Path within archive to browse
 * @param {number} depth - Depth limit (default 1)
 * @returns {Promise<{entries: Array, fromCache: boolean}|null>}
 */
async function getListingAtDepth(repoPath, archiveName, path = '/', depth = 1) {
  const cached = await getCachedListing(repoPath, archiveName);
  
  if (!cached) {
    return null;
  }

  const filtered = filterByDepth(cached, path, depth);
  return {
    entries: filtered,
    fromCache: true,
    totalCached: cached.length,
  };
}

/**
 * Invalidate (delete) cached listing for an archive
 * Call this when an archive is deleted or modified
 * 
 * @param {string} repoPath - Repository path
 * @param {string} archiveName - Archive name
 * @returns {Promise<boolean>}
 */
async function invalidateArchive(repoPath, archiveName) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }

  try {
    const key = getCacheKey(repoPath, archiveName);
    await redis.del(key);
    console.log(`🗑️ Invalidated cache for ${archiveName}`);
    return true;
  } catch (err) {
    console.error(`Failed to invalidate archive cache: ${err.message}`);
    return false;
  }
}

/**
 * Invalidate all cached listings for a repository
 * Call this when a repository is deleted
 * 
 * @param {string} repoPath - Repository path
 * @returns {Promise<number>} - Number of entries deleted
 */
async function invalidateRepository(repoPath) {
  const redis = getRedis();
  if (!redis) {
    return 0;
  }

  try {
    const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const pattern = `${CACHE_PREFIX}${normalizedRepo}:*`;
    const keys = await redis.keys(pattern);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ Invalidated ${keys.length} cache entries for repository`);
    }
    
    return keys.length;
  } catch (err) {
    console.error(`Failed to invalidate repository cache: ${err.message}`);
    return 0;
  }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>}
 */
async function getCacheStats() {
  const redis = getRedis();
  if (!redis) {
    return {
      available: false,
      entries: 0,
      memory: 'N/A',
    };
  }

  try {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    const info = await redis.info('memory');
    
    const usedMatch = info.match(/used_memory_human:(\S+)/);
    
    return {
      available: true,
      entries: keys.length,
      memory: usedMatch ? usedMatch[1] : 'unknown',
    };
  } catch (err) {
    return {
      available: false,
      error: err.message,
    };
  }
}

/**
 * Update cache TTL setting (applies to new entries)
 * This doesn't change existing entries, only new ones
 * 
 * @param {number} hours - New TTL in hours
 */
function setDefaultTTL(hours) {
  // This would need to be stored persistently if we want it to survive restarts
  // For now, this is just informational
  console.log(`Archive cache TTL set to ${hours} hours`);
}

module.exports = {
  cacheArchiveListing,
  getCachedListing,
  isListingCached,
  filterByDepth,
  getListingAtDepth,
  invalidateArchive,
  invalidateRepository,
  getCacheStats,
  setDefaultTTL,
  DEFAULT_TTL_SECONDS,
};

