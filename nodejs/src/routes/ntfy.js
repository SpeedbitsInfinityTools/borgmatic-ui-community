const express = require('express');
const router = express.Router();
const ntfyService = require('../services/ntfy');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get ntfy configuration
 */
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = await ntfyService.loadConfig();
        
        // Mask sensitive data
        const safeConfig = {
            ...config,
            auth: config.auth ? {
                type: config.auth.type,
                username: config.auth.username || '',
                password: config.auth.password ? '********' : '',
                token: config.auth.token ? '********' : ''
            } : { type: 'none', username: '', password: '', token: '' }
        };
        
        res.json(safeConfig);
    } catch (error) {
        console.error('Failed to get ntfy config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load ntfy configuration',
            error: error.message 
        });
    }
});

/**
 * Save ntfy configuration
 */
router.post('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const newConfig = req.body;
        
        // If password/token is masked, preserve the existing values
        if (newConfig.auth) {
            const existingConfig = await ntfyService.loadConfig();
            
            if (newConfig.auth.password === '********' && existingConfig.auth?.password) {
                newConfig.auth.password = existingConfig.auth.password;
            }
            if (newConfig.auth.token === '********' && existingConfig.auth?.token) {
                newConfig.auth.token = existingConfig.auth.token;
            }
        }
        
        await ntfyService.saveConfig(newConfig);
        res.json({ 
            success: true, 
            message: 'ntfy configuration saved successfully' 
        });
    } catch (error) {
        console.error('Failed to save ntfy config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to save ntfy configuration',
            error: error.message 
        });
    }
});

/**
 * Test ntfy connection
 */
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const testConfig = req.body;
        
        // If testing with masked credentials, use existing config
        if (testConfig?.auth) {
            const existingConfig = await ntfyService.loadConfig();
            
            if (testConfig.auth.password === '********' && existingConfig.auth?.password) {
                testConfig.auth.password = existingConfig.auth.password;
            }
            if (testConfig.auth.token === '********' && existingConfig.auth?.token) {
                testConfig.auth.token = existingConfig.auth.token;
            }
        }
        
        const result = await ntfyService.testConnection(testConfig);
        res.json(result);
    } catch (error) {
        console.error('Failed to test ntfy connection:', error.message);
        res.status(500).json({ 
            detail: 'Failed to test ntfy connection',
            error: error.message 
        });
    }
});

/**
 * Send test notification
 */
router.post('/send-test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, title, message } = req.body;
        
        if (!type) {
            return res.status(400).json({ 
                detail: 'Notification type is required' 
            });
        }

        const result = await ntfyService.sendNotification(type, { title, message });
        res.json(result);
    } catch (error) {
        console.error('Failed to send test notification:', error.message);
        res.status(500).json({ 
            detail: 'Failed to send test notification',
            error: error.message 
        });
    }
});

/**
 * Send direct notification (for custom messages)
 */
router.post('/send', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { title, message, priority, tags } = req.body;
        
        if (!message) {
            return res.status(400).json({ 
                detail: 'Message is required' 
            });
        }

        const result = await ntfyService.sendToNtfy({ title, message, priority, tags });
        res.json(result);
    } catch (error) {
        console.error('Failed to send ntfy notification:', error.message);
        res.status(500).json({ 
            detail: 'Failed to send notification',
            error: error.message 
        });
    }
});

/**
 * Get notification status
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = await ntfyService.getNotificationStatus();
        res.json(status);
    } catch (error) {
        console.error('Failed to get ntfy status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get ntfy status',
            error: error.message 
        });
    }
});

/**
 * Enable/disable notification type
 */
router.put('/enabled', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, enabled } = req.body;
        
        if (type === undefined || enabled === undefined) {
            return res.status(400).json({ 
                detail: 'Notification type and enabled status are required' 
            });
        }

        await ntfyService.setNotificationEnabled(type, enabled);
        res.json({ 
            success: true, 
            message: `Notification ${type} ${enabled ? 'enabled' : 'disabled'} successfully` 
        });
    } catch (error) {
        console.error('Failed to set notification enabled:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update notification status',
            error: error.message 
        });
    }
});

/**
 * Update notification settings for a type
 */
router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, settings } = req.body;
        
        if (!type || !settings) {
            return res.status(400).json({ 
                detail: 'Notification type and settings are required' 
            });
        }

        await ntfyService.updateNotificationSettings(type, settings);
        res.json({ 
            success: true, 
            message: 'Notification settings updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update notification settings:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update notification settings',
            error: error.message 
        });
    }
});

/**
 * Get available priority levels
 */
router.get('/priorities', authenticateToken, (req, res) => {
    try {
        const priorities = ntfyService.getPriorityLevels();
        res.json(priorities);
    } catch (error) {
        console.error('Failed to get priority levels:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get priority levels',
            error: error.message 
        });
    }
});

module.exports = router;
