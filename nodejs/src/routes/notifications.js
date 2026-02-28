const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const notificationManager = require('../services/notification-manager');
const identityManager = require('../services/identity-manager');

/**
 * Get all notifications (Director mode only)
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Check if in Director mode
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Notifications are only available in Director mode'
            });
        }

        const filters = {
            client_id: req.query.client_id,
            event_type: req.query.event_type,
            severity: req.query.severity,
            unread_only: req.query.unread_only === 'true'
        };

        const notifications = notificationManager.getAllNotifications(filters);
        
        res.json({
            success: true,
            data: {
                notifications,
                count: notifications.length
            }
        });
    } catch (error) {
        console.error('Error getting notifications:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve notifications'
        });
    }
});

/**
 * Get notifications grouped by client (last N per client)
 */
router.get('/by-client', authenticateToken, async (req, res) => {
    try {
        // Check if in Director mode
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Notifications are only available in Director mode'
            });
        }

        const limit = parseInt(req.query.limit) || 3;
        const notificationsByClient = notificationManager.getRecentNotificationsByClient(limit);
        
        res.json({
            success: true,
            data: {
                notifications_by_client: notificationsByClient
            }
        });
    } catch (error) {
        console.error('Error getting notifications by client:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve notifications'
        });
    }
});

/**
 * Get notifications for specific client
 */
router.get('/client/:client_id', authenticateToken, async (req, res) => {
    try {
        // Check if in Director mode
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Notifications are only available in Director mode'
            });
        }

        const { client_id } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        
        const notifications = notificationManager.getClientNotifications(client_id, limit);
        
        res.json({
            success: true,
            data: {
                client_id,
                notifications,
                count: notifications.length
            }
        });
    } catch (error) {
        console.error('Error getting client notifications:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve notifications'
        });
    }
});

/**
 * Mark notification as read
 */
router.post('/:notification_id/read', authenticateToken, async (req, res) => {
    try {
        const { notification_id } = req.params;
        
        const result = await notificationManager.markAsRead(notification_id);
        
        if (result.success) {
            res.json({
                success: true,
                data: { message: 'Notification marked as read' }
            });
        } else {
            res.status(404).json({
                success: false,
                detail: result.error
            });
        }
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to mark notification as read'
        });
    }
});

/**
 * Mark all notifications for a client as read
 */
router.post('/client/:client_id/read-all', authenticateToken, async (req, res) => {
    try {
        const { client_id } = req.params;
        
        const result = await notificationManager.markClientNotificationsRead(client_id);
        
        res.json({
            success: true,
            data: {
                message: `${result.updated} notification(s) marked as read`,
                updated: result.updated
            }
        });
    } catch (error) {
        console.error('Error marking client notifications as read:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to mark notifications as read'
        });
    }
});

/**
 * Get notification statistics
 */
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // Check if in Director mode
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Notifications are only available in Director mode'
            });
        }

        const stats = notificationManager.getStatistics();
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error getting notification stats:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve notification statistics'
        });
    }
});

/**
 * Manually trigger cleanup of old notifications
 */
router.post('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await notificationManager.cleanupOldNotifications();
        
        res.json({
            success: true,
            data: {
                message: `Cleaned up ${result.deleted} old notification(s)`,
                deleted: result.deleted
            }
        });
    } catch (error) {
        console.error('Error cleaning up notifications:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to clean up notifications'
        });
    }
});

module.exports = router;

