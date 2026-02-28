const express = require('express');
const router = express.Router();
const notificationRouter = require('../services/notification-router');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get notification routing configuration
 */
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = await notificationRouter.loadConfig();
        res.json(config);
    } catch (error) {
        console.error('Failed to get notification routing config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to load notification routing configuration',
            error: error.message 
        });
    }
});

/**
 * Save notification routing configuration
 */
router.post('/config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = req.body;
        
        // Validate required fields
        if (config.provider && !['apprise', 'ntfy'].includes(config.provider)) {
            return res.status(400).json({
                detail: 'Invalid provider. Must be "apprise" or "ntfy"'
            });
        }
        
        if (config.routing && !['director_only', 'local_only', 'both'].includes(config.routing)) {
            return res.status(400).json({
                detail: 'Invalid routing mode. Must be "director_only", "local_only", or "both"'
            });
        }
        
        await notificationRouter.saveConfig(config);
        res.json({ 
            success: true, 
            message: 'Notification routing configuration saved successfully' 
        });
    } catch (error) {
        console.error('Failed to save notification routing config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to save notification routing configuration',
            error: error.message 
        });
    }
});

/**
 * Get notification routing status
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = await notificationRouter.getStatus();
        res.json(status);
    } catch (error) {
        console.error('Failed to get notification routing status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get notification routing status',
            error: error.message 
        });
    }
});

/**
 * Send a test notification through the router
 */
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { event_type, title, message } = req.body;
        
        if (!event_type) {
            return res.status(400).json({
                detail: 'event_type is required'
            });
        }
        
        const result = await notificationRouter.sendNotification(event_type, {
            title: title || 'Test Notification',
            message: message || 'This is a test notification from Borgmatic UI',
            body: message || 'This is a test notification from Borgmatic UI'
        });
        
        res.json({
            success: true,
            results: result
        });
    } catch (error) {
        console.error('Failed to send test notification:', error.message);
        res.status(500).json({ 
            detail: 'Failed to send test notification',
            error: error.message 
        });
    }
});

/**
 * Update provider selection
 */
router.put('/provider', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { provider } = req.body;
        
        if (!provider || !['apprise', 'ntfy'].includes(provider)) {
            return res.status(400).json({
                detail: 'Invalid provider. Must be "apprise" or "ntfy"'
            });
        }
        
        const config = await notificationRouter.loadConfig();
        config.provider = provider;
        await notificationRouter.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: `Notification provider set to ${provider}` 
        });
    } catch (error) {
        console.error('Failed to update provider:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update notification provider',
            error: error.message 
        });
    }
});

/**
 * Update routing mode (for client mode)
 */
router.put('/routing', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { routing } = req.body;
        
        if (!routing || !['director_only', 'local_only', 'both'].includes(routing)) {
            return res.status(400).json({
                detail: 'Invalid routing mode. Must be "director_only", "local_only", or "both"'
            });
        }
        
        const config = await notificationRouter.loadConfig();
        config.routing = routing;
        await notificationRouter.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: `Notification routing set to ${routing}` 
        });
    } catch (error) {
        console.error('Failed to update routing:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update notification routing',
            error: error.message 
        });
    }
});

/**
 * Update local events list
 */
router.put('/local-events', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { events } = req.body;
        
        if (!Array.isArray(events)) {
            return res.status(400).json({
                detail: 'events must be an array'
            });
        }
        
        const config = await notificationRouter.loadConfig();
        config.local_events = events;
        await notificationRouter.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: 'Local events updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update local events:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update local events',
            error: error.message 
        });
    }
});

/**
 * Update director events list
 */
router.put('/director-events', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { events } = req.body;
        
        if (!Array.isArray(events)) {
            return res.status(400).json({
                detail: 'events must be an array'
            });
        }
        
        const config = await notificationRouter.loadConfig();
        config.director_events = events;
        await notificationRouter.saveConfig(config);
        
        res.json({ 
            success: true, 
            message: 'Director events updated successfully' 
        });
    } catch (error) {
        console.error('Failed to update director events:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update director events',
            error: error.message 
        });
    }
});

/**
 * Get available event types
 */
router.get('/event-types', authenticateToken, (req, res) => {
    res.json([
        { id: 'backup_started', label: 'Backup Started', description: 'When a backup job begins' },
        { id: 'backup_completed', label: 'Backup Completed', description: 'When a backup completes successfully' },
        { id: 'backup_failed', label: 'Backup Failed', description: 'When a backup fails' },
        { id: 'backup_warning', label: 'Backup Warning', description: 'When a backup completes with warnings' },
        { id: 'security_alert', label: 'Security Alert', description: 'Critical security events (ransomware detection)' }
    ]);
});

module.exports = router;
