const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const backupExecutor = require('../services/backup-executor');

/**
 * Get all currently running backups
 * GET /api/backups/running
 */
router.get('/running', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const runningBackups = backupExecutor.getRunningBackups();
        
        res.json({
            success: true,
            data: {
                running_backups: runningBackups,
                count: runningBackups.length
            }
        });
    } catch (error) {
        console.error('Failed to get running backups:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get status of a specific backup
 * GET /api/backups/:id/status
 */
router.get('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = backupExecutor.getBackupStatus(req.params.id);
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Failed to get backup status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Execute a backup manually
 * POST /api/backups/:id/run
 */
router.post('/:id/run', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const backupId = req.params.id;

        // Check if already running (prevent double-click)
        if (backupExecutor.isBackupRunning(backupId)) {
            return res.status(409).json({
                success: false,
                error: 'Backup is already running. Please wait for it to complete.'
            });
        }

        // Start backup asynchronously (don't wait for completion)
        backupExecutor.executeBackup(backupId)
            .then(result => {
                console.log(`Backup completed successfully: ${backupId}`);
            })
            .catch(error => {
                console.error(`Backup failed: ${backupId}`, error.message);
            });

        // Return immediate response
        res.json({
            success: true,
            message: 'Backup started successfully. Monitor progress via SSE events.',
            data: {
                backup_id: backupId,
                started_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Failed to start backup:', error);
        const status = error.message.includes('already running') ? 409 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Stop a running backup
 * POST /api/backups/:id/stop
 */
router.post('/:id/stop', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await backupExecutor.stopBackup(req.params.id);
        
        res.json({
            success: true,
            message: 'Backup stop signal sent'
        });
    } catch (error) {
        console.error('Failed to stop backup:', error);
        const status = error.message.includes('not running') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
