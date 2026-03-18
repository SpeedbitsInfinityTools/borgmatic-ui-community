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
    // Borg 1.x and 2.x both return exit code 105 for lock errors
    if (exitCode === 105) return true;
    
    // Also check stderr for lock-related messages
    const lockPatterns = [
        'Failed to create/acquire the lock',
        'Lock held by',
        'Repository is already locked',
        'LockError',
        'LockTimeout',
        'lock.exclusive',
        'Another instance is already running'
    ];
    
    if (stderr) {
        for (const pattern of lockPatterns) {
            if (stderr.includes(pattern)) return true;
        }
    }
    
    return false;
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

            // Try to get actual encryption from borg info
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
                const { command, args } = getBorgCommand(borgVersion, 'info', {
                    repoPath: repo.path,
                    extraArgs: ['--json'],
                    remotePath: repo.hetzner_borg_version, // For Hetzner Storage Boxes
                });

                console.log(`📊 [Repos] Listing archives using Borg ${borgVersion} (${command})...`);

                try {
                    const result = await execa(command, args, {
                        env,
                        timeout: 10000,
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
                            extraArgs: ['--json'],
                            remotePath: repo.hetzner_borg_version, // For Hetzner Storage Boxes
                        });
                        const listResult = await execa(listCmd.command, listCmd.args, {
                            env,
                            timeout: 15000,
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
