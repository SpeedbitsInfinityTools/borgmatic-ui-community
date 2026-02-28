const express = require('express');
const router = express.Router();
const borgmaticConfig = require('../services/borgmatic-config');
const appriseService = require('../services/apprise');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get borgmatic configuration
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const config = await borgmaticConfig.loadConfig();
        res.json(config);
    } catch (error) {
        console.error('Failed to get config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load configuration',
            error: error.message 
        });
    }
});

/**
 * Get current configuration (alias for root)
 */
router.get('/current', authenticateToken, async (req, res) => {
    try {
        const fs = require('fs-extra');
        const configPath = require('../config').borgmaticConfigPath;
        
        // Read the raw YAML file as text
        const rawYaml = await fs.readFile(configPath, 'utf8');
        
        res.json({ content: rawYaml });
    } catch (error) {
        console.error('Failed to get current config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load current configuration',
            error: error.message 
        });
    }
});

/**
 * Save borgmatic configuration
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { config } = req.body;
        
        if (!config) {
            return res.status(400).json({ 
                detail: 'Configuration data is required' 
            });
        }

        await borgmaticConfig.saveConfig(config);
        res.json({ 
            success: true, 
            message: 'Configuration saved successfully' 
        });
    } catch (error) {
        console.error('Failed to save config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to save configuration',
            error: error.message 
        });
    }
});

/**
 * Get configuration summary
 */
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const summary = await borgmaticConfig.getConfigSummary();
        res.json(summary);
    } catch (error) {
        console.error('Failed to get config summary:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get configuration summary',
            error: error.message 
        });
    }
});

/**
 * Validate configuration
 */
router.post('/validate', authenticateToken, async (req, res) => {
    try {
        const validation = await borgmaticConfig.validateConfig();
        res.json(validation);
    } catch (error) {
        console.error('Failed to validate config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to validate configuration',
            error: error.message 
        });
    }
});

/**
 * Add repository
 */
router.post('/repositories', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path, encryption, label, append_only, storage_quota } = req.body;
        
        if (!path) {
            return res.status(400).json({ 
                detail: 'Repository path is required' 
            });
        }

        await borgmaticConfig.addRepository({
            path,
            encryption,
            label,
            append_only,
            storage_quota
        });

        res.json({ 
            success: true, 
            message: 'Repository added successfully' 
        });
    } catch (error) {
        console.error('Failed to add repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to add repository',
            error: error.message 
        });
    }
});

/**
 * Remove repository
 */
router.delete('/repositories/:path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        
        const removed = await borgmaticConfig.removeRepository(decodedPath);
        
        if (!removed) {
            return res.status(404).json({ 
                detail: 'Repository not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Repository removed successfully' 
        });
    } catch (error) {
        console.error('Failed to remove repository:', error.message);
        res.status(500).json({ 
            detail: 'Failed to remove repository',
            error: error.message 
        });
    }
});

/**
 * Add source directory
 */
router.post('/source-directories', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { directory } = req.body;
        
        if (!directory) {
            return res.status(400).json({ 
                detail: 'Directory path is required' 
            });
        }

        await borgmaticConfig.addSourceDirectory(directory);
        res.json({ 
            success: true, 
            message: 'Source directory added successfully' 
        });
    } catch (error) {
        console.error('Failed to add source directory:', error.message);
        res.status(500).json({ 
            detail: 'Failed to add source directory',
            error: error.message 
        });
    }
});

/**
 * Remove source directory
 */
router.delete('/source-directories/:directory', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { directory } = req.params;
        const decodedDirectory = decodeURIComponent(directory);
        
        const removed = await borgmaticConfig.removeSourceDirectory(decodedDirectory);
        
        if (!removed) {
            return res.status(404).json({ 
                detail: 'Source directory not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Source directory removed successfully' 
        });
    } catch (error) {
        console.error('Failed to remove source directory:', error.message);
        res.status(500).json({ 
            detail: 'Failed to remove source directory',
            error: error.message 
        });
    }
});

/**
 * Update storage configuration
 */
router.put('/storage', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const storageConfig = req.body;
        
        await borgmaticConfig.updateStorage(storageConfig);
        res.json({ 
            success: true, 
            message: 'Storage configuration updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update storage config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update storage configuration',
            error: error.message 
        });
    }
});

/**
 * Update retention policy
 */
router.put('/retention', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const retentionConfig = req.body;
        
        await borgmaticConfig.updateRetention(retentionConfig);
        res.json({ 
            success: true, 
            message: 'Retention policy updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update retention config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update retention policy',
            error: error.message 
        });
    }
});

/**
 * Get backup history
 */
router.get('/backups', authenticateToken, async (req, res) => {
    try {
        const backups = await borgmaticConfig.getBackupHistory();
        res.json(backups);
    } catch (error) {
        console.error('Failed to get backup history:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get backup history',
            error: error.message 
        });
    }
});

/**
 * Restore from backup
 */
router.post('/restore/:backupName', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { backupName } = req.params;
        
        await borgmaticConfig.restoreFromBackup(backupName);
        res.json({ 
            success: true, 
            message: 'Configuration restored from backup successfully' 
        });
    } catch (error) {
        console.error('Failed to restore from backup:', error.message);
        res.status(500).json({ 
            detail: 'Failed to restore from backup',
            error: error.message 
        });
    }
});

module.exports = router;
