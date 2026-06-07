const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { execa } = require('execa');
const { exec } = require('child_process');
const { promisify } = require('util');
const passwordManager = require('../services/password-manager');
const configParser = require('../services/config-parser');
const repositoryCredentials = require('../services/repository-credentials');
const { configureBorgSshEnv } = require('../services/borg-ssh-env');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const { writeSSHKeyToFilesystem } = require('./repositories/helpers');

// Borg version detection and Redis cache for Borg 1.x
const { detectRepoVersion, getBorgCommand, getBorgPath } = require('../services/borg-version-detector');
const {
    cacheArchiveListing,
    getCachedListing: getRedisCachedListing,
    getListingAtDepth,
    isListingCached,
    invalidateArchive
} = require('../services/archive-cache');
const { isRedisAvailable } = require('../services/redis-client');

const execAsync = promisify(exec);

// ============================================================================
// In-Memory Cache for Archive Listings (Borg 2.0 optimized)
// ============================================================================
const archiveCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ROOT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for root (expensive)
// Bump this when changing browse response shape or listing logic to avoid stale cache issues.
const BROWSE_CACHE_VERSION = 5; // Bumped: Removed --depth flag, fetch full listing for Borg 2.x

/**
 * Get cached archive listing or null if expired/missing
 */
function getCachedListing(cacheKey) {
    const cached = archiveCache.get(cacheKey);
    if (!cached) return null;

    // Invalidate entries from older logic to avoid serving stale/empty listings after code changes.
    if (cached.version !== BROWSE_CACHE_VERSION) {
        archiveCache.delete(cacheKey);
        return null;
    }

    if (Date.now() - cached.timestamp > cached.ttl) {
        archiveCache.delete(cacheKey);
        return null;
    }

    // Defensive: never serve an "empty items" cached listing; it can be caused by a transient
    // failure or older buggy logic and is confusing in the UI ("This folder is empty").
    if (cached.data && Array.isArray(cached.data.items) && cached.data.items.length === 0) {
        archiveCache.delete(cacheKey);
        return null;
    }

    return cached.data;
}

/**
 * Store archive listing in cache
 */
function setCachedListing(cacheKey, data, isRoot = false) {
    archiveCache.set(cacheKey, {
        version: BROWSE_CACHE_VERSION,
        data,
        timestamp: Date.now(),
        ttl: isRoot ? ROOT_CACHE_TTL_MS : CACHE_TTL_MS
    });

    // Limit cache size (LRU-style cleanup)
    if (archiveCache.size > 100) {
        const oldest = archiveCache.keys().next().value;
        archiveCache.delete(oldest);
    }
}

/**
 * Borg emits archive start/time strings in the *server's* local timezone
 * with no offset suffix (e.g. `2026-04-27T08:20:16.123456`). When the API
 * passes that raw string to the browser, the browser's `new Date(ts)`
 * interprets it as the *browser's* local timezone — which silently breaks
 * the display whenever the server runs in a different zone (the most
 * common case being a Docker container running TZ=UTC while the user's
 * browser is in CEST).
 *
 * We fix this here by anchoring the timestamp to the server's TZ, then
 * re-serialising as canonical ISO 8601 UTC with a `Z` suffix. Because
 * Node and the borg process share the same OS-level TZ, parsing the raw
 * string via `new Date()` on the server interprets it correctly, and
 * `toISOString()` emits an unambiguous wall clock that the browser can
 * convert to its own zone.
 *
 * Strings that already carry an explicit offset (`Z`, `+02:00`, etc.)
 * are passed through unchanged.
 */
function normalizeTimestamp(ts) {
    if (!ts || typeof ts !== 'string') return ts;
    // Already explicitly anchored — trust it.
    if (/Z$/.test(ts) || /[+-]\d{2}:?\d{2}$/.test(ts)) return ts;
    // Borg can emit 6-digit microseconds; some Date parsers are unhappy
    // with >3 sub-second digits, so clamp to milliseconds.
    const clamped = ts.replace(/\.(\d{3})\d+$/, '.$1');
    const d = new Date(clamped);
    if (isNaN(d.getTime())) return ts;
    return d.toISOString();
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================================
// Input validation helpers (avoid weird/control chars and traversal)
// ============================================================================
function hasControlChars(s) {
    return typeof s !== 'string' || s.includes('\0') || s.includes('\n') || s.includes('\r');
}

function validateArchiveName(archiveName) {
    if (!archiveName || typeof archiveName !== 'string') return false;
    if (hasControlChars(archiveName)) return false;
    // Archive name is a borg identifier; disallow repo separator just in case
    if (archiveName.includes('::')) return false;
    return true;
}

function validateBrowsePath(browsePath) {
    if (typeof browsePath !== 'string') return false;
    if (hasControlChars(browsePath)) return false;
    if (browsePath.includes('..')) return false;
    return true;
}

/**
 * Get backup job name mapping for a repository
 * Returns a map of archive name prefix -> backup job name
 */
async function getBackupJobMapping(repositoryPath) {
    try {
        const config = require('../config');
        const backupsDir = path.join(config.configDir, 'borgmatic.d');
        const metadataPath = path.join(config.configDir, 'backups-metadata.yaml');

        // Load backups-metadata.yaml so we can map YAML files back to their
        // user-facing display names (same names that /api/backups returns).
        // Without this, Git Restore / other UI features can't correlate an
        // archive's backup_job with a backup config.
        let filenameToDisplayName = {};
        try {
            if (await fs.pathExists(metadataPath)) {
                const metaContent = await fs.readFile(metadataPath, 'utf8');
                const metaParsed = yaml.load(metaContent) || {};
                for (const meta of metaParsed.backups || []) {
                    if (meta && meta.filename && meta.name) {
                        filenameToDisplayName[meta.filename] = meta.name;
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️  Failed to load backups-metadata.yaml for job mapping:', e.message);
        }

        const files = await fs.readdir(backupsDir);
        const yamlFiles = files.filter(f =>
            (f.endsWith('.yaml') || f.endsWith('.yml')) &&
            !f.startsWith('git-job-') &&
            !f.startsWith('git-keys-')
        );

        const mapping = {};

        for (const file of yamlFiles) {
            const filePath = path.join(backupsDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const parsed = yaml.load(content);

            // Check if this backup uses the repository
            const repositories = parsed?.location?.repositories || [];
            const usesRepo = repositories.some(r =>
                (typeof r === 'string' && r === repositoryPath) ||
                (typeof r === 'object' && r.path === repositoryPath)
            );

            if (usesRepo) {
                // Prefer the display name from backups-metadata.yaml so this
                // mapping aligns with the name exposed by /api/backups. Fall
                // back to the filename stem for discovered (non-UI) configs.
                const fileStem = path.basename(file, path.extname(file));
                const displayName = filenameToDisplayName[file] || fileStem;

                // Default format is {hostname}-{now}
                const archiveFormat = parsed?.archive_name_format || '{hostname}-{now}';

                mapping[displayName] = {
                    name: displayName,
                    filename: file,
                    format: archiveFormat
                };
            }
        }

        return mapping;
    } catch (error) {
        console.error('Error getting backup job mapping:', error.message);
        return {};
    }
}

// ============================================================================
// IMPORTANT: Specific routes MUST come BEFORE wildcard routes!
// ============================================================================

/**
 * Get detailed info for a specific archive (size, file count)
 * GET /api/archives/:repositoryPath/:archiveName/info
 */
router.get('/:repositoryPath/:archiveName/info', authenticateToken, async (req, res) => {
    try {
        // Decode URL parameters
        let repositoryPath = decodeURIComponent(req.params.repositoryPath || '');
        let archiveName = decodeURIComponent(req.params.archiveName || '');

        console.log(`ℹ️  [Archives] Getting info for: "${archiveName}" from repo: "${repositoryPath}"`);

        // Get passphrase
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos
        const borgPath = getBorgPath(borgVersion);

        await configureBorgSshEnv(env, repositoryPath, 'Info');

        // Use borg info --json to get archive details
        // Borg 1.x: borg info <repo>::<archive> --json
        // Borg 2.x: borg -r <repo> info <archive> --json
        const { execa } = require('execa');
        let args;
        if (borgVersion === '2.x') {
            args = ['-r', repositoryPath, 'info', archiveName, '--json'];
        } else {
            // Borg 1.x syntax
            args = ['info', `${repositoryPath}::${archiveName}`, '--json'];
        }

        console.log(`🔄 [Archives] Getting archive info using Borg ${borgVersion} (${borgPath})...`);

        const { stdout, stderr } = await execa(borgPath, args, {
            env,
            timeout: 30000
        });

        if (stderr && !stderr.includes('Warning')) {
            console.warn('Borg stderr:', stderr);
        }

        // Parse JSON output
        const info = JSON.parse(stdout);

        // Extract relevant stats from the correct location
        const archiveInfo = info.archives?.[0] || {};
        const stats = archiveInfo.stats || {};

        console.log(`✅ Archive info: ${stats.nfiles || 0} files, ${formatBytes(stats.original_size || 0)}`);

        res.json({
            success: true,
            data: {
                size: formatBytes(stats.original_size || 0),
                compressed_size: formatBytes(stats.compressed_size || 0),
                deduplicated_size: formatBytes(stats.deduplicated_size || 0),
                file_count: stats.nfiles || 0,
                archive: archiveName,
                repository: repositoryPath
            }
        });
    } catch (error) {
        console.error('❌ Failed to get archive info:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get archive info'
        });
    }
});

/**
 * Get files in an archive
 * GET /api/archives/:repositoryPath/:archiveName/files
 * Note: Both params are URL-encoded
 */
router.get('/:repositoryPath/:archiveName/files', authenticateToken, async (req, res) => {
    try {
        // Decode URL parameters
        let repositoryPath = decodeURIComponent(req.params.repositoryPath || '');
        let archiveName = decodeURIComponent(req.params.archiveName || '');

        console.log(`📂 [Archives] Raw params: repo="${req.params.repositoryPath}", archive="${req.params.archiveName}"`);
        console.log(`📂 [Archives] Decoded: repo="${repositoryPath}", archive="${archiveName}"`);

        // Security: Validate repositoryPath and archiveName
        if (!repositoryPath || !archiveName) {
            return res.status(400).json({
                success: false,
                error: 'Repository path and archive name are required'
            });
        }

        // Prevent command injection via archive name (no semicolons, backticks, pipes, etc.)
        const dangerousChars = /[;&|`$()<>]/;
        if (dangerousChars.test(archiveName)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid characters in archive name'
            });
        }

        // Get passphrase for this repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        // Use borg list with --json-lines for archive contents
        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos
        const borgPath = getBorgPath(borgVersion);

        await configureBorgSshEnv(env, repositoryPath, 'Files');

        // Borg 1.x: borg list <repo>::<archive> --json-lines
        // Borg 2.x: borg -r <repo> list <archive> --json-lines
        let args;
        if (borgVersion === '2.x') {
            args = ['-r', repositoryPath, 'list', archiveName, '--json-lines'];
        } else {
            args = ['list', `${repositoryPath}::${archiveName}`, '--json-lines'];
        }

        console.log(`📂 [Archives] Listing files using Borg ${borgVersion}: ${borgPath} ${args.join(' ')}`);

        const { execa } = require('execa');
        const { stdout, stderr } = await execa(borgPath, args, {
            env,
            timeout: 300000,
            maxBuffer: 100 * 1024 * 1024
        });

        if (stderr && !stderr.includes('Warning')) {
            console.warn('Borg stderr:', stderr);
        }

        // Parse JSON Lines output (one JSON object per line)
        const files = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                files.push({
                    path: item.path,
                    type: item.type === 'd' ? 'directory' : 'file',
                    size: item.size ? formatBytes(item.size) : null,
                    modified: item.mtime || null
                });
            } catch (parseError) {
                console.warn('Could not parse file line:', line.substring(0, 100));
            }
        }

        console.log(`✅ Found ${files.length} files in archive`);

        res.json({
            success: true,
            data: {
                files,
                archive: archiveName,
                repository: repositoryPath
            }
        });
    } catch (error) {
        console.error('Failed to get archive files:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get archive files'
        });
    }
});

/**
 * Browse archive contents at a specific path
 * GET /api/archives/browse
 * Query params: repository, archive, path (default: /), search
 * 
 * Supports both Borg 1.x and Borg 2.x:
 * - Borg 2.x: Uses native --depth flag for efficient directory listing
 * - Borg 1.x: Uses Redis cache to store full listing, then filters by depth
 */
router.get('/browse', authenticateToken, async (req, res) => {
    try {
        let repositoryPath = req.query.repository || '';
        let archiveName = req.query.archive || '';
        const browsePath = req.query.path || '/';
        const searchQuery = req.query.search || '';

        console.log(`🔍 [Archives] Browsing "${archiveName}" at path: "${browsePath}"`);

        if (!repositoryPath || !archiveName) {
            return res.status(400).json({
                success: false,
                error: 'Repository path and archive name are required'
            });
        }
        if (hasControlChars(repositoryPath) || !validateArchiveName(archiveName) || !validateBrowsePath(browsePath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid repository/archive/path parameters'
            });
        }

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos without version stored
        const borgPath = getBorgPath(borgVersion);

        console.log(`📦 Repository Borg version: ${borgVersion} (${borgPath})`);

        // Check in-memory cache first (except for search)
        const cacheKey = `${repositoryPath}::${archiveName}::${browsePath}`;
        if (!searchQuery) {
            const cached = getCachedListing(cacheKey);
            if (cached) {
                console.log(`📦 [Cache HIT] Returning cached listing for: ${browsePath}`);
                return res.json({ success: true, data: cached });
            }
        }

        // Get passphrase
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        await configureBorgSshEnv(env, repositoryPath, 'Browse');

        // Normalize browse path (remove leading/trailing slashes for borg)
        const normalizedPath = browsePath === '/' ? '' : browsePath.replace(/^\/+|\/+$/g, '');
        const isRoot = !normalizedPath;
        if (normalizedPath.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid browse path' });
        }

        let allItems = [];

        // =========================================================================
        // Borg 1.x: Use Redis cache for depth simulation
        // =========================================================================
        if (borgVersion === '1.x') {
            console.log(`📦 [Borg 1.x] Using Redis cache for depth-limited browsing`);

            // Check if Redis has this archive cached
            if (isRedisAvailable() && !searchQuery) {
                const cachedResult = await getListingAtDepth(repositoryPath, archiveName, browsePath, 1);

                if (cachedResult) {
                    console.log(`📦 [Redis HIT] Depth-filter returned ${cachedResult.entries.length} entries (total cached: ${cachedResult.totalCached})`);

                    // IMPORTANT:
                    // Borg 1.x JSON listing often does NOT include implicit parent directories (e.g. it may have
                    // "app/config/foo" but not an explicit "app" directory entry). A depth=1 filter at "/" would
                    // then return 0 entries, causing the UI to show "This folder is empty".
                    //
                    // So when Redis is available, use the FULL cached listing and synthesize the immediate children
                    // ("virtual directories") for the requested browse path.
                    const cachedAll = await getRedisCachedListing(repositoryPath, archiveName);
                    const fullListing = Array.isArray(cachedAll) ? cachedAll : [];

                    const normalizedBrowsePath = browsePath === '/' ? '' : String(browsePath).replace(/^\/+|\/+$/g, '');
                    const isRootPath = !normalizedBrowsePath;
                    const directChildren = new Map();

                    for (const entry of fullListing) {
                        const rawPath = entry?.path || '';
                        if (!rawPath) continue;

                        const entryPathWithSlash = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
                        const entryPathNorm = entryPathWithSlash.startsWith('/') ? entryPathWithSlash.slice(1) : entryPathWithSlash;

                        // Split into components
                        const parts = entryPathNorm.split('/').filter(Boolean);
                        if (parts.length === 0) continue;

                        if (isRootPath) {
                            const first = parts[0];
                            const virtualPath = '/' + first;
                            if (!directChildren.has(virtualPath)) {
                                const isDir = (entry.type === 'directory') || parts.length > 1;
                                directChildren.set(virtualPath, {
                                    path: virtualPath,
                                    name: first,
                                    type: isDir ? 'directory' : 'file',
                                    size: isDir ? 0 : (entry.size || 0),
                                    sizeFormatted: isDir ? null : (entry.size ? formatBytes(entry.size) : null),
                                    modified: entry.mtime || entry.modified || null,
                                });
                            }
                        } else {
                            const prefix = normalizedBrowsePath + '/';
                            if (!entryPathNorm.startsWith(prefix)) continue;

                            const relative = entryPathNorm.slice(prefix.length);
                            const relParts = relative.split('/').filter(Boolean);
                            if (relParts.length === 0) continue;

                            const child = relParts[0];
                            const childPath = '/' + normalizedBrowsePath + '/' + child;
                            if (!directChildren.has(childPath)) {
                                const isDir = (entry.type === 'directory') || relParts.length > 1;
                                directChildren.set(childPath, {
                                    path: childPath,
                                    name: child,
                                    type: isDir ? 'directory' : 'file',
                                    size: isDir ? 0 : (entry.size || 0),
                                    sizeFormatted: isDir ? null : (entry.size ? formatBytes(entry.size) : null),
                                    modified: entry.mtime || entry.modified || null,
                                });
                            }
                        }
                    }

                    const items = Array.from(directChildren.values()).sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });

                    const parentPath = isRoot ? null : (
                        normalizedPath.includes('/')
                            ? '/' + normalizedPath.split('/').slice(0, -1).join('/')
                            : '/'
                    );

                    const breadcrumbs = [{ name: 'Root', path: '/' }];
                    if (!isRoot) {
                        let accPath = '';
                        for (const part of normalizedPath.split('/')) {
                            accPath += '/' + part;
                            breadcrumbs.push({ name: part, path: accPath });
                        }
                    }

                    return res.json({
                        success: true,
                        data: {
                            current_path: browsePath,
                            parent_path: parentPath,
                            breadcrumbs,
                            items,
                            total_items: items.length,
                            is_search: false,
                            borg_version: '1.x',
                            from_cache: true,
                        }
                    });
                }
            }

            // Redis miss or not available - fetch full listing from Borg 1.x
            console.log(`📦 [Borg 1.x] Fetching full archive listing (Redis miss or unavailable)`);

            // Borg 1.x syntax: borg list REPO::ARCHIVE --json-lines
            const { command, args } = getBorgCommand('1.x', 'archive-list', {
                repoPath: repositoryPath,
                archiveName: archiveName,
                extraArgs: ['--json-lines'],
                remotePath: repo?.hetzner_borg_version, // For Hetzner Storage Boxes
            });

            const { stdout, stderr } = await execa(command, args, {
                env,
                timeout: 300000, // 5 minutes for large archives
                maxBuffer: 100 * 1024 * 1024, // 100MB
            });

            // Parse full listing
            const lines = stdout.trim().split('\n').filter(line => line.trim());
            const fullListing = [];

            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    fullListing.push({
                        path: item.path,
                        type: item.type === 'd' ? 'directory' : 'file',
                        size: item.size || 0,
                        mtime: item.mtime || null,
                    });
                } catch (e) { }
            }

            // Cache in Redis for future requests
            if (isRedisAvailable() && fullListing.length > 0) {
                await cacheArchiveListing(repositoryPath, archiveName, fullListing);
                console.log(`📦 [Redis] Cached ${fullListing.length} entries for future requests`);
            }

            // Filter for current path
            allItems = fullListing.map(item => ({
                path: item.path.startsWith('/') ? item.path : '/' + item.path,
                name: path.basename(item.path) || item.path,
                type: item.type,
                size: item.size,
                sizeFormatted: item.size ? formatBytes(item.size) : null,
                modified: item.mtime,
            }));
        }
        // =========================================================================
        // Borg 2.x: Fetch all items and filter programmatically
        // =========================================================================
        // NOTE: We cannot use --depth flag reliably because Borg 2.x doesn't synthesize
        // parent directories. If an archive only has "a/b/c.txt", --depth 1 won't show "a".
        // Instead, we fetch all items and build the directory tree ourselves.
        else {
            console.log(`📦 [Borg 2.x] Fetching full archive listing (--depth not reliable for dir synthesis)`);

            // For non-root, we can still use a path filter to reduce data transfer
            const listArgs = ['-r', repositoryPath, 'list', archiveName, '--json-lines'];
            if (!isRoot) {
                // Add path filter to only get items under this directory
                listArgs.push(normalizedPath);
                console.log(`📦 [Borg 2.x] Filtering to path: "${normalizedPath}"`);
            }

            console.log(`📤 [Borg 2.x] Command: ${borgPath} ${listArgs.join(' ')}`);
            
            const { stdout, stderr } = await execa(borgPath, listArgs, {
                env,
                timeout: 180000  // Increase timeout for full listings
            });

            if (stderr) {
                console.log(`⚠️ [Borg 2.x] stderr: ${stderr}`);
            }

            // Parse JSON Lines output
            const lines = stdout.trim().split('\n').filter(line => line.trim());
            console.log(`📥 [Borg 2.x] Raw output lines: ${lines.length}`);
            
            // Debug: Show first few lines
            if (lines.length <= 5) {
                console.log(`📥 [Borg 2.x] Raw lines:`, lines);
            } else {
                console.log(`📥 [Borg 2.x] First 5 paths:`, lines.slice(0, 5).map(l => {
                    try { return JSON.parse(l).path; } catch { return l.substring(0, 50); }
                }));
            }

            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    const itemPath = item.path.startsWith('/') ? item.path : '/' + item.path;

                    allItems.push({
                        path: itemPath,
                        name: path.basename(itemPath) || itemPath,
                        type: item.type === 'd' ? 'directory' : 'file',
                        size: item.size || 0,
                        sizeFormatted: item.size ? formatBytes(item.size) : null,
                        modified: item.mtime || null,
                        mode: item.mode || null,
                        user: item.user || null,
                        group: item.group || null,
                    });
                } catch (parseError) {
                    console.log(`⚠️ [Borg 2.x] Parse error for line: ${line.substring(0, 100)}`);
                }
            }
            
            console.log(`📦 [Borg 2.x] Parsed ${allItems.length} items from Borg output`);
        }

        // Handle search (requires full listing - expensive)
        if (searchQuery) {
            console.log(`🔎 [Search] Searching for: "${searchQuery}" - requires full listing`);

            // For search, we need full listing
            let searchItems = [];
            const searchLower = searchQuery.toLowerCase();

            if (borgVersion === '1.x') {
                // For Borg 1.x, use cached data if available
                const cachedResult = await getListingAtDepth(repositoryPath, archiveName, '/', 999);
                if (cachedResult) {
                    searchItems = cachedResult.entries
                        .filter(item => item.path.toLowerCase().includes(searchLower))
                        .slice(0, 200)
                        .map(item => ({
                            path: item.path.startsWith('/') ? item.path : '/' + item.path,
                            name: path.basename(item.path) || item.path,
                            type: item.type === 'd' || item.type === 'directory' ? 'directory' : 'file',
                            size: item.size || 0,
                            sizeFormatted: item.size ? formatBytes(item.size) : null,
                            modified: item.mtime || null,
                        }));
                }
            } else {
                // Borg 2.x full listing for search
                const searchResult = await execa(borgPath, ['-r', repositoryPath, 'list', archiveName, '--json-lines'], {
                    env,
                    timeout: 300000
                });

                const searchLines = searchResult.stdout.trim().split('\n').filter(l => l.trim());

                for (const line of searchLines) {
                    try {
                        const item = JSON.parse(line);
                        const itemPath = item.path.startsWith('/') ? item.path : '/' + item.path;

                        if (itemPath.toLowerCase().includes(searchLower)) {
                            searchItems.push({
                                path: itemPath,
                                name: path.basename(itemPath) || itemPath,
                                type: item.type === 'd' ? 'directory' : 'file',
                                size: item.size || 0,
                                sizeFormatted: item.size ? formatBytes(item.size) : null,
                                modified: item.mtime || null,
                            });
                        }

                        if (searchItems.length >= 200) break;
                    } catch (e) { }
                }
            }

            return res.json({
                success: true,
                data: {
                    current_path: browsePath,
                    parent_path: null,
                    items: searchItems,
                    total_items: searchItems.length,
                    is_search: true,
                    search_query: searchQuery,
                    borg_version: borgVersion,
                }
            });
        }

        // Filter to only immediate children of the browse path
        // browsePathNorm is the current path with leading / but no trailing /
        const browsePathNorm = isRoot ? '' : normalizedPath;
        const directChildren = new Map();

        for (const item of allItems) {
            // Remove leading slash for consistent comparison
            const itemPathNorm = item.path.startsWith('/') ? item.path.slice(1) : item.path;

            // Skip empty paths
            if (!itemPathNorm) continue;

            // Skip the directory itself
            if (itemPathNorm === browsePathNorm) continue;

            // Split into path components
            const itemParts = itemPathNorm.split('/').filter(p => p);
            const browseParts = browsePathNorm ? browsePathNorm.split('/').filter(p => p) : [];

            // For root browsing (browseParts.length === 0), we want items at depth 1
            // For /foo browsing (browseParts.length === 1), we want items at depth 2 that start with foo/
            const targetDepth = browseParts.length + 1;

            // Check if this item is at the right depth OR is a deeper item we need to represent as a directory
            if (isRoot) {
                // At root, get first component of each path
                const firstComponent = itemParts[0];
                if (firstComponent) {
                    const virtualPath = '/' + firstComponent;
                    if (!directChildren.has(virtualPath)) {
                        // Check if this is a directory (either explicitly or implicitly via child items)
                        const isDir = item.type === 'directory' || itemParts.length > 1;
                        directChildren.set(virtualPath, {
                            path: virtualPath,
                            name: firstComponent,
                            type: isDir ? 'directory' : 'file',
                            size: isDir ? 0 : item.size,
                            sizeFormatted: isDir ? null : item.sizeFormatted,
                            modified: item.modified,
                        });
                    }
                }
            } else {
                // Not at root - check if item is under the current browse path
                const browsePrefix = browsePathNorm + '/';
                if (itemPathNorm.startsWith(browsePrefix) || itemPathNorm === browsePathNorm) {
                    // Get the relative path from current browse path
                    const relativePath = itemPathNorm.slice(browsePrefix.length);
                    const relativeParts = relativePath.split('/').filter(p => p);

                    if (relativeParts.length >= 1) {
                        const childName = relativeParts[0];
                        const childPath = '/' + browsePathNorm + '/' + childName;

                        if (!directChildren.has(childPath)) {
                            const isDir = item.type === 'directory' || relativeParts.length > 1;
                            directChildren.set(childPath, {
                                path: childPath,
                                name: childName,
                                type: isDir ? 'directory' : 'file',
                                size: isDir ? 0 : item.size,
                                sizeFormatted: isDir ? null : item.sizeFormatted,
                                modified: item.modified,
                            });
                        }
                    }
                }
            }
        }

        // Convert to array and sort (directories first, then by name)
        const items = Array.from(directChildren.values()).sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        // Calculate parent path
        const parentPath = isRoot ? null : (
            normalizedPath.includes('/')
                ? '/' + normalizedPath.split('/').slice(0, -1).join('/')
                : '/'
        );

        // Build breadcrumbs
        const breadcrumbs = [{ name: 'Root', path: '/' }];
        if (!isRoot) {
            let accPath = '';
            for (const part of normalizedPath.split('/')) {
                accPath += '/' + part;
                breadcrumbs.push({ name: part, path: accPath });
            }
        }

        const responseData = {
            current_path: browsePath,
            parent_path: parentPath,
            breadcrumbs,
            items,
            total_items: items.length,
            is_search: false,
            borg_version: borgVersion,
        };

        // Cache the result in memory
        setCachedListing(cacheKey, responseData, isRoot);
        console.log(`✅ [Borg ${borgVersion}] Found ${items.length} items at "${browsePath}" (now caching)`);

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Browse archive error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to browse archive'
        });
    }
});

/**
 * Browse archive contents at a specific path (Borg 2.0 optimized)
 * GET /api/archives/:repositoryPath/:archiveName/browse
 * Query params: path (default: /)
 * @deprecated Use GET /api/archives/browse with query params instead
 * 
 * Redirects to the new /browse endpoint for consistency
 */
router.get('/:repositoryPath/:archiveName/browse', authenticateToken, async (req, res) => {
    // Redirect to the new endpoint format
    const repositoryPath = decodeURIComponent(req.params.repositoryPath || '');
    const archiveName = decodeURIComponent(req.params.archiveName || '');
    const browsePath = req.query.path || '/';
    const searchQuery = req.query.search || '';

    // Build query string for redirect
    const queryParams = new URLSearchParams({
        repository: repositoryPath,
        archive: archiveName,
        path: browsePath,
    });
    if (searchQuery) {
        queryParams.set('search', searchQuery);
    }

    // Internal redirect - call the new endpoint handler
    req.query.repository = repositoryPath;
    req.query.archive = archiveName;
    req.query.path = browsePath;

    console.log(`🔄 [Deprecated] Redirecting to /api/archives/browse?${queryParams.toString()}`);

    // Forward to the new handler by calling it directly
    // This avoids an HTTP redirect and keeps the response seamless
    try {
        // Re-use the browse logic from the main endpoint
        const cacheKey = `${repositoryPath}::${archiveName}::${browsePath}`;

        if (!searchQuery) {
            const cached = getCachedListing(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached });
            }
        }

        // Get passphrase
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Normalize path
        const normalizedPath = browsePath === '/' ? '' : browsePath.replace(/^\/+|\/+$/g, '');
        const isRoot = !normalizedPath;

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos
        const borgPathBin = getBorgPath(borgVersion);

        await configureBorgSshEnv(env, repositoryPath, 'Browse Legacy');

        // Build borg command based on version
        // Borg 1.x: borg list <repo>::<archive> --json-lines [--depth N] [path]
        // Borg 2.x: borg -r <repo> list <archive> --json-lines [--depth N] [path]
        const { execa } = require('execa');
        let listArgs;
        if (borgVersion === '2.x') {
            listArgs = ['-r', repositoryPath, 'list', archiveName, '--json-lines'];
        } else {
            listArgs = ['list', `${repositoryPath}::${archiveName}`, '--json-lines'];
        }
        if (isRoot) {
            listArgs.push('--depth', '1');
        } else {
            const pathDepth = normalizedPath.split('/').length + 1;
            listArgs.push('--depth', String(pathDepth), normalizedPath);
        }

        console.log(`📂 [Archives] Browsing with Borg ${borgVersion}: ${borgPathBin} ${listArgs.join(' ')}`);

        const { stdout, stderr } = await execa(borgPathBin, listArgs, {
            env,
            timeout: 60000,
            maxBuffer: 50 * 1024 * 1024
        });

        // Parse items
        const allItems = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                const itemPath = item.path.startsWith('/') ? item.path : '/' + item.path;

                allItems.push({
                    path: itemPath,
                    name: path.basename(itemPath) || itemPath,
                    type: item.type === 'd' ? 'directory' : 'file',
                    size: item.size || 0,
                    sizeFormatted: item.size ? formatBytes(item.size) : null,
                    modified: item.mtime || null,
                });
            } catch (e) { }
        }

        // Filter to direct children
        const browsePathNorm = isRoot ? '' : '/' + normalizedPath;
        const directChildren = new Map();

        for (const item of allItems) {
            if (item.path === browsePathNorm || item.path === browsePathNorm + '/') continue;

            const parentDir = path.dirname(item.path);
            const expectedParent = browsePathNorm || '/';

            if (parentDir === expectedParent || (isRoot && parentDir === '/')) {
                directChildren.set(item.path, item);
            }
        }

        const items = Array.from(directChildren.values()).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const parentPath = isRoot ? null : (
            normalizedPath.includes('/')
                ? '/' + normalizedPath.split('/').slice(0, -1).join('/')
                : '/'
        );

        const breadcrumbs = [{ name: 'Root', path: '/' }];
        if (!isRoot) {
            let accPath = '';
            for (const part of normalizedPath.split('/')) {
                accPath += '/' + part;
                breadcrumbs.push({ name: part, path: accPath });
            }
        }

        const responseData = {
            current_path: browsePath,
            parent_path: parentPath,
            breadcrumbs,
            items,
            total_items: items.length,
            borg_version: '2.x'
        };

        setCachedListing(cacheKey, responseData, isRoot);

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Failed to browse archive:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to browse archive'
        });
    }
});

/**
 * Preview text file content from archive
 * GET /api/archives/:repositoryPath/:archiveName/preview
 * Query params: path (required)
 */
router.get('/:repositoryPath/:archiveName/preview', authenticateToken, async (req, res) => {
    try {
        let repositoryPath = decodeURIComponent(req.params.repositoryPath || '');
        let archiveName = decodeURIComponent(req.params.archiveName || '');
        const filePath = req.query.path;

        if (!repositoryPath || !archiveName || !filePath) {
            return res.status(400).json({
                success: false,
                error: 'Repository path, archive name, and file path are required'
            });
        }

        // Security: validate file path
        if (filePath.includes('..')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid file path'
            });
        }

        console.log(`👁️ [Archives] Previewing file: "${filePath}" from "${archiveName}"`);

        // Get passphrase
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos
        const borgPathBin = getBorgPath(borgVersion);

        await configureBorgSshEnv(env, repositoryPath, 'Preview');

        // Create temp directory
        const tmpDir = path.join('/tmp', `borgmatic-preview-${Date.now()}`);
        await fs.ensureDir(tmpDir);

        try {
            // Normalize file path for borg (remove leading slash)
            const borgFilePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;

            // Extract the file to temp directory
            // Borg 1.x: borg extract <repo>::<archive> <path>
            // Borg 2.x: borg -r <repo> extract <archive> <path>
            const { execa } = require('execa');
            let extractArgs;
            if (borgVersion === '2.x') {
                extractArgs = ['-r', repositoryPath, 'extract', archiveName, borgFilePath];
            } else {
                extractArgs = ['extract', `${repositoryPath}::${archiveName}`, borgFilePath];
            }

            console.log(`📤 [Archives] Extracting with Borg ${borgVersion}: ${borgPathBin} ${extractArgs.join(' ')}`);

            await execa(borgPathBin, extractArgs, {
                env,
                cwd: tmpDir,
                timeout: 30000
            });

            // Read the extracted file
            const extractedPath = path.join(tmpDir, borgFilePath);

            if (!await fs.pathExists(extractedPath)) {
                throw new Error('File not found in archive');
            }

            const stats = await fs.stat(extractedPath);

            // Limit preview size to 500KB
            if (stats.size > 512000) {
                return res.json({
                    success: true,
                    data: {
                        path: filePath,
                        size: stats.size,
                        sizeFormatted: formatBytes(stats.size),
                        content: null,
                        truncated: true,
                        message: 'File too large to preview (>500KB). Use download instead.'
                    }
                });
            }

            // Read content
            const content = await fs.readFile(extractedPath, 'utf8');

            res.json({
                success: true,
                data: {
                    path: filePath,
                    size: stats.size,
                    sizeFormatted: formatBytes(stats.size),
                    content,
                    truncated: false,
                }
            });
        } finally {
            // Clean up
            await fs.remove(tmpDir).catch(() => { });
        }
    } catch (error) {
        console.error('Failed to preview file:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to preview file'
        });
    }
});

/**
 * Delete an archive
 * DELETE /api/archives/:repositoryPath/:archiveName
 * Note: Both params are URL-encoded
 */
router.delete('/:repositoryPath/:archiveName', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Decode URL parameters
        let repositoryPath = decodeURIComponent(req.params.repositoryPath || '');
        let archiveName = decodeURIComponent(req.params.archiveName || '');

        // Security: Validate inputs
        if (!repositoryPath || !archiveName) {
            return res.status(400).json({
                success: false,
                error: 'Repository path and archive name are required'
            });
        }

        // Prevent command injection via archive name
        const dangerousChars = /[;&|`$()<>]/;
        if (dangerousChars.test(archiveName)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid characters in archive name'
            });
        }

        console.log(`🗑️  [Archives] Decoded: repo="${repositoryPath}", archive="${archiveName}"`);

        // Get passphrase for this repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        // Use borg delete to remove the archive
        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Get repository info to determine Borg version
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos
        const borgPathBin = getBorgPath(borgVersion);

        await configureBorgSshEnv(env, repositoryPath, 'Delete');

        // Use borg delete to remove the archive
        // Borg 1.x: borg delete <repo>::<archive>
        // Borg 2.x: borg -r <repo> delete <archive> (soft-deletes, run borg compact to finalize)
        const { execa } = require('execa');
        let deleteArgs;
        if (borgVersion === '2.x') {
            deleteArgs = ['-r', repositoryPath, 'delete', archiveName];
        } else {
            deleteArgs = ['delete', `${repositoryPath}::${archiveName}`];
        }

        console.log(`🗑️  [Archives] Deleting with Borg ${borgVersion}: ${borgPathBin} ${deleteArgs.join(' ')}`);

        const { stdout, stderr } = await execa(borgPathBin, deleteArgs, {
            env,
            timeout: 60000
        });

        if (stderr && !stderr.includes('Warning')) {
            console.warn('Borg stderr:', stderr);
        }

        console.log(`✅ Archive deleted successfully`);

        // Invalidate Redis cache for this archive (if Borg 1.x)
        await invalidateArchive(repositoryPath, archiveName);

        res.json({
            success: true,
            data: {
                message: 'Archive deleted successfully. Note: In Borg 2.0, run "Compact" from repository operations to free disk space.',
                archive: archiveName,
                repository: repositoryPath
            }
        });
    } catch (error) {
        console.error('Failed to delete archive:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete archive'
        });
    }
});

/**
 * List archives in a repository
 * GET /api/archives/:repositoryPath
 * Note: repositoryPath is URL-encoded (e.g., %2Fhome%2Fmartin%2Fborgbackup)
 * This route MUST come LAST because it has a wildcard
 */
router.get('/:repositoryPath(*)', authenticateToken, async (req, res) => {
    try {
        // Decode the repository path from URL parameter
        let repositoryPath = req.params.repositoryPath || '';

        // Handle both encoded and unencoded paths
        try {
            repositoryPath = decodeURIComponent(repositoryPath);
        } catch (e) {
            // Already decoded or malformed
        }

        // Check if this is an SSH/SFTP/S3/Rclone path (remote repository)
        const isSSHPath = repositoryPath.startsWith('ssh://') || repositoryPath.startsWith('sftp://');
        const isS3Path = repositoryPath.startsWith('s3:');
        const isRclonePath = repositoryPath.startsWith('rclone:');
        const isRemotePath = isSSHPath || isS3Path || isRclonePath;

        // For remote paths, don't modify them (they're URLs, not filesystem paths)
        // For local paths, remove leading slash if Express added it, then ensure it starts with /
        if (!isRemotePath) {
            // Remove leading slash if present (Express might add it)
            repositoryPath = repositoryPath.replace(/^\/+/, '');

            // Ensure path starts with / for absolute paths
            if (repositoryPath && !repositoryPath.startsWith('/')) {
                repositoryPath = '/' + repositoryPath;
            }
        }

        console.log(`📚 [Archives] Listing archives in repository: ${repositoryPath}`);
        console.log(`📚 [Archives] Raw param: ${req.params.repositoryPath}`);
        console.log(`📚 [Archives] Path type: ${isSSHPath ? 'SSH' : isS3Path ? 'S3' : isRclonePath ? 'Rclone' : 'Local'}`);

        if (!repositoryPath || (!isRemotePath && repositoryPath === '/')) {
            return res.status(400).json({
                success: false,
                error: 'Repository path is required'
            });
        }

        // Get passphrase for this repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
            if (passphrase) {
                console.log(`🔑 Using stored passphrase for repository`);
            }
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        // Use borg list directly (doesn't require config files)
        const env = { ...process.env };

        // Check if repository is encrypted
        let isEncrypted = false;
        try {
            const repoConfigPath = path.join(repositoryPath, 'config');
            if (fs.existsSync(repoConfigPath)) {
                const repoConfig = await fs.readFile(repoConfigPath, 'utf8');
                isEncrypted = repoConfig.includes('key =');
            }
        } catch (configReadError) {
            // Assume it might be encrypted if we can't read config (e.g., remote repo)
            isEncrypted = true;
        }

        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        } else if (isEncrypted && !isRemotePath) {
            // For local encrypted repos without passphrase, return error immediately
            console.log(`🔐 Repository appears encrypted but no passphrase found`);
            return res.status(400).json({
                success: false,
                error: 'Repository is encrypted but passphrase is not stored',
                details: 'This repository was created with a passphrase that is not stored in this Borgmatic UI instance. Please edit the repository and enter the passphrase.',
                requires_passphrase: true,
                repository: repositoryPath
            });
        }

        // Set BORG_PASSPHRASE to something to prevent interactive prompt
        // If no passphrase is set, set it to empty string to make borg fail fast
        if (!env.BORG_PASSPHRASE) {
            env.BORG_PASSPHRASE = '';
        }

        // Handle SSH authentication for SSH/SFTP repositories
        let tempKeyPath = null;
        if (isSSHPath) {
            try {
                // Look up repository to get SSH credentials
                const allRepos = await configParser.getAllRepositoriesWithUsage();
                const repo = allRepos.find(r => r.path === repositoryPath);

                if (repo && (repo.repository_type === 'ssh' || repo.repository_type === 'sftp' || repo.repository_type === 'hetzner')) {
                    const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');
                    console.log(`🔐 [Archives] SSH/Hetzner repository detected (type: ${repo.repository_type}), auth method: ${authMethod}`);

                    if (authMethod === 'key' && repo.ssh_key_id) {
                        // Get SSH key and write to temporary file
                        const sshKeysAPI = require('../services/ssh-keys');
                        const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);

                        if (sshKey && sshKey.private_key) {
                            tempKeyPath = await writeSSHKeyToFilesystem(repo.ssh_key_id, sshKey.private_key, sshKey.passphrase || null);

                            // Extract connection details from SSH path
                            const sshMatch = repositoryPath.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            if (sshMatch) {
                                const port = sshMatch[3] || '22';
                                env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new`;
                                console.log(`🔑 [Archives] Using SSH key authentication`);
                            }
                        }
                    } else if (authMethod === 'password') {
                        // Get SSH password
                        const sshPassword = await repositoryCredentials.getSSHPassword(repositoryPath);
                        if (sshPassword) {
                            // Extract connection details from SSH path
                            const sshMatch = repositoryPath.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            if (sshMatch) {
                                const port = sshMatch[3] || '22';
                                env.SSHPASS = sshPassword;
                                env.BORG_RSH = `sshpass -e ssh -p ${port} -o StrictHostKeyChecking=accept-new`;
                                console.log(`🔐 [Archives] Using SSH password authentication`);
                            }
                        }
                    }
                }
            } catch (sshError) {
                console.error('Failed to set up SSH authentication:', sshError.message);
                // Continue anyway - might work without auth if keys are already configured
            }
        }

        // Determine Borg version and binary path
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        const borgVersion = repo?.borg_version || '1.x'; // Default to 1.x for existing repos without version stored
        const borgPath = getBorgPath(borgVersion);

        // Use execa with argument array instead of shell command for safety
        // Borg 2.0: use 'repo-list', Borg 1.x: use 'list'
        const { command, args } = getBorgCommand(borgVersion, 'list', {
            repoPath: repositoryPath,
            extraArgs: ['--json'],
            remotePath: repo?.hetzner_borg_version, // For Hetzner Storage Boxes
        });

        console.log(`🔄 [Archives] Listing archives using Borg ${borgVersion} (${command})...`);

        try {
            const { stdout, stderr } = await execa(command, args, {
                env,
                timeout: 30000
            });

            if (stderr && !stderr.includes('Warning')) {
                console.warn('Borg stderr:', stderr);
            }

            // Parse JSON output
            let archives = [];
            try {
                const data = JSON.parse(stdout);
                console.log(`📦 Raw borg output structure:`, Object.keys(data));

                // Get backup job mapping for this repository
                const backupJobMapping = await getBackupJobMapping(repositoryPath);
                console.log(`📋 Found ${Object.keys(backupJobMapping).length} backup job(s) using this repository`);

                // Borg list --json returns: { "archives": [...], "repository": {...} }
                if (data.archives && Array.isArray(data.archives)) {
                    console.log(`📋 Raw archives from borg:`, JSON.stringify(data.archives, null, 2));
                    archives = data.archives.map(arc => {
                        // Extract archive name and ID
                        const archiveName = arc.archive || arc.name;
                        // Borg 2.0 uses 'id' for unique archive identification
                        const archiveId = arc.id || archiveName;

                        const match = archiveName.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T.+)$/);
                        const archivePrefix = match ? match[1] : archiveName;

                        // Try to find actual backup job name from config
                        let backupJobName = archivePrefix;
                        for (const [jobName, jobInfo] of Object.entries(backupJobMapping)) {
                            // If archive format contains the job name, use it
                            if (jobInfo.format && jobInfo.format.includes(jobName)) {
                                backupJobName = jobName;
                                break;
                            }
                        }

                        // If only one backup job uses this repo, assume it's that one
                        if (Object.keys(backupJobMapping).length === 1) {
                            backupJobName = Object.keys(backupJobMapping)[0];
                        }

                        return {
                            name: archiveName,
                            id: archiveId,
                            created: normalizeTimestamp(arc.time || arc.start) || new Date().toISOString(),
                            backup_job: backupJobName, // Actual backup job name from config
                            backup_job_prefix: archivePrefix, // Prefix extracted from archive name
                            size: 'Unknown', // Size requires separate borg info call
                            compressed_size: 'Unknown',
                            file_count: 0,
                            tags: arc.tags || [],
                            hostname: arc.host || null,
                            username: arc.user || null,
                        };
                    });
                }

                console.log(`✅ Found ${archives.length} archives in repository`);
            } catch (parseError) {
                console.error('Failed to parse borg output:', parseError.message);
                console.error('Raw output:', stdout.substring(0, 500));
            }

            // Clean up temp SSH key if used
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => { });
            }

            res.json({
                success: true,
                data: {
                    archives,
                    repository: repositoryPath
                }
            });
        } catch (execError) {
            // Clean up temp SSH key if used
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => { });
            }

            console.error('❌ Borg command failed:', execError.message);
            console.error('❌ Error details:', execError);

            const errorMessage = execError.message || '';
            const errorStderr = execError.stderr || '';
            const errorStdout = execError.stdout || '';

            // Return empty array instead of error if repository exists but has no archives
            if (errorMessage.includes('No archives found') ||
                errorMessage.includes('Repository not found') ||
                errorStderr.includes('No archives found') ||
                errorStderr.includes('Repository not found') ||
                errorStderr.includes('does not exist')) {
                return res.json({
                    success: true,
                    data: {
                        archives: [],
                        repository: repositoryPath
                    }
                });
            }

            // Check for passphrase-related errors
            if (errorMessage.includes('passphrase') ||
                errorMessage.includes('wrong key') ||
                errorMessage.includes('key file') ||
                errorMessage.includes('Passphrase') ||
                errorStderr.includes('passphrase') ||
                errorStderr.includes('wrong key') ||
                errorStderr.includes('Passphrase')) {
                return res.status(400).json({
                    success: false,
                    error: 'Repository passphrase is incorrect or missing',
                    details: 'Please edit the repository settings and enter the correct passphrase.',
                    requires_passphrase: true,
                    repository: repositoryPath
                });
            }

            // Check for timeout which often means passphrase prompt is waiting
            if (errorMessage.includes('timed out') || errorMessage.includes('Timed out')) {
                return res.status(400).json({
                    success: false,
                    error: 'Repository requires a passphrase that is not stored',
                    details: 'The repository is encrypted but the passphrase is not saved in Borgmatic UI. Please edit the repository and enter the passphrase.',
                    requires_passphrase: true,
                    repository: repositoryPath
                });
            }

            // Return detailed error
            return res.status(500).json({
                success: false,
                error: errorMessage || 'Failed to execute borg command',
                details: errorStderr || errorStdout || ''
            });
        }
    } catch (error) {
        console.error('❌ Failed to list archives:', error.message);
        console.error('❌ Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to list archives',
            detail: 'An error occurred while retrieving archive information'
        });
    }
});

module.exports = router;

