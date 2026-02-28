const express = require('express');
const router = express.Router();
const directorNotificationConfig = require('../services/director-notification-config');
const identityManager = require('../services/identity-manager');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Middleware to ensure we're in director mode
 */
async function requireDirectorMode(req, res, next) {
    try {
        const identity = await identityManager.getIdentity();
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                detail: 'This endpoint is only available in Director mode'
            });
        }
        next();
    } catch (error) {
        res.status(500).json({
            detail: 'Failed to verify mode',
            error: error.message
        });
    }
}

/**
 * Get Director notification forwarding configuration
 */
router.get('/config', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const config = await directorNotificationConfig.loadConfig();
        res.json(config);
    } catch (error) {
        console.error('Failed to get director notification config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load director notification configuration',
            error: error.message 
        });
    }
});

/**
 * Save Director notification forwarding configuration
 */
router.post('/config', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const config = req.body;
        
        // Validate provider
        if (config.forwarding?.provider && !['apprise', 'ntfy'].includes(config.forwarding.provider)) {
            return res.status(400).json({
                detail: 'Invalid provider. Must be "apprise" or "ntfy"'
            });
        }
        
        // Validate client filter mode
        if (config.client_filters?.mode && !['all', 'include', 'exclude'].includes(config.client_filters.mode)) {
            return res.status(400).json({
                detail: 'Invalid client filter mode. Must be "all", "include", or "exclude"'
            });
        }
        
        await directorNotificationConfig.saveConfig(config);
        res.json({ 
            success: true, 
            message: 'Director notification configuration saved successfully' 
        });
    } catch (error) {
        console.error('Failed to save director notification config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to save director notification configuration',
            error: error.message 
        });
    }
});

/**
 * Get Director notification forwarding status
 */
router.get('/status', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const status = await directorNotificationConfig.getStatus();
        res.json(status);
    } catch (error) {
        console.error('Failed to get director notification status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get director notification status',
            error: error.message 
        });
    }
});

/**
 * Enable/disable forwarding
 */
router.put('/forwarding', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                detail: 'enabled must be a boolean'
            });
        }
        
        const config = await directorNotificationConfig.loadConfig();
        if (!config.forwarding) {
            config.forwarding = {};
        }
        config.forwarding.enabled = enabled;
        await directorNotificationConfig.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: `Notification forwarding ${enabled ? 'enabled' : 'disabled'}` 
        });
    } catch (error) {
        console.error('Failed to update forwarding status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update forwarding status',
            error: error.message 
        });
    }
});

/**
 * Update forwarding provider
 */
router.put('/provider', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { provider } = req.body;
        
        if (!provider || !['apprise', 'ntfy'].includes(provider)) {
            return res.status(400).json({
                detail: 'Invalid provider. Must be "apprise" or "ntfy"'
            });
        }
        
        const config = await directorNotificationConfig.loadConfig();
        if (!config.forwarding) {
            config.forwarding = {};
        }
        config.forwarding.provider = provider;
        await directorNotificationConfig.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: `Forwarding provider set to ${provider}` 
        });
    } catch (error) {
        console.error('Failed to update provider:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update forwarding provider',
            error: error.message 
        });
    }
});

/**
 * Update forwarding events
 */
router.put('/events', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { events } = req.body;
        
        if (!Array.isArray(events)) {
            return res.status(400).json({
                detail: 'events must be an array'
            });
        }
        
        const config = await directorNotificationConfig.loadConfig();
        config.events = events;
        await directorNotificationConfig.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: 'Forwarding events updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update events:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update forwarding events',
            error: error.message 
        });
    }
});

/**
 * Update client filters
 */
router.put('/client-filters', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { mode, client_ids } = req.body;
        
        if (mode && !['all', 'include', 'exclude'].includes(mode)) {
            return res.status(400).json({
                detail: 'Invalid mode. Must be "all", "include", or "exclude"'
            });
        }
        
        if (client_ids && !Array.isArray(client_ids)) {
            return res.status(400).json({
                detail: 'client_ids must be an array'
            });
        }
        
        const config = await directorNotificationConfig.loadConfig();
        if (!config.client_filters) {
            config.client_filters = {};
        }
        
        if (mode !== undefined) {
            config.client_filters.mode = mode;
        }
        if (client_ids !== undefined) {
            config.client_filters.client_ids = client_ids;
        }
        
        await directorNotificationConfig.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: 'Client filters updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update client filters:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update client filters',
            error: error.message 
        });
    }
});

/**
 * Get available event types
 */
router.get('/available-events', authenticateToken, requireDirectorMode, (req, res) => {
    try {
        const events = directorNotificationConfig.getAvailableEvents();
        res.json(events);
    } catch (error) {
        console.error('Failed to get available events:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get available events',
            error: error.message 
        });
    }
});

/**
 * Send test notification through forwarding
 */
router.post('/test', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { event_type, client_name } = req.body;
        
        const testNotification = {
            client_id: 'test-client',
            client_name: client_name || 'Test Client',
            event_type: event_type || 'backup_failed',
            severity: 'error',
            message: 'This is a test notification from Borgmatic Director',
            timestamp: new Date().toISOString(),
            details: { test: true }
        };
        
        const result = await directorNotificationConfig.forwardNotification(testNotification);
        
        res.json({
            success: result.success,
            message: result.success ? 'Test notification sent' : 'Failed to send test notification',
            error: result.error,
            reason: result.reason
        });
    } catch (error) {
        console.error('Failed to send test notification:', error.message);
        res.status(500).json({ 
            detail: 'Failed to send test notification',
            error: error.message 
        });
    }
});

module.exports = router;
