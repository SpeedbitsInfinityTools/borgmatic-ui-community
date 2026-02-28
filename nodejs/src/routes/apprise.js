const express = require('express');
const router = express.Router();
const appriseService = require('../services/apprise');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get Apprise configuration
 */
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = await appriseService.loadConfig();
        res.json(config);
    } catch (error) {
        console.error('Failed to get Apprise config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load Apprise configuration',
            error: error.message 
        });
    }
});

/**
 * Save Apprise configuration
 */
router.post('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = req.body;
        
        await appriseService.saveConfig(config);
        res.json({ 
            success: true, 
            message: 'Apprise configuration saved successfully' 
        });
    } catch (error) {
        console.error('Failed to save Apprise config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to save Apprise configuration',
            error: error.message 
        });
    }
});

/**
 * Test notification connection
 */
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                detail: 'Notification URL is required' 
            });
        }

        const result = await appriseService.testConnection(url);
        res.json(result);
    } catch (error) {
        console.error('Failed to test notification:', error.message);
        res.status(500).json({ 
            detail: 'Failed to test notification',
            error: error.message 
        });
    }
});

/**
 * Send test notification
 */
router.post('/send-test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, title, body } = req.body;
        
        if (!type) {
            return res.status(400).json({ 
                detail: 'Notification type is required' 
            });
        }

        const result = await appriseService.sendNotification(type, { title, body });
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
 * Add notification URL
 */
router.post('/urls', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, url } = req.body;
        
        if (!type || !url) {
            return res.status(400).json({ 
                detail: 'Notification type and URL are required' 
            });
        }

        await appriseService.addNotificationUrl(type, url);
        res.json({ 
            success: true, 
            message: 'Notification URL added successfully' 
        });
    } catch (error) {
        console.error('Failed to add notification URL:', error.message);
        res.status(500).json({ 
            detail: 'Failed to add notification URL',
            error: error.message 
        });
    }
});

/**
 * Remove notification URL
 */
router.delete('/urls', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, url } = req.body;
        
        if (!type || !url) {
            return res.status(400).json({ 
                detail: 'Notification type and URL are required' 
            });
        }

        await appriseService.removeNotificationUrl(type, url);
        res.json({ 
            success: true, 
            message: 'Notification URL removed successfully' 
        });
    } catch (error) {
        console.error('Failed to remove notification URL:', error.message);
        res.status(500).json({ 
            detail: 'Failed to remove notification URL',
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

        await appriseService.setNotificationEnabled(type, enabled);
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
 * Update notification settings
 */
router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, settings } = req.body;
        
        if (!type || !settings) {
            return res.status(400).json({ 
                detail: 'Notification type and settings are required' 
            });
        }

        await appriseService.updateNotificationSettings(type, settings);
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
 * Get supported notification services
 */
router.get('/services', authenticateToken, (req, res) => {
    try {
        const services = appriseService.getSupportedServices();
        res.json(services);
    } catch (error) {
        console.error('Failed to get supported services:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get supported services',
            error: error.message 
        });
    }
});

/**
 * Generate borgmatic hooks
 */
router.get('/hooks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const hooks = await appriseService.generateBorgmaticHooks();
        res.json(hooks);
    } catch (error) {
        console.error('Failed to generate hooks:', error.message);
        res.status(500).json({ 
            detail: 'Failed to generate borgmatic hooks',
            error: error.message 
        });
    }
});

/**
 * Get notification status
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = await appriseService.getNotificationStatus();
        res.json(status);
    } catch (error) {
        console.error('Failed to get notification status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get notification status',
            error: error.message 
        });
    }
});

/**
 * Update API configuration
 */
router.put('/api-config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { enabled, url, key } = req.body;
        
        await appriseService.updateApiConfig({ enabled, url, key });
        res.json({ 
            success: true, 
            message: 'API configuration updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update API config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update API configuration',
            error: error.message 
        });
    }
});

/**
 * Test API server connection
 */
router.post('/test-api', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                detail: 'API URL is required' 
            });
        }

        const result = await appriseService.testApiConnection(url);
        res.json(result);
    } catch (error) {
        console.error('Failed to test API connection:', error.message);
        res.status(500).json({ 
            detail: 'Failed to test API connection',
            error: error.message 
        });
    }
});

module.exports = router;
