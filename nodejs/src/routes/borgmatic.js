const express = require('express');
const router = express.Router();
const borgmaticCLI = require('../services/borgmatic-cli');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Repository Management Routes
 */

/**
 * Create a new repository
 */
router.post('/repository/create', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, encryption = 'repokey-blake2', options = {} } = req.body;
        
        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.createRepository(repositoryPath, encryption, options);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Repository created successfully',
                repositoryPath,
                encryption,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to create repository',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to create repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to create repository',
            error: error.message 
        });
    }
});

/**
 * Delete a repository
 */
router.delete('/repository/:path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        const { force = false, cacheOnly = false, keepSecurityInfo = false } = req.body;

        const result = await borgmaticCLI.deleteRepository(decodedPath, {
            force,
            cacheOnly,
            keepSecurityInfo
        });

        if (result.success) {
            res.json({
                success: true,
                message: 'Repository deleted successfully',
                repositoryPath: decodedPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete repository',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to delete repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to delete repository',
            error: error.message 
        });
    }
});

/**
 * List repository contents
 */
router.get('/repository/:path/list', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        const { json = true } = req.query;

        const result = await borgmaticCLI.listRepository(decodedPath, { json: json === 'true' });

        if (result.success) {
            res.json({
                success: true,
                repositoryPath: decodedPath,
                data: json === 'true' ? (() => {
                    try {
                        return JSON.parse(result.stdout);
                    } catch (e) {
                        return result.stdout;
                    }
                })() : result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to list repository',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to list repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to list repository',
            error: error.message 
        });
    }
});

/**
 * Get repository information
 */
router.get('/repository/:path/info', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        const { json = true } = req.query;

        const result = await borgmaticCLI.getRepositoryInfo(decodedPath, { json: json === 'true' });

        if (result.success) {
            res.json({
                success: true,
                repositoryPath: decodedPath,
                data: json === 'true' ? (() => {
                    try {
                        return JSON.parse(result.stdout);
                    } catch (e) {
                        return result.stdout;
                    }
                })() : result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get repository info',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to get repository info:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get repository info',
            error: error.message 
        });
    }
});

/**
 * Check repository consistency
 */
router.post('/repository/:path/check', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        const { repair = false, maxDuration, only, force = false } = req.body;

        const result = await borgmaticCLI.checkRepository(decodedPath, {
            repair,
            maxDuration,
            only,
            force
        });

        if (result.success) {
            res.json({
                success: true,
                message: 'Repository check completed',
                repositoryPath: decodedPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Repository check failed',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to check repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to check repository',
            error: error.message 
        });
    }
});

/**
 * Archive Management Routes
 */

/**
 * Create archive (backup)
 */
router.post('/archive/create', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, options = {} } = req.body;
        
        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.createArchive(repositoryPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive created successfully',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to create archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to create archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to create archive',
            error: error.message 
        });
    }
});

/**
 * List archives
 */
router.get('/archive/list', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archive, path, find, short, format, json = true, prefix, pattern, sortBy, first, last, exclude } = req.query;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.listArchives(repositoryPath, {
            archive,
            path,
            find,
            short: short === 'true',
            format,
            json: json === 'true',
            prefix,
            pattern,
            sortBy,
            first: first ? parseInt(first) : undefined,
            last: last ? parseInt(last) : undefined,
            exclude
        });

        if (result.success) {
            res.json({
                success: true,
                repositoryPath,
                data: json === 'true' ? (() => {
                    try {
                        return JSON.parse(result.stdout);
                    } catch (e) {
                        return result.stdout;
                    }
                })() : result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to list archives',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to list archives:', error.message);
        res.status(500).json({ 
            detail: 'Failed to list archives',
            error: error.message 
        });
    }
});

/**
 * Get archive information
 */
router.get('/archive/info', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, json = true, prefix, pattern, sortBy, first, last } = req.query;

        if (!repositoryPath || !archiveName) {
            return res.status(400).json({ 
                detail: 'Repository path and archive name are required' 
            });
        }

        const result = await borgmaticCLI.getArchiveInfo(repositoryPath, archiveName, {
            json: json === 'true',
            prefix,
            pattern,
            sortBy,
            first: first ? parseInt(first) : undefined,
            last: last ? parseInt(last) : undefined
        });

        if (result.success) {
            res.json({
                success: true,
                repositoryPath,
                archiveName,
                data: json === 'true' ? (() => {
                    try {
                        return JSON.parse(result.stdout);
                    } catch (e) {
                        return result.stdout;
                    }
                })() : result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get archive info',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to get archive info:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get archive info',
            error: error.message 
        });
    }
});

/**
 * Delete archive
 */
router.delete('/archive/delete', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, options = {} } = req.body;

        if (!repositoryPath || !archiveName) {
            return res.status(400).json({ 
                detail: 'Repository path and archive name are required' 
            });
        }

        const result = await borgmaticCLI.deleteArchive(repositoryPath, archiveName, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive deleted successfully',
                repositoryPath,
                archiveName,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to delete archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to delete archive',
            error: error.message 
        });
    }
});

/**
 * Extract archive
 */
router.post('/archive/extract', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, destinationPath, options = {} } = req.body;

        if (!repositoryPath || !archiveName || !destinationPath) {
            return res.status(400).json({ 
                detail: 'Repository path, archive name, and destination path are required' 
            });
        }

        const result = await borgmaticCLI.extractArchive(repositoryPath, archiveName, destinationPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive extracted successfully',
                repositoryPath,
                archiveName,
                destinationPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to extract archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to extract archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to extract archive',
            error: error.message 
        });
    }
});

/**
 * Mount archive
 */
router.post('/archive/mount', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, mountPoint, options = {} } = req.body;

        if (!repositoryPath || !mountPoint) {
            return res.status(400).json({ 
                detail: 'Repository path and mount point are required' 
            });
        }

        const result = await borgmaticCLI.mountArchive(repositoryPath, mountPoint, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive mounted successfully',
                repositoryPath,
                mountPoint,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to mount archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to mount archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to mount archive',
            error: error.message 
        });
    }
});

/**
 * Unmount archive
 */
router.post('/archive/unmount', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { mountPoint } = req.body;

        if (!mountPoint) {
            return res.status(400).json({ 
                detail: 'Mount point is required' 
            });
        }

        const result = await borgmaticCLI.unmountArchive(mountPoint);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive unmounted successfully',
                mountPoint,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to unmount archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to unmount archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to unmount archive',
            error: error.message 
        });
    }
});

/**
 * Key Management Routes
 */

/**
 * Export repository key
 */
router.post('/key/export', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, keyPath, options = {} } = req.body;

        if (!repositoryPath || !keyPath) {
            return res.status(400).json({ 
                detail: 'Repository path and key path are required' 
            });
        }

        const result = await borgmaticCLI.exportKey(repositoryPath, keyPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Key exported successfully',
                repositoryPath,
                keyPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to export key',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to export key:', error.message);
        res.status(500).json({ 
            detail: 'Failed to export key',
            error: error.message 
        });
    }
});

/**
 * Import repository key
 */
router.post('/key/import', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, keyPath, options = {} } = req.body;

        if (!repositoryPath || !keyPath) {
            return res.status(400).json({ 
                detail: 'Repository path and key path are required' 
            });
        }

        const result = await borgmaticCLI.importKey(repositoryPath, keyPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Key imported successfully',
                repositoryPath,
                keyPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to import key',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to import key:', error.message);
        res.status(500).json({ 
            detail: 'Failed to import key',
            error: error.message 
        });
    }
});

/**
 * Change key passphrase
 */
router.post('/key/change-passphrase', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath } = req.body;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.changeKeyPassphrase(repositoryPath);

        if (result.success) {
            res.json({
                success: true,
                message: 'Key passphrase changed successfully',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to change key passphrase',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to change key passphrase:', error.message);
        res.status(500).json({ 
            detail: 'Failed to change key passphrase',
            error: error.message 
        });
    }
});

/**
 * Utility Routes
 */

/**
 * Break repository locks
 */
router.post('/break-lock', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath } = req.body;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.breakLock(repositoryPath);

        if (result.success) {
            res.json({
                success: true,
                message: 'Repository locks broken successfully',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to break repository locks',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to break repository locks:', error.message);
        res.status(500).json({ 
            detail: 'Failed to break repository locks',
            error: error.message 
        });
    }
});

/**
 * Get borgmatic version
 */
router.get('/version', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await borgmaticCLI.getVersion();

        if (result.success) {
            res.json({
                success: true,
                version: result.stdout,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get borgmatic version',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to get borgmatic version:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get borgmatic version',
            error: error.message 
        });
    }
});

/**
 * Check archives for consistency
 */
router.post('/archive/check', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, options = {} } = req.body;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.checkArchives(repositoryPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive check completed',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Archive check failed',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to check archives:', error.message);
        res.status(500).json({ 
            detail: 'Failed to check archives',
            error: error.message 
        });
    }
});

/**
 * Prune archives according to retention policy
 */
router.post('/archive/prune', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, options = {} } = req.body;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.pruneArchives(repositoryPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archives pruned successfully',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to prune archives',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to prune archives:', error.message);
        res.status(500).json({ 
            detail: 'Failed to prune archives',
            error: error.message 
        });
    }
});

/**
 * Compact repository to free space
 */
router.post('/archive/compact', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, options = {} } = req.body;

        if (!repositoryPath) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        const result = await borgmaticCLI.compactRepository(repositoryPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Repository compacted successfully',
                repositoryPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to compact repository',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to compact repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to compact repository',
            error: error.message 
        });
    }
});

/**
 * Transfer archives between repositories
 */
router.post('/archive/transfer', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { sourceRepository, destinationRepository, options = {} } = req.body;

        if (!sourceRepository || !destinationRepository) {
            return res.status(400).json({ 
                detail: 'Source and destination repository paths are required' 
            });
        }

        const result = await borgmaticCLI.transferArchives(sourceRepository, destinationRepository, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archives transferred successfully',
                sourceRepository,
                destinationRepository,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to transfer archives',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to transfer archives:', error.message);
        res.status(500).json({ 
            detail: 'Failed to transfer archives',
            error: error.message 
        });
    }
});

/**
 * Export archive as tar file
 */
router.post('/archive/export-tar', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, destinationPath, options = {} } = req.body;

        if (!repositoryPath || !archiveName || !destinationPath) {
            return res.status(400).json({ 
                detail: 'Repository path, archive name, and destination path are required' 
            });
        }

        const result = await borgmaticCLI.exportTar(repositoryPath, archiveName, destinationPath, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive exported as tar successfully',
                repositoryPath,
                archiveName,
                destinationPath,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to export archive as tar',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to export archive as tar:', error.message);
        res.status(500).json({ 
            detail: 'Failed to export archive as tar',
            error: error.message 
        });
    }
});

/**
 * Restore data source dumps from archive
 */
router.post('/archive/restore', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, options = {} } = req.body;

        if (!repositoryPath || !archiveName) {
            return res.status(400).json({ 
                detail: 'Repository path and archive name are required' 
            });
        }

        const result = await borgmaticCLI.restoreData(repositoryPath, archiveName, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Data restored successfully',
                repositoryPath,
                archiveName,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to restore data',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to restore data:', error.message);
        res.status(500).json({ 
            detail: 'Failed to restore data',
            error: error.message 
        });
    }
});

/**
 * Recreate archive
 */
router.post('/archive/recreate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, archiveName, options = {} } = req.body;

        if (!repositoryPath || !archiveName) {
            return res.status(400).json({ 
                detail: 'Repository path and archive name are required' 
            });
        }

        const result = await borgmaticCLI.recreateArchive(repositoryPath, archiveName, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Archive recreated successfully',
                repositoryPath,
                archiveName,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to recreate archive',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to recreate archive:', error.message);
        res.status(500).json({ 
            detail: 'Failed to recreate archive',
            error: error.message 
        });
    }
});

/**
 * Run arbitrary Borg commands
 */
router.post('/borg/run', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repositoryPath, borgCommand, options = {} } = req.body;

        if (!repositoryPath || !borgCommand) {
            return res.status(400).json({ 
                detail: 'Repository path and borg command are required' 
            });
        }

        const result = await borgmaticCLI.runBorgCommand(repositoryPath, borgCommand, options);

        if (result.success) {
            res.json({
                success: true,
                message: 'Borg command executed successfully',
                repositoryPath,
                borgCommand,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to execute borg command',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to execute borg command:', error.message);
        res.status(500).json({ 
            detail: 'Failed to execute borg command',
            error: error.message 
        });
    }
});

/**
 * Configuration management
 */
router.post('/config/:action', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { action } = req.params;
        const { options = {} } = req.body;

        if (!['bootstrap', 'generate', 'validate'].includes(action)) {
            return res.status(400).json({ 
                detail: 'Invalid config action. Must be bootstrap, generate, or validate' 
            });
        }

        const result = await borgmaticCLI.configCommand(action, options);

        if (result.success) {
            res.json({
                success: true,
                message: `Config ${action} completed successfully`,
                action,
                output: result.stdout
            });
        } else {
            res.status(500).json({
                success: false,
                message: `Failed to ${action} config`,
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to execute config command:', error.message);
        res.status(500).json({ 
            detail: 'Failed to execute config command',
            error: error.message 
        });
    }
});

/**
 * Get borgmatic help
 */
router.get('/help', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { command } = req.query;
        const result = await borgmaticCLI.getHelp(command);

        if (result.success) {
            res.json({
                success: true,
                help: result.stdout,
                command: command || 'general'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get borgmatic help',
                error: result.error,
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to get borgmatic help:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get borgmatic help',
            error: error.message 
        });
    }
});

module.exports = router;
