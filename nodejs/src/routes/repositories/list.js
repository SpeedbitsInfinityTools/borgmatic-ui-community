const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const configParser = require('../../services/config-parser');
const { getBorgCommand } = require('../../services/borg-version-detector');

/**
 * Detect if a borg error indicates a locked repository
 * @param {string} stderr - stderr output from borg command
 * @param {number} exitCode - exit code from borg command
 * @returns {boolean}
 */
function isLockError(stderr, exitCode) {
    // Note: exit code 105 in borgmatic 2.x is a PERMISSION warning (files
    // borg cannot read), NOT a lock error. Do not treat it as a lock.
    
    // Check if this is a permission error, not a lock error
    // Permission errors can trigger "Failed to create/acquire the lock" messages
    // but the root cause is permissions, not an actual lock
    if (stderr) {
        const lowerStderr = stderr.toLowerCase();
        if (lowerStderr.includes('permission denied') || 
            lowerStderr.includes('errno 13') ||
            lowerStderr.includes('eacces')) {
            // This is a permission error, not a lock error
            return false;
        }
    }
    
    // Also check stderr for lock-related messages
    const lockPatterns = [
        'Failed to create/acquire the lock',
        'Lock held by',
        'Repository is already locked',
        'LockError',
        'LockTimeout',
        'LockFailed',
        'lock.exclusive',
        'Another instance is already running',
        'lock timed out',
        'waiting for lock',
        'Could not acquire lock'
    ];
    
    if (stderr) {
        const lowerStderr = stderr.toLowerCase();
        for (const pattern of lockPatterns) {
            if (lowerStderr.includes(pattern.toLowerCase())) return true;
        }
    }
    
    return false;
}

/**
 * Decide whether a repository is "remote" (lives over the network) so we can
 * skip the expensive `borg info`/`borg list` calls when listing repositories.
 *
 * Remote repos:
 *   - SSH/SFTP/Hetzner: path starts with ssh:// or sftp://
 *   - Rclone (Borg 2.x native): path starts with rclone:
 *   - S3 (Borg 2.x): path starts with s3:
 *
 * We also treat anything with `repository_type` of ssh/sftp/hetzner/rclone/s3
 * as remote, in case the path representation is unusual.
 *
 * For remote repos the bulk listing returns archive_count: null and
 * total_size: null; the UI shows a "Load Stats" button that calls
 * /repositories/:id/stats on demand. This prevents hangs when SSH targets
 * are slow, unreachable, or prompt for a host key/passphrase.
 *
 * @param {object} repo
 * @returns {boolean}
 */
function isRemoteRepository(repo) {
    if (!repo) return false;
    const declared = (repo.repository_type || '').toLowerCase();
    if (declared === 'ssh' || declared === 'sftp' || declared === 'hetzner' ||
        declared === 'rclone' || declared === 's3') {
        return true;
    }
    const p = String(repo.path || '');
    const looksLikeScpStyle = /^(?:local:)?[^/][^@]*@[^:]+:.+/.test(p);
    return (
        p.startsWith('ssh://') ||
        p.startsWith('sftp://') ||
        p.startsWith('local:ssh://') ||
        p.startsWith('local:sftp://') ||
        p.startsWith('rclone:') ||
        p.startsWith('s3:') ||
        looksLikeScpStyle
    );
}

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repositories = await configParser.getAllRepositoriesWithUsage();
        console.log(`📋 Retrieved ${repositories.length} repository(ies) with usage status`);

        // Enrich repositories with actual borg info (encryption, archive count, etc.)
        const enrichedRepos = await Promise.all(repositories.map(async (repo, index) => {
            let actualEncryption = repo.encryption || 'none';
            let archiveCount = 0;
            let totalSize = null;
            let isLocked = false;
            let lockError = null;

            // Skip borg info/list for remote repositories.
            //
            // The Repositories page already supports on-demand stats loading
            // (see "Load Stats" button when archive_count === null), so for
            // SSH/SFTP/Hetzner/Rclone/S3 repos we return null counts up front.
            //
            // Why we skip here:
            //   1. Each `borg info`/`borg list` over SSH spawns a remote
            //      `borg serve` process; if the network is slow or the host
            //      prompts for a host-key/passphrase, the call can hang far
            //      past the configured timeout.
            //   2. Even when calls succeed, two round-trips per remote repo
            //      makes the listing stack to many seconds. Promise.all only
            //      helps if the slowest repo finishes; one bad target stalls
            //      the entire page.
            //   3. Stale `ssh ... borg serve` processes can pile up across
            //      nodemon restarts and saturate the SSH connection limit.
            const isRemoteRepo = isRemoteRepository(repo);
            if (isRemoteRepo) {
                const repoName = repo.name || repo.label || (repo.isDiscovered ? 'Discovered automatically - not named yet' : `Repository ${index + 1}`);
                return {
                    id: repo.id || `repo-legacy-${index + 1}`,
                    name: repoName,
                    label: repo.label || repoName,
                    path: repo.path,
                    repository_type: repo.repository_type || repo.type || 'local',
                    storage_mode: repo.storage_mode,
                    local_path: repo.local_path,
                    read_only: repo.read_only ?? false,
                    host: repo.host,
                    port: repo.port,
                    username: repo.username,
                    ssh_key_id: repo.ssh_key_id,
                    ssh_auth_method: repo.ssh_auth_method,
                    rclone_remote: repo.rclone_remote,
                    rclone_path: repo.rclone_path,
                    s3_endpoint: repo.s3_endpoint,
                    s3_bucket: repo.s3_bucket,
                    s3_path: repo.s3_path,
                    s3_region: repo.s3_region,
                    encryption: actualEncryption,
                    compression: repo.compression || 'lz4',
                    borg_version: repo.borg_version || '1.x',
                    hetzner_borg_version: repo.hetzner_borg_version,
                    last_backup: null,
                    total_size: null,
                    archive_count: null, // <- triggers "Load Stats" button in UI
                    is_active: repo.is_active || false,
                    isUsed: repo.isUsed,
                    usedInBackups: repo.usedInBackups,
                    created_at: repo.created_at || new Date().toISOString(),
                    updated_at: null,
                    isDiscovered: repo.isDiscovered || false,
                    is_locked: null,
                    lock_error: null
                };
            }

            // Try to get actual encryption from borg info (LOCAL repos only)
            try {
                console.log(`🔍 [Repos] Getting borg info for: ${repo.path}`);

                // Get passphrase for this repository
                let passphrase = null;
                try {
                    passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
                    if (passphrase) {
                        console.log(`🔑 [Repos] Found passphrase for: ${repo.path}`);
                    } else {
                        console.log(`⚠️  [Repos] No passphrase found for: ${repo.path}`);
                    }
                } catch (err) {
                    console.warn(`⚠️  [Repos] Error getting passphrase:`, err.message);
                }

                // Use borg info directly (doesn't require config files)
                const env = { ...process.env };
                if (passphrase) {
                    env.BORG_PASSPHRASE = passphrase;
                }

                // Use execa instead of exec to prevent command injection
                const { execa } = require('execa');
                // Use version-appropriate command
                const borgVersion = repo.borg_version || '1.x'; // Default to 1.x for existing repos

                // Local repos: short timeout (we already returned early for remotes)
                const timeout = 10000;
                
                // Use --lock-wait=1 to fail quickly if there's a lock
                const { command, args } = getBorgCommand(borgVersion, 'info', {
                    repoPath: repo.path,
                    extraArgs: ['--json', '--lock-wait=1'],
                    remotePath: repo.hetzner_borg_version, // For Hetzner Storage Boxes
                });

                console.log(`📊 [Repos] Listing archives using Borg ${borgVersion} (${command}), timeout=${timeout}ms...`);

                try {
                    const result = await execa(command, args, {
                        env,
                        timeout,
                        reject: false // Don't throw on non-zero exit
                    });

                    const { stdout, stderr, exitCode } = result;

                    // Check for lock errors
                    if (isLockError(stderr, exitCode)) {
                        isLocked = true;
                        lockError = stderr || `Repository is locked (exit code ${exitCode})`;
                        console.warn(`🔒 [Repos] Repository is LOCKED: ${repo.path}`);
                    } else if (exitCode === 0) {
                        console.log(`📊 [Repos] Borg info SUCCESS for ${repo.path}`);
                    }

                    if (stderr && !stderr.includes('Warning') && !isLocked) {
                        console.warn('Borg stderr:', stderr);
                    }

                    // Only parse JSON if stdout exists and is not empty
                    if (stdout && stdout.trim()) {
                        try {
                            const info = JSON.parse(stdout);
                            console.log(`📦 [Repos] Parsed borg info:`, JSON.stringify(info, null, 2).substring(0, 200));

                            // Borg info returns repository object with encryption info
                            if (info.encryption && info.encryption.mode) {
                                actualEncryption = info.encryption.mode;
                                console.log(`🔐 [Repos] Detected encryption: ${actualEncryption}`);
                            } else {
                                console.log(`⚠️  [Repos] No encryption info in borg output`);
                            }

                            // Extract total size from cache stats (Borg 2.x) or repository info
                            // Borg 2.x: info.cache.stats.unique_size or info.cache.stats.total_size
                            // Borg 1.x: info.cache.stats.unique_csize
                            const cacheStats = info.cache?.stats;
                            if (cacheStats) {
                                // unique_size is the deduplicated size (actual disk usage)
                                const sizeBytes = cacheStats.unique_size || cacheStats.unique_csize || 0;
                                if (sizeBytes > 0) {
                                    // Format bytes to human readable
                                    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                                    let size = sizeBytes;
                                    let unitIndex = 0;
                                    while (size >= 1024 && unitIndex < units.length - 1) {
                                        size /= 1024;
                                        unitIndex++;
                                    }
                                    totalSize = `${size.toFixed(2)} ${units[unitIndex]}`;
                                    console.log(`📏 [Repos] Total size for ${repo.path}: ${totalSize}`);
                                }
                            }

                            // Note: borg info doesn't include archive count, we need borg list for that
                            // (handled separately below)
                        } catch (parseError) {
                            console.error(`❌ [Repos] Failed to parse borg info JSON:`, parseError.message);
                        }
                    } else if (!isLocked) {
                        console.warn(`⚠️  [Repos] Borg info returned empty output for ${repo.path}`);
                    }
                } catch (infoError) {
                    // Check if this is a lock error
                    if (isLockError(infoError.stderr, infoError.exitCode)) {
                        isLocked = true;
                        lockError = infoError.stderr || infoError.message;
                        console.warn(`🔒 [Repos] Repository is LOCKED: ${repo.path}`);
                    } else {
                        console.error(`❌ [Repos] Borg info failed for ${repo.path}:`, infoError.message);
                        if (infoError.stderr) {
                            console.error(`❌ [Repos] Stderr:`, infoError.stderr);
                        }
                    }
                }

                // Get archive count using borg list --json (skip if repo is locked)
                if (!isLocked) {
                    try {
                        const listCmd = getBorgCommand(borgVersion, 'list', {
                            repoPath: repo.path,
                            extraArgs: ['--json', '--lock-wait=1'],
                            remotePath: repo.hetzner_borg_version, // For Hetzner Storage Boxes
                        });
                        const listResult = await execa(listCmd.command, listCmd.args, {
                            env,
                            timeout: 15000, // local-only path; remote repos returned early
                            reject: false
                        });
                        
                        // Check for lock errors on list command too
                        if (isLockError(listResult.stderr, listResult.exitCode)) {
                            isLocked = true;
                            lockError = listResult.stderr || `Repository is locked (exit code ${listResult.exitCode})`;
                            console.warn(`🔒 [Repos] Repository is LOCKED (detected on list): ${repo.path}`);
                        } else if (listResult.stdout && listResult.stdout.trim()) {
                            const listInfo = JSON.parse(listResult.stdout);
                            if (Array.isArray(listInfo.archives)) {
                                archiveCount = listInfo.archives.length;
                                console.log(`📦 [Repos] Archive count for ${repo.path}: ${archiveCount}`);
                            }
                        }
                    } catch (listError) {
                        if (isLockError(listError.stderr, listError.exitCode)) {
                            isLocked = true;
                            lockError = listError.stderr || listError.message;
                        } else {
                            console.warn(`⚠️  [Repos] Could not get archive count for ${repo.path}:`, listError.message);
                        }
                    }
                }
            } catch (infoError) {
                // If we can't get borg info, use the stored encryption
                console.error(`❌ [Repos] Exception getting borg info for ${repo.path}:`, infoError.message);
            }

            // Use discovered name if available, otherwise fall back to existing logic
            const repoName = repo.name || repo.label || (repo.isDiscovered ? 'Discovered automatically - not named yet' : `Repository ${index + 1}`);

            return {
                id: repo.id || `repo-legacy-${index + 1}`,
                name: repoName,
                label: repo.label || repoName,
                path: repo.path,
                repository_type: repo.repository_type || repo.type || 'local',
                storage_mode: repo.storage_mode,
                local_path: repo.local_path,
                read_only: repo.read_only ?? false,
                host: repo.host,
                port: repo.port,
                username: repo.username,
                ssh_key_id: repo.ssh_key_id,
                ssh_auth_method: repo.ssh_auth_method,
                rclone_remote: repo.rclone_remote,
                rclone_path: repo.rclone_path,
                s3_endpoint: repo.s3_endpoint,
                s3_bucket: repo.s3_bucket,
                s3_path: repo.s3_path,
                s3_region: repo.s3_region,
                encryption: actualEncryption,
                compression: repo.compression || 'lz4',
                // Borg version info
                borg_version: repo.borg_version || '1.x',  // Default to 1.x for existing repos without version stored
                last_backup: null,
                total_size: totalSize,
                archive_count: archiveCount,
                is_active: repo.is_active || false,
                isUsed: repo.isUsed,
                usedInBackups: repo.usedInBackups,
                created_at: repo.created_at || new Date().toISOString(),
                updated_at: null,
                isDiscovered: repo.isDiscovered || false,
                // Lock status
                is_locked: isLocked,
                lock_error: lockError
            };
        }));

        res.json({
            success: true,
            data: {
                repositories: enrichedRepos
            }
        });
    } catch (error) {
        console.error('Failed to get repositories:', error.message);
        res.status(500).json({ detail: 'Failed to get repositories' });
    }
});

/**
 * GET /list - Lightweight listing without borg info (fast)
 * Returns repositories from config only, no borg commands executed
 */
router.get('/list', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repositories = await configParser.getAllRepositoriesWithUsage();
        console.log(`📋 [Fast List] Retrieved ${repositories.length} repository(ies) from config`);

        // Return repositories without running borg info (fast)
        const lightRepos = repositories.map((repo, index) => ({
            id: repo.id || `repo-legacy-${index + 1}`,
            name: repo.name || repo.label || (repo.isDiscovered ? 'Discovered automatically' : `Repository ${index + 1}`),
            label: repo.label || repo.name || `Repository ${index + 1}`,
            path: repo.path,
            repository_type: repo.repository_type || repo.type || 'local',
            storage_mode: repo.storage_mode,
            local_path: repo.local_path,
            read_only: repo.read_only ?? false,
            host: repo.host,
            port: repo.port,
            username: repo.username,
            ssh_key_id: repo.ssh_key_id,
            ssh_auth_method: repo.ssh_auth_method,
            rclone_remote: repo.rclone_remote,
            rclone_path: repo.rclone_path,
            s3_endpoint: repo.s3_endpoint,
            s3_bucket: repo.s3_bucket,
            s3_path: repo.s3_path,
            s3_region: repo.s3_region,
            encryption: repo.encryption || 'unknown', // From config, not verified
            compression: repo.compression || 'lz4',
            // Borg version info
            borg_version: repo.borg_version || '1.x', // Default to 1.x for existing repos without version stored
            // Hetzner Storage Box: remote Borg version (--remote-path)
            hetzner_borg_version: repo.hetzner_borg_version,
            is_active: repo.is_active || false,
            isUsed: repo.isUsed,
            usedInBackups: repo.usedInBackups,
            isDiscovered: repo.isDiscovered || false,
            // These are not available without borg info (use Load Stats)
            archive_count: null,
            total_size: null,
            last_archive: null,
            // Lock status not available in fast mode
            is_locked: null,
            lock_error: null
        }));

        res.json({
            success: true,
            data: {
                repositories: lightRepos
            }
        });
    } catch (error) {
        console.error('Failed to get repositories (fast list):', error.message);
        res.status(500).json({ detail: 'Failed to get repositories' });
    }
});

module.exports = router;
