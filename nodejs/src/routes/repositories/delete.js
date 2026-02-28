const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const configParser = require('../../services/config-parser');
const { clearVersionCache } = require('../../services/borg-version-detector');
const { invalidateRepository: invalidateArchiveCache } = require('../../services/archive-cache');
const path = require('path');

router.delete('/by-path/:path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repoPath = decodeURIComponent(req.params.path);
        const { deleteOnDisk } = req.query; // Get query parameter
        const shouldDeleteOnDisk = deleteOnDisk === 'true';

        console.log(`🗑️  DELETE /api/repositories/by-path - Path: ${repoPath}, Delete on disk: ${shouldDeleteOnDisk}`);

        // Refresh config parser to get latest backup usage data
        await configParser.refresh();

        // Get all repositories to check if it's in use
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => path.normalize(r.path) === path.normalize(repoPath));

        if (!repo) {
            return res.status(404).json({ detail: 'Repository not found' });
        }

        // Check if repository is in use (unless we're deleting on disk, which forces deletion)
        if (!shouldDeleteOnDisk && repo.isUsed && repo.usedInBackups && repo.usedInBackups.length > 0) {
            return res.status(400).json({
                detail: `Cannot delete repository "${repo.label || repo.name}". It is used in the following backup(s): ${repo.usedInBackups.join(', ')}. Please delete those backups first.`
            });
        }

        // If force deleting and repo is in use, remove from backup configs first
        let backupCleanupResult = null;
        if (shouldDeleteOnDisk && repo.isUsed && repo.usedInBackups && repo.usedInBackups.length > 0) {
            console.log(`🧹 Force delete: Cleaning up backup configs that reference ${repoPath}`);
            backupCleanupResult = await configParser.removeRepositoryFromBackups(repoPath);

            if (backupCleanupResult.errors.length > 0) {
                console.warn('⚠️  Some backup configs could not be updated:', backupCleanupResult.errors);
            }
        }

        // Check if this is a Direct mode Rclone repository that needs unmounting
        const isDirectRclone = repo.repository_type === 'rclone' && repo.storage_mode === 'direct';
        let mountPath = null;
        let serviceName = null;
        let rcloneRemote = null;
        let rcloneRemotePath = null;

        if (isDirectRclone) {
            mountPath = repo.mount_path;
            rcloneRemote = repo.rclone_remote;
            rcloneRemotePath = repo.rclone_path;

            // Generate service name from repository ID (same pattern as creation)
            if (repo.id) {
                serviceName = `borgmatic-rclone-${repo.id.replace(/[^a-zA-Z0-9-]/g, '-')}`;
            } else {
                // Fallback: use repository name
                serviceName = `borgmatic-rclone-${(repo.name || repo.label || 'unknown').replace(/[^a-zA-Z0-9-]/g, '-')}`;
            }

            console.log(`🔌 Direct Rclone repository detected. Mount path: ${mountPath}, Service: ${serviceName}`);
        }

        // Repository is not in use (or force delete), remove from unused list
        const removed = await configParser.removeUnusedRepository(repoPath);

        if (removed) {
            // Also remove stored passphrase if exists
            try {
                await passwordManager.deleteRepositoryPassphrase(repoPath);
            } catch (err) {
                console.warn('⚠️  Failed to delete passphrase:', err.message);
            }

            // Clear version and archive caches for this repository
            try {
                clearVersionCache(repoPath);
                await invalidateArchiveCache(repoPath);
                console.log('🗑️ Cleared version and archive caches for repository');
            } catch (cacheErr) {
                console.warn('⚠️  Failed to clear caches:', cacheErr.message);
            }

            // Handle Direct Rclone repository unmounting and optional remote deletion
            if (isDirectRclone && mountPath && serviceName) {
                try {
                    // If deleteOnDisk is true, delete remote files first via RCD API
                    if (shouldDeleteOnDisk && rcloneRemote && rcloneRemotePath) {
                        console.log(`🗑️  Deleting remote files via RCD: ${rcloneRemote}:${rcloneRemotePath}`);

                        // Normalize + validate remote path (defense-in-depth)
                        const normalizedRemotePath = String(rcloneRemotePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
                        if (normalizedRemotePath.includes('..') || /[;&|`$()\\]/.test(normalizedRemotePath)) {
                            console.warn('⚠️  Skipping remote purge due to suspicious rclone path');
                        } else {
                            try {
                                // Use RCD API to purge remote files
                                const rcloneRCD = require('../../services/rclone-rcd');
                                await rcloneRCD.purge(rcloneRemote, normalizedRemotePath);
                                console.log(`✅ Remote files deleted successfully`);
                            } catch (rcloneError) {
                                console.error('❌ Failed to delete remote files:', rcloneError.message);
                                // Continue with unmounting even if remote deletion fails
                            }
                        }
                    }

                    // Unmount via RCD (mount is on HOST, not inside container)
                    console.log(`🔌 Unmounting Direct Rclone mount via RCD: ${mountPath}`);
                    try {
                        const rcloneRCD = require('../../services/rclone-rcd');
                        const isAvailable = await rcloneRCD.isAvailable();
                        if (!isAvailable) {
                            console.warn('⚠️  Rclone RCD not available; skipping unmount');
                        } else if (mountPath) {
                            const mounts = await rcloneRCD.listMounts();
                            const mounted = mounts.find(m => m.MountPoint === mountPath);
                            if (mounted) {
                                await rcloneRCD.unmount(mountPath);
                                console.log('✅ Unmounted successfully via RCD');
                            } else {
                                console.log('ℹ️  Mount not present in RCD list; nothing to unmount');
                            }
                        }
                    } catch (unmountError) {
                        console.error('❌ Failed to unmount via RCD:', unmountError.message);
                        // Continue with repository deletion even if unmount fails
                    }
                } catch (error) {
                    console.error('❌ Error handling Direct Rclone unmount:', error.message);
                    // Continue with repository deletion
                }
            }

            // Delete repository files on disk if requested (skip for Direct Rclone - files are on remote)
            if (shouldDeleteOnDisk && !isDirectRclone) {
                try {
                    const fs = require('fs-extra');
                    const repoDir = path.resolve(repoPath);

                    // Safety check: ensure it's not a system directory
                    const sensitivePatterns = [
                        /^\/etc\//, /^\/root\//, /^\/boot\//, /^\/sys\//, /^\/proc\//, /^\/dev\//,
                        /\/\.ssh\//, /\/\.gnupg\//, /^\/usr\//, /^\/bin\//, /^\/sbin\//
                    ];

                    for (const pattern of sensitivePatterns) {
                        if (pattern.test(repoDir)) {
                            return res.status(403).json({
                                detail: 'Cannot delete repository in system directories for security reasons'
                            });
                        }
                    }

                    // Check if directory exists and is a Borg repository
                    if (await fs.pathExists(repoDir)) {
                        // Check if it's actually a Borg repo (has README or config file)
                        const readmePath = path.join(repoDir, 'README');
                        const configPath = path.join(repoDir, 'config');

                        if (await fs.pathExists(readmePath) || await fs.pathExists(configPath)) {
                            console.log(`🗑️  Deleting repository directory: ${repoDir}`);
                            await fs.remove(repoDir);
                            console.log(`✅ Repository directory deleted successfully`);
                        } else {
                            console.warn(`⚠️  Directory ${repoDir} does not appear to be a Borg repository, skipping deletion`);
                        }
                    }
                } catch (diskError) {
                    console.error('❌ Failed to delete repository on disk:', diskError.message);
                    // Don't fail the whole operation if disk deletion fails
                    return res.status(500).json({
                        detail: `Repository removed from configuration but failed to delete on disk: ${diskError.message}`
                    });
                }
            }

            // Build success message
            let message = 'Repository deleted successfully';
            const parts = [];

            if (isDirectRclone) {
                parts.push('mount unmounted');
            }

            if (shouldDeleteOnDisk) {
                if (isDirectRclone) {
                    parts.push('remote files deleted');
                } else {
                    parts.push('files removed');
                }
            } else {
                parts.push('configuration removed');
                if (!isDirectRclone) {
                    parts.push('files remain on disk');
                }
            }

            // Add backup cleanup info
            if (backupCleanupResult) {
                if (backupCleanupResult.deletedBackups.length > 0) {
                    parts.push(`${backupCleanupResult.deletedBackups.length} backup(s) deleted`);
                }
                if (backupCleanupResult.affectedBackups.length > 0) {
                    parts.push(`removed from ${backupCleanupResult.affectedBackups.length} backup(s)`);
                }
            }

            if (parts.length > 0) {
                message += ` (${parts.join(', ')})`;
            }

            // Refresh config parser cache after deletion
            await configParser.refresh();

            res.json({
                success: true,
                message: message,
                backup_cleanup: backupCleanupResult || undefined
            });
        } else {
            res.status(404).json({ detail: 'Repository not found in unused list' });
        }
    } catch (error) {
        console.error('Failed to delete repository:', error.message);
        res.status(500).json({ detail: 'Failed to delete repository' });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repositories = await configParser.getAllRepositoriesWithUsage();
        const repoIndex = parseInt(req.params.id) - 1;

        if (repoIndex < 0 || repoIndex >= repositories.length) {
            return res.status(404).json({ detail: 'Repository not found' });
        }

        const repo = repositories[repoIndex];

        // Check if repository is in use
        if (repo.isUsed && repo.usedInBackups && repo.usedInBackups.length > 0) {
            return res.status(400).json({
                detail: `Cannot delete repository "${repo.label || repo.name}". It is used in the following backup(s): ${repo.usedInBackups.join(', ')}. Please delete those backups first.`
            });
        }

        // Repository is not in use, remove from unused list
        const removed = await configParser.removeUnusedRepository(repo.path);

        if (!removed) {
            return res.status(404).json({ detail: 'Repository not found in unused list' });
        }

        // Refresh config parser cache after deletion
        await configParser.refresh();

        res.json({
            success: true,
            message: 'Repository deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete repository:', error.message);
        res.status(500).json({ detail: 'Failed to delete repository' });
    }
});

module.exports = router;
