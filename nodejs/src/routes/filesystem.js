const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

function isUnsafePathInput(p) {
    // Reject null bytes and obviously bad inputs
    return typeof p !== 'string' || p.length === 0 || p.includes('\0');
}

/**
 * Browse filesystem directories and files
 * GET /api/filesystem/browse?path=/home&mode=directories
 */
router.get('/browse', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const targetPath = req.query.path || '/';
        const selectMode = req.query.mode || 'directories'; // 'directories', 'files', 'both'

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
                entryStats = await fs.stat(fullPath);

                // Check if directory is a Borg repository
                if (entry.isDirectory()) {
                    const configFile = path.join(fullPath, 'config');
                    const dataDir = path.join(fullPath, 'data');
                    
                    if (await fs.pathExists(configFile) && await fs.pathExists(dataDir)) {
                        try {
                            const configContent = await fs.readFile(configFile, 'utf8');
                            isBorgRepo = configContent.includes('[repository]');
                        } catch (e) {
                            // Could not read config file - not a borg repo or inaccessible
                        }
                    }
                }
            } catch (e) {
                // Skip inaccessible entries but mark them
                isAccessible = false;
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

        // Check if it's a Borg repository
        if (stats.isDirectory()) {
            const configFile = path.join(absolutePath, 'config');
            const dataDir = path.join(absolutePath, 'data');

            if (await fs.pathExists(configFile) && await fs.pathExists(dataDir)) {
                try {
                    const configContent = await fs.readFile(configFile, 'utf8');
                    isBorgRepo = configContent.includes('[repository]');
                } catch (e) {
                    // Could not read config file
                }
            }
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

