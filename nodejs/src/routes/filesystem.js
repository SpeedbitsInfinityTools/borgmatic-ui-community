const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const fsRaw = require('fs');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

function isUnsafePathInput(p) {
    // Reject null bytes and obviously bad inputs
    return typeof p !== 'string' || p.length === 0 || p.includes('\0');
}

// --- Borg-repo detection (bounded + cached) ------------------------------
// Detecting whether a directory is a Borg repository requires probing one
// level deeper (does it contain `config` + `data`?). On local disk this is
// microseconds, but on a FUSE/cloud mount (e.g. an rclone-mounted Azure blob
// container) a single existence check can force a full directory enumeration
// that takes minutes when the directory holds millions of objects. To keep the
// browse endpoint fast and predictable we (a) only run detection when the
// caller asks for it, (b) bound every probe with a short timeout, and (c)
// memoise the result briefly.
const BORG_DETECT_CACHE_TTL_MS = 5 * 60 * 1000;
const BORG_DETECT_TIMEOUT_MS = 1500;
const borgDetectCache = new Map(); // absolutePath -> { result: boolean, ts: number }

// Per-entry stat is also bounded: on a network mount (CIFS/NFS/Synology) a
// single odd entry (e.g. a "#recycle" bin, or a symlink to an offline target)
// can block stat for the full nginx timeout and 504 the whole listing.
const ENTRY_STAT_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('probe-timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Determine whether `dirPath` is a Borg repository.
 *
 * Bounded by BORG_DETECT_TIMEOUT_MS and memoised for BORG_DETECT_CACHE_TTL_MS.
 * On timeout or any error we return `false` (not "unknown") on purpose: a real
 * Borg repo root contains only a handful of entries and answers well within the
 * timeout, whereas the pathological directories that would stall the probe
 * (millions of files) are never Borg repositories anyway. So a slow backend can
 * never hang the browse, and we don't produce false negatives in practice.
 */
async function detectBorgRepo(dirPath) {
    const cached = borgDetectCache.get(dirPath);
    if (cached && (Date.now() - cached.ts) < BORG_DETECT_CACHE_TTL_MS) {
        return cached.result;
    }

    let result = false;
    try {
        const configFile = path.join(dirPath, 'config');
        const dataDir = path.join(dirPath, 'data');
        const [hasConfig, hasData] = await withTimeout(
            Promise.all([fs.pathExists(configFile), fs.pathExists(dataDir)]),
            BORG_DETECT_TIMEOUT_MS
        );
        if (hasConfig && hasData) {
            const configContent = await withTimeout(
                fs.readFile(configFile, 'utf8'),
                BORG_DETECT_TIMEOUT_MS
            );
            result = configContent.includes('[repository]');
        }
    } catch (_e) {
        // Timeout / unreadable / not a repo — treat as not-a-repo (see doc above).
        result = false;
    }

    borgDetectCache.set(dirPath, { result, ts: Date.now() });
    return result;
}

/**
 * Collect a one-shot snapshot of the current process's identity, capabilities,
 * seccomp/AppArmor profile, and how it sees a given path. Used when the
 * browse/create handlers fail with EACCES so we can tell at a glance whether
 * the failure is a genuine POSIX permission issue or a container-level
 * restriction (capability drop, seccomp, AppArmor, user-namespace remap, …).
 *
 * Intentionally verbose: if it reproduces once in production we want
 * every detail next to the error line in `docker logs`, without requiring
 * the user to re-run ad-hoc commands.
 */
function describeProcessEnvironment(targetPath) {
    const out = {};
    try {
        out.uid = process.getuid?.();
        out.euid = process.geteuid?.();
        out.gid = process.getgid?.();
        out.egid = process.getegid?.();
        out.groups = process.getgroups?.();
    } catch (_e) { /* Windows */ }

    try {
        out.self_status = fsRaw.readFileSync('/proc/self/status', 'utf8')
            .split('\n')
            .filter(l => /^(Name|Uid|Gid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp)\b/.test(l))
            .join(' | ');
    } catch (_e) { /* non-Linux */ }

    try {
        out.self_attr = fsRaw.readFileSync('/proc/self/attr/current', 'utf8').trim();
    } catch (_e) { /* not set or unreadable */ }

    if (targetPath) {
        try {
            const s = fsRaw.lstatSync(targetPath);
            out.target_mode = (s.mode & 0o7777).toString(8);
            out.target_uid = s.uid;
            out.target_gid = s.gid;
            out.target_type = s.isDirectory() ? 'dir' : s.isSymbolicLink() ? 'symlink' : 'file';
        } catch (e) {
            out.target_stat_error = `${e.code || e.name}: ${e.message}`;
        }
        try {
            fsRaw.accessSync(targetPath, fsRaw.constants.R_OK | fsRaw.constants.X_OK);
            out.access_rx = 'ok';
        } catch (e) {
            out.access_rx = `${e.code || e.name}: ${e.message}`;
        }
    }

    return out;
}

/**
 * Browse filesystem directories and files
 * GET /api/filesystem/browse?path=/home&mode=directories
 */
router.get('/browse', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const targetPath = req.query.path || '/';
        const selectMode = req.query.mode || 'directories'; // 'directories', 'files', 'both'
        // Borg-repo detection is opt-in: it probes one level deeper than the
        // listing (expensive on FUSE/cloud mounts). Only callers that actually
        // render the "Borg Repo" badge / select-vs-navigate behaviour (the
        // repository picker) request it; sources, destinations, log/temp path
        // pickers, etc. leave it off and get a plain, fast listing.
        const detectBorg = req.query.detect_borg === 'true' || req.query.detect_borg === '1';

        if (isUnsafePathInput(targetPath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid path'
            });
        }

        // Resolve to absolute path
        const absolutePath = path.resolve(targetPath);

        // Ensure it is absolute (Linux)
        if (!path.isAbsolute(absolutePath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid path'
            });
        }

        // Check if path exists
        const exists = await fs.pathExists(absolutePath);
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: `Path does not exist: ${absolutePath}`
            });
        }

        // Check if it's a directory
        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
            return res.status(400).json({
                success: false,
                error: 'Path is not a directory'
            });
        }

        // Read directory contents
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });

        // Process entries
        const items = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.join(absolutePath, entry.name);
            let entryStats = null;
            let isBorgRepo = false;
            let isAccessible = true;

            try {
                // Use lstat (like `ls -l`), not stat: stat follows symlinks, so
                // a link pointing at a slow/offline target would block here for
                // the full nginx timeout. Bound it too, so one problematic entry
                // can't stall the entire listing — we just show it without stat
                // details instead of failing the whole browse.
                entryStats = await withTimeout(fs.lstat(fullPath), ENTRY_STAT_TIMEOUT_MS);
            } catch (e) {
                // Inaccessible or timed out — still list the entry, marked.
                isAccessible = false;
            }

            // Only probe for Borg-repo-ness when the caller asked for it, and
            // only for directories we could stat. The probe is bounded + cached.
            if (detectBorg && isAccessible && entry.isDirectory()) {
                isBorgRepo = await detectBorgRepo(fullPath);
            }

            // Note: We always show directories for navigation
            // The 'mode' parameter controls what can be SELECTED, not what is VISIBLE
            // Filter only files when in directories-only mode
            if (selectMode === 'directories' && !entry.isDirectory()) {
                return null;
            }
            // In 'files' or 'both' mode, show everything (dirs for navigation, files for selection)

            return {
                name: entry.name,
                path: fullPath,
                is_directory: entry.isDirectory(),
                is_file: entry.isFile(),
                is_symlink: entry.isSymbolicLink(),
                size: entryStats?.size || null,
                modified: entryStats?.mtime?.toISOString() || null,
                is_borg_repo: isBorgRepo,
                is_accessible: isAccessible,
                permissions: entryStats ? (entryStats.mode & 0o777).toString(8).padStart(3, '0') : null
            };
        }));

        // Filter out nulls (entries that didn't match mode)
        const filteredItems = items.filter(i => i !== null);

        // Sort: directories first, then alphabetically (case-insensitive)
        filteredItems.sort((a, b) => {
            if (a.is_directory !== b.is_directory) {
                return b.is_directory ? 1 : -1;
            }
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        res.json({
            success: true,
            data: {
                current_path: absolutePath,
                parent_path: path.dirname(absolutePath),
                is_root: absolutePath === '/',
                items: filteredItems,
                total_items: filteredItems.length
            }
        });

    } catch (error) {
        console.error('Failed to browse filesystem:', error);

        if (error.code === 'EACCES') {
            // EACCES on a path the host's root CAN read indicates a container
            // restriction (seccomp / AppArmor / dropped capability / userns
            // remap) rather than a real POSIX permission problem. Dump the
            // running process's identity & capabilities next to the error so
            // ops can tell immediately which mechanism is blocking.
            console.error('[filesystem] EACCES diagnostics:', describeProcessEnvironment(error.path || req.query.path));
            return res.status(403).json({
                success: false,
                error: 'Permission denied: cannot access this directory'
            });
        }

        if (error.code === 'ENOENT') {
            return res.status(404).json({
                success: false,
                error: 'Path does not exist'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Validate if a path exists and get its info
 * POST /api/filesystem/validate-path
 */
router.post('/validate-path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: targetPath } = req.body;

        if (!targetPath) {
            return res.status(400).json({
                success: false,
                error: 'Path is required'
            });
        }

        if (isUnsafePathInput(targetPath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid path'
            });
        }

        const absolutePath = path.resolve(targetPath);
        const exists = await fs.pathExists(absolutePath);

        if (!exists) {
            return res.json({
                success: true,
                data: {
                    exists: false,
                    path: absolutePath,
                    is_directory: false,
                    is_file: false,
                    is_borg_repo: false
                }
            });
        }

        const stats = await fs.stat(absolutePath);
        let isBorgRepo = false;

        // Check if it's a Borg repository (bounded + cached so a slow mount
        // can't hang validation).
        if (stats.isDirectory()) {
            isBorgRepo = await detectBorgRepo(absolutePath);
        }

        res.json({
            success: true,
            data: {
                exists: true,
                path: absolutePath,
                is_directory: stats.isDirectory(),
                is_file: stats.isFile(),
                is_symlink: stats.isSymbolicLink(),
                size: stats.size,
                modified: stats.mtime.toISOString(),
                is_borg_repo: isBorgRepo,
                permissions: (stats.mode & 0o777).toString(8).padStart(3, '0')
            }
        });

    } catch (error) {
        console.error('Failed to validate path:', error);
        
        if (error.code === 'EACCES') {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create a directory
 * POST /api/filesystem/create-directory
 */
router.post('/create-directory', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: targetPath } = req.body;

        if (!targetPath) {
            return res.status(400).json({
                success: false,
                error: 'Path is required'
            });
        }

        if (isUnsafePathInput(targetPath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid path'
            });
        }

        const absolutePath = path.resolve(targetPath);

        // Check if already exists
        if (await fs.pathExists(absolutePath)) {
            return res.status(409).json({
                success: false,
                error: 'Path already exists'
            });
        }

        // Create the directory (including parents)
        await fs.ensureDir(absolutePath);

        res.json({
            success: true,
            message: 'Directory created successfully',
            data: {
                path: absolutePath
            }
        });

    } catch (error) {
        console.error('Failed to create directory:', error);

        if (error.code === 'EACCES') {
            // Same story as /browse: if the host root can mkdir here, an
            // EACCES from inside the container points at a container-level
            // restriction we need to diagnose. Log the parent directory so
            // we can see what the process *does* have access to.
            const parentForDiag = error.path ? path.dirname(error.path) : undefined;
            console.error('[filesystem] EACCES diagnostics:', describeProcessEnvironment(parentForDiag));
            return res.status(403).json({
                success: false,
                error: 'Permission denied: cannot create directory here'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

