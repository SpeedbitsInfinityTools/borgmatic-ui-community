const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const backupManager = require('../services/backup-manager');
const retentionManager = require('../services/retention-manager');

/**
 * Get all backup configurations
 * GET /api/backups
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const backups = await backupManager.getAllBackups();

        res.json({
            success: true,
            data: {
                backups
            }
        });
    } catch (error) {
        console.error('Failed to get backups:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get a specific backup configuration
 * GET /api/backups/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const backup = await backupManager.getBackup(req.params.id);

        res.json({
            success: true,
            data: backup
        });
    } catch (error) {
        console.error('Failed to get backup:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create a new backup configuration
 * POST /api/backups
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const backupData = req.body;

        // Validate required fields
        if (!backupData.name) {
            return res.status(400).json({
                success: false,
                error: 'Backup name is required'
            });
        }

        if (!backupData.sources || backupData.sources.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one source is required'
            });
        }

        if (!backupData.repositories || backupData.repositories.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one repository is required'
            });
        }

        if (!backupData.retention_profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Retention profile is required'
            });
        }

        const backup = await backupManager.createBackup(backupData);

        res.status(201).json({
            success: true,
            message: 'Backup configuration created successfully',
            data: backup
        });
    } catch (error) {
        console.error('Failed to create backup:', error);
        const status = error.message.includes('already exists') ? 409 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Update a backup configuration
 * PUT /api/backups/:id
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const backup = await backupManager.updateBackup(req.params.id, req.body);

        res.json({
            success: true,
            message: 'Backup configuration updated successfully',
            data: backup
        });
    } catch (error) {
        console.error('Failed to update backup:', error);
        const status = error.message.includes('not found') ? 404 :
            error.message.includes('already exists') ? 409 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Delete a backup configuration
 * DELETE /api/backups/:id
 * Also accepts ?filename=xxx for discovered backups
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const backupId = req.params.id;
        const filename = req.query.filename;
        
        await backupManager.deleteBackup(backupId, filename);

        res.json({
            success: true,
            message: 'Backup configuration deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete backup:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Toggle backup active status
 * PATCH /api/backups/:id/toggle
 */
router.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'is_active must be a boolean'
            });
        }

        const backup = await backupManager.toggleBackupStatus(req.params.id, is_active);

        res.json({
            success: true,
            message: `Backup ${is_active ? 'activated' : 'deactivated'} successfully`,
            data: backup
        });
    } catch (error) {
        console.error('Failed to toggle backup status:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get all retention profiles
 * GET /api/backups/retention-profiles
 */
router.get('/retention/profiles', authenticateToken, async (req, res) => {
    try {
        const profiles = await retentionManager.getProfiles();

        res.json({
            success: true,
            data: profiles
        });
    } catch (error) {
        console.error('Failed to get retention profiles:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create a custom retention profile
 * POST /api/backups/retention/profiles
 */
router.post('/retention/profiles', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const profile = await retentionManager.createCustomProfile(req.body);

        res.status(201).json({
            success: true,
            message: 'Custom retention profile created successfully',
            data: profile
        });
    } catch (error) {
        console.error('Failed to create retention profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Delete a custom retention profile
 * DELETE /api/backups/retention/profiles/:id
 */
router.delete('/retention/profiles/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await retentionManager.deleteCustomProfile(req.params.id);

        res.json({
            success: true,
            message: 'Custom retention profile deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete retention profile:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Export a backup configuration as a template
 * GET /api/backups/:id/export-template
 */
router.get('/:id/export-template', authenticateToken, async (req, res) => {
    try {
        const backup = await backupManager.getBackup(req.params.id);

        if (!backup) {
            return res.status(404).json({
                success: false,
                error: 'Backup not found'
            });
        }

        // Create template from backup (remove client-specific data)
        const template = {
            name: `${backup.name} (Template)`,
            description: backup.description || `Template created from backup: ${backup.name}`,
            type: 'backup',
            sources: (backup.sources || []).map(source => ({
                type: source.type,
                path: source.path,
                database_type: source.database_type,
                database_name: source.database_name,
                host: source.host,
                port: source.port,
                username: source.username,
                // Don't include passwords/credentials
                exclude_patterns: source.exclude_patterns || [],
            })),
            repositories: (backup.repositories || []).map(repo => ({
                path: repo.path,
                // Don't include credentials
            })),
            retention: backup.retention ? {
                keep_hourly: backup.retention.keep_hourly,
                keep_daily: backup.retention.keep_daily,
                keep_weekly: backup.retention.keep_weekly,
                keep_monthly: backup.retention.keep_monthly,
                keep_yearly: backup.retention.keep_yearly,
            } : {
                keep_daily: 7,
                keep_weekly: 4,
                keep_monthly: 6,
            },
            schedule: backup.schedule || '0 2 * * *', // Default schedule
            compression: backup.compression || 'zstd',
            encryption: backup.encryption || 'repokey',
            hooks: backup.hooks || {},
            auto_discover_databases: false, // User can enable in template
        };

        // Set filename for download
        const filename = `${backup.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.json`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(template);
    } catch (error) {
        console.error('Failed to export backup as template:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get YAML content for a backup
 * GET /api/backups/:id/yaml
 */
router.get('/:id/yaml', authenticateToken, async (req, res) => {
    try {
        const yamlContent = await backupManager.getBackupYaml(req.params.id);

        res.json({
            success: true,
            data: {
                yaml: yamlContent
            }
        });
    } catch (error) {
        console.error('Failed to get backup YAML:', error);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Report canary file failure (called from pre-backup hook)
 * This endpoint does NOT require authentication since it's called from bash scripts
 * POST /api/backups/canary-alert
 */
router.post('/canary-alert', async (req, res) => {
    try {
        const { reason, file_path, backup_name } = req.body;

        console.error('🚨 CANARY ALERT RECEIVED:', { reason, file_path, backup_name });

        const reasonText = reason === 'DELETED' ? 'was deleted' :
            reason === 'MODIFIED' ? 'was modified' :
                reason === 'MISSING' ? 'is missing' : 'was compromised';

        // Try to send security alert via Apprise (gracefully handle if not installed)
        let notificationResult = { success: false, message: 'Apprise service not available' };

        try {
            const appriseService = require('../services/apprise');
            notificationResult = await appriseService.sendSecurityAlert({
                title: '🚨 SECURITY ALERT: Canary File Compromised',
                body: `URGENT: Canary file ${reasonText}${file_path ? ` (${file_path})` : ''}. ` +
                    `${backup_name ? `Backup "${backup_name}" has been stopped. ` : 'Backup has been stopped. '}` +
                    `This may indicate ransomware or unauthorized access. INVESTIGATE IMMEDIATELY!`
            });

            if (notificationResult.apprise_not_installed) {
                console.warn('⚠️ Apprise not installed - canary alert logged but no notification sent');
            }
        } catch (appriseError) {
            console.warn('⚠️ Could not send Apprise notification:', appriseError.message);
            notificationResult = { success: false, error: appriseError.message };
        }

        res.json({
            success: true,
            notification_sent: notificationResult.success,
            apprise_installed: !notificationResult.apprise_not_installed,
            message: notificationResult.success
                ? 'Security alert sent'
                : notificationResult.apprise_not_installed
                    ? 'Alert logged but Apprise not installed - no notification sent'
                    : 'Alert logged but notification failed'
        });
    } catch (error) {
        console.error('Failed to process canary alert:', error);
        // Still return success - we don't want to block the bash script
        res.json({
            success: true,
            notification_sent: false,
            error: error.message
        });
    }
});

/**
 * Get the hash file path for a canary file.
 * Hash files are stored in /app/data/canary-hashes/ to avoid permission issues
 * on mounted host filesystems (e.g., /host/opt/speedbits).
 */
function getCanaryHashPath(canaryFilePath) {
    const path = require('path');
    const config = require('../config');
    
    // Create a safe filename from the canary path
    // e.g., /host/opt/speedbits/file.txt -> host_opt_speedbits_file.txt.hash
    const safeName = canaryFilePath.replace(/^\//, '').replace(/\//g, '_') + '.hash';
    const hashDir = path.join(config.dataDir, 'canary-hashes');
    return path.join(hashDir, safeName);
}

/**
 * Initialize hash for an existing canary file (for user-selected files)
 * POST /api/backups/canary-file/init-hash
 */
router.post('/canary-file/init-hash', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { file_path } = req.body;
        const fs = require('fs-extra');
        const crypto = require('crypto');
        const path = require('path');

        if (!file_path) {
            return res.status(400).json({
                success: false,
                error: 'File path is required'
            });
        }

        // Check if file exists
        if (!await fs.pathExists(file_path)) {
            return res.status(404).json({
                success: false,
                error: `File not found: ${file_path}`
            });
        }

        // Read and hash the file
        const content = await fs.readFile(file_path);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const stats = await fs.stat(file_path);

        // Save hash to app data directory (writable)
        const hashFile = getCanaryHashPath(file_path);
        await fs.ensureDir(path.dirname(hashFile));
        await fs.writeFile(hashFile, hash);

        console.log(`✅ Initialized canary hash for: ${file_path}`);
        console.log(`   Hash stored at: ${hashFile}`);

        res.json({
            success: true,
            data: {
                file_path,
                hash_file: hashFile,
                size: stats.size,
                hash
            }
        });
    } catch (error) {
        console.error('Failed to initialize canary hash:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create a canary file for ransomware detection
 * POST /api/backups/canary-file/create
 */
router.post('/canary-file/create', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { file_path } = req.body;

        if (!file_path) {
            return res.status(400).json({
                success: false,
                error: 'File path is required'
            });
        }

        const fs = require('fs-extra');
        const path = require('path');
        const crypto = require('crypto');

        // Generate random content (100KB - 500KB)
        const size = 100 * 1024 + Math.floor(Math.random() * 400 * 1024);
        const content = crypto.randomBytes(size);

        // Ensure parent directory exists
        const parentDir = path.dirname(file_path);
        await fs.ensureDir(parentDir);

        // Check if we can write to the directory
        try {
            await fs.access(parentDir, fs.constants.W_OK);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: `Cannot write to directory: ${parentDir}. Please check permissions.`
            });
        }

        // Write the canary file
        await fs.writeFile(file_path, content);

        // Calculate the hash (for verification)
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        // Save hash to app data directory (writable) instead of next to canary file
        const hashFile = getCanaryHashPath(file_path);
        await fs.ensureDir(path.dirname(hashFile));
        await fs.writeFile(hashFile, hash);

        console.log(`✅ Created canary file: ${file_path} (${size} bytes)`);
        console.log(`✅ Saved canary hash: ${hashFile}`);

        res.json({
            success: true,
            data: {
                file_path,
                hash_file: hashFile,
                size,
                hash
            }
        });
    } catch (error) {
        console.error('Failed to create canary file:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
