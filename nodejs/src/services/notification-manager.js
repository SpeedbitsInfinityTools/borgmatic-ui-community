const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

/**
 * NotificationManager
 * Manages notifications from clients, stores them, and handles cleanup
 */
class NotificationManager {
    constructor() {
        this.notificationsFile = path.join(config.dataDir, 'notifications.json');
        this.notifications = [];
        this.retentionDays = 14; // Auto-delete after 14 days
    }

    /**
     * Initialize notification manager
     */
    async initialize() {
        try {
            await fs.ensureDir(config.dataDir);
            
            // Load existing notifications
            if (await fs.pathExists(this.notificationsFile)) {
                this.notifications = await fs.readJson(this.notificationsFile);
                console.log(`✓ Loaded ${this.notifications.length} notifications`);
            } else {
                this.notifications = [];
                await this.save();
            }

            // Start cleanup task
            this.startCleanupTask();
            
            return { success: true };
        } catch (error) {
            console.error('Failed to initialize notification manager:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add a new notification
     */
    async addNotification(notification) {
        try {
            const newNotification = {
                id: this.generateId(),
                timestamp: new Date().toISOString(),
                read: false,
                ...notification
            };

            this.notifications.unshift(newNotification); // Add to beginning
            await this.save();

            console.log(`📬 Notification added: ${notification.client_name} - ${notification.event_type}`);
            
            return { success: true, notification: newNotification };
        } catch (error) {
            console.error('Failed to add notification:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get notifications for a specific client
     */
    getClientNotifications(clientId, limit = null) {
        const clientNotifications = this.notifications.filter(n => n.client_id === clientId);
        
        if (limit) {
            return clientNotifications.slice(0, limit);
        }
        
        return clientNotifications;
    }

    /**
     * Get last N notifications per client
     */
    getRecentNotificationsByClient(limit = 3) {
        const clientMap = {};
        
        for (const notification of this.notifications) {
            if (!clientMap[notification.client_id]) {
                clientMap[notification.client_id] = [];
            }
            
            if (clientMap[notification.client_id].length < limit) {
                clientMap[notification.client_id].push(notification);
            }
        }
        
        return clientMap;
    }

    /**
     * Get all notifications (optionally filtered)
     */
    getAllNotifications(filters = {}) {
        let filtered = [...this.notifications];

        if (filters.client_id) {
            filtered = filtered.filter(n => n.client_id === filters.client_id);
        }

        if (filters.event_type) {
            filtered = filtered.filter(n => n.event_type === filters.event_type);
        }

        if (filters.severity) {
            filtered = filtered.filter(n => n.severity === filters.severity);
        }

        if (filters.unread_only) {
            filtered = filtered.filter(n => !n.read);
        }

        return filtered;
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        
        if (notification) {
            notification.read = true;
            await this.save();
            return { success: true };
        }
        
        return { success: false, error: 'Notification not found' };
    }

    /**
     * Mark all notifications for a client as read
     */
    async markClientNotificationsRead(clientId) {
        let updated = 0;
        
        for (const notification of this.notifications) {
            if (notification.client_id === clientId && !notification.read) {
                notification.read = true;
                updated++;
            }
        }
        
        if (updated > 0) {
            await this.save();
        }
        
        return { success: true, updated };
    }

    /**
     * Delete old notifications (older than retention period)
     */
    async cleanupOldNotifications() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

        const originalCount = this.notifications.length;
        
        this.notifications = this.notifications.filter(n => {
            return new Date(n.timestamp) > cutoffDate;
        });

        const deletedCount = originalCount - this.notifications.length;

        if (deletedCount > 0) {
            await this.save();
            console.log(`🗑️  Cleaned up ${deletedCount} old notifications (older than ${this.retentionDays} days)`);
        }

        return { success: true, deleted: deletedCount };
    }

    /**
     * Start periodic cleanup task
     */
    startCleanupTask() {
        // Run cleanup every 6 hours
        setInterval(() => {
            this.cleanupOldNotifications();
        }, 6 * 60 * 60 * 1000);

        console.log(`✓ Notification cleanup task started (runs every 6 hours, retains ${this.retentionDays} days)`);
    }

    /**
     * Get notification statistics
     */
    getStatistics() {
        const total = this.notifications.length;
        const unread = this.notifications.filter(n => !n.read).length;
        
        const byType = {};
        const bySeverity = {};
        const byClient = {};

        for (const notification of this.notifications) {
            // By type
            byType[notification.event_type] = (byType[notification.event_type] || 0) + 1;
            
            // By severity
            bySeverity[notification.severity] = (bySeverity[notification.severity] || 0) + 1;
            
            // By client
            byClient[notification.client_id] = (byClient[notification.client_id] || 0) + 1;
        }

        return {
            total,
            unread,
            by_type: byType,
            by_severity: bySeverity,
            by_client: byClient
        };
    }

    /**
     * Save notifications to disk
     */
    async save() {
        try {
            await fs.writeJson(this.notificationsFile, this.notifications, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save notifications:', error);
        }
    }

    /**
     * Generate unique notification ID
     */
    generateId() {
        return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Singleton instance
const notificationManager = new NotificationManager();

module.exports = notificationManager;

