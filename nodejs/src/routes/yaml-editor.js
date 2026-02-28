const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * List all available YAML files that can be edited
 * GET /api/yaml-editor/files
 */
router.get('/files', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const backupConfigsDir = path.join(config.configDir, 'borgmatic.d');
        const files = [];

        // Get all YAML files from borgmatic.d/
        if (await fs.pathExists(backupConfigsDir)) {
            const dirFiles = await fs.readdir(backupConfigsDir);
            
            for (const file of dirFiles) {
                if (file.endsWith('.yaml') || file.endsWith('.yml')) {
                    const filePath = path.join(backupConfigsDir, file);
                    const stats = await fs.stat(filePath);
                    
                    // Try to read the name from the file
                    try {
                        const content = await fs.readFile(filePath, 'utf8');
                        const parsed = yaml.load(content);
                        const name = file.replace(/\.ya?ml$/, '');
                        
                        files.push({
                            filename: file,
                            path: `borgmatic.d/${file}`,
                            displayName: name,
                            size: stats.size,
                            modified: stats.mtime,
                            type: 'backup'
                        });
                    } catch (error) {
                        // If parsing fails, still include the file
                        files.push({
                            filename: file,
                            path: `borgmatic.d/${file}`,
                            displayName: file.replace(/\.ya?ml$/, ''),
                            size: stats.size,
                            modified: stats.mtime,
                            type: 'backup',
                            parseError: true
                        });
                    }
                }
            }
        }

        // Sort by modified date (newest first)
        files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

        res.json({
            success: true,
            data: {
                files,
                count: files.length
            }
        });
    } catch (error) {
        console.error('Failed to list YAML files:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get content of a specific YAML file
 * GET /api/yaml-editor/file/:filename
 */
router.get('/file/:filename', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { filename } = req.params;
        
        // Security: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        const filePath = path.join(config.configDir, 'borgmatic.d', filename);

        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        const content = await fs.readFile(filePath, 'utf8');
        const stats = await fs.stat(filePath);

        res.json({
            success: true,
            data: {
                filename,
                content,
                size: stats.size,
                modified: stats.mtime
            }
        });
    } catch (error) {
        console.error('Failed to read YAML file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read configuration file'
        });
    }
});

/**
 * Validate YAML content (without saving)
 * POST /api/yaml-editor/validate
 */
router.post('/validate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { content, filename } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                error: 'No content provided'
            });
        }

        // Create a temporary file for validation
        const tempFile = path.join(config.configDir, `.temp-validate-${Date.now()}.yaml`);
        
        try {
            // Write content to temp file
            await fs.writeFile(tempFile, content, 'utf8');

            // Validate using borgmatic
            const { stdout, stderr } = await execAsync(
                `borgmatic --config "${tempFile}" config validate`,
                { timeout: 10000 }
            );

            // If we get here, validation passed
            await fs.remove(tempFile);

            res.json({
                success: true,
                data: {
                    valid: true,
                    message: 'Configuration is valid',
                    output: stdout || 'No validation output'
                }
            });

        } catch (error) {
            // Clean up temp file
            await fs.remove(tempFile).catch(() => {});

            // Parse validation error
            const errorOutput = error.stderr || error.stdout || error.message;

            res.json({
                success: false,
                data: {
                    valid: false,
                    errors: [errorOutput],
                    message: 'Configuration validation failed'
                }
            });
        }

    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Save YAML file (creates backup automatically)
 * POST /api/yaml-editor/file/:filename
 */
router.post('/file/:filename', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { filename } = req.params;
        const { content } = req.body;

        // Security: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        if (!content) {
            return res.status(400).json({
                success: false,
                error: 'No content provided'
            });
        }

        const filePath = path.join(config.configDir, 'borgmatic.d', filename);
        const backupDir = path.join(config.configDir, 'backups');

        // Ensure backup directory exists
        await fs.ensureDir(backupDir);

        // Create backup of existing file (if it exists)
        if (await fs.pathExists(filePath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `${filename}.backup-${timestamp}`;
            const backupPath = path.join(backupDir, backupName);

            await fs.copy(filePath, backupPath);
            console.log(`📦 Created backup: ${backupName}`);

            // Keep only last 3 backups for this file
            const backups = await fs.readdir(backupDir);
            const fileBackups = backups
                .filter(b => b.startsWith(filename + '.backup-'))
                .sort()
                .reverse();

            // Delete old backups (keep only 3)
            for (let i = 3; i < fileBackups.length; i++) {
                await fs.remove(path.join(backupDir, fileBackups[i]));
                console.log(`🗑️  Removed old backup: ${fileBackups[i]}`);
            }
        }

        // Save new content
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`💾 Saved: ${filename}`);

        res.json({
            success: true,
            message: 'File saved successfully',
            data: {
                filename,
                saved_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Failed to save YAML file:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get backups for a specific file
 * GET /api/yaml-editor/file/:filename/backups
 */
router.get('/file/:filename/backups', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { filename } = req.params;

        // Security: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        const backupDir = path.join(config.configDir, 'backups');

        if (!await fs.pathExists(backupDir)) {
            return res.json({
                success: true,
                data: { backups: [] }
            });
        }

        const allBackups = await fs.readdir(backupDir);
        const fileBackups = [];

        for (const backup of allBackups) {
            if (backup.startsWith(filename + '.backup-')) {
                const backupPath = path.join(backupDir, backup);
                const stats = await fs.stat(backupPath);

                fileBackups.push({
                    name: backup,
                    filename: backup,
                    timestamp: stats.mtime,
                    size: stats.size
                });
            }
        }

        // Sort by timestamp (newest first)
        fileBackups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.json({
            success: true,
            data: { backups: fileBackups }
        });

    } catch (error) {
        console.error('Failed to list backups:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Restore from a backup
 * POST /api/yaml-editor/file/:filename/restore
 */
router.post('/file/:filename/restore', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { filename } = req.params;
        const { backupName } = req.body;

        // Security: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\') ||
            backupName.includes('..') || backupName.includes('/') || backupName.includes('\\')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        const filePath = path.join(config.configDir, 'borgmatic.d', filename);
        const backupPath = path.join(config.configDir, 'backups', backupName);

        if (!await fs.pathExists(backupPath)) {
            return res.status(404).json({
                success: false,
                error: 'Backup not found'
            });
        }

        // Read backup content
        const backupContent = await fs.readFile(backupPath, 'utf8');

        res.json({
            success: true,
            message: 'Backup content retrieved successfully',
            data: {
                content: backupContent,
                backupName
            }
        });

    } catch (error) {
        console.error('Failed to restore from backup:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
