const yamlManager = require('./yaml-manager');
const path = require('path');
const config = require('../config');

/**
 * Notification Router Service
 * Central routing logic for notifications across all modes
 * Handles provider selection and routing decisions (Director/Local/Both)
 */
class NotificationRouter {
    constructor() {
        this.configPath = path.join(config.configDir, 'notification-routing.yaml');
        this.defaultConfig = {
            // Provider selection: 'apprise' or 'ntfy'
            provider: 'ntfy',

            // Routing mode for client mode: 'director_only', 'local_only', 'both'
            // In standalone mode, this is ignored (always local)
            // In director mode, this controls forwarding
            routing: 'both',

            // Events to send locally (when routing is 'local_only' or 'both')
            local_events: [
                'backup_started',
                'backup_completed',
                'backup_failed',
                'backup_warning',
                'security_alert'
            ],

            // Events to send to director (when routing is 'director_only' or 'both')
            director_events: [
                'backup_started',
                'backup_completed',
                'backup_failed',
                'backup_warning',
                'security_alert'
            ]
        };
    }

    /**
     * Load notification routing configuration
     */
    async loadConfig() {
        try {
            const config = await yamlManager.readYaml(this.configPath);
            return { ...this.defaultConfig, ...config };
        } catch (error) {
            // Return default config if file doesn't exist
            return this.defaultConfig;
        }
    }

    /**
     * Save notification routing configuration
     */
    async saveConfig(configData) {
        try {
            await yamlManager.writeYaml(this.configPath, configData);
            console.log('Notification routing configuration saved');
            return true;
        } catch (error) {
            console.error('Failed to save notification routing config:', error.message);
            throw error;
        }
    }

    /**
     * Get the current mode (standalone, client, director)
     */
    async getCurrentMode() {
        try {
            const identityManager = require('./identity-manager');
            const identity = await identityManager.getIdentity();
            return identity?.mode || 'standalone';
        } catch (error) {
            return 'standalone';
        }
    }

    /**
     * Check if we should send to local provider
     */
    async shouldSendLocal(eventType) {
        const config = await this.loadConfig();
        const mode = await this.getCurrentMode();

        // In standalone mode, always send locally
        if (mode === 'standalone') {
            return config.local_events.includes(eventType);
        }

        // In director mode, we send via the Director's forwarding service
        if (mode === 'director') {
            const directorNotificationConfig = require('./director-notification-config');
            return await directorNotificationConfig.shouldForward(eventType, 'local');
        }

        // In client mode, check routing setting
        if (mode === 'client') {
            if (config.routing === 'director_only') {
                return false;
            }
            return config.local_events.includes(eventType);
        }

        return false;
    }

    /**
     * Check if we should send to director
     */
    async shouldSendToDirector(eventType) {
        const config = await this.loadConfig();
        const mode = await this.getCurrentMode();

        // Only client mode sends to director
        if (mode !== 'client') {
            return false;
        }

        // Check routing setting
        if (config.routing === 'local_only') {
            return false;
        }

        return config.director_events.includes(eventType);
    }

    /**
     * Get the local notification provider instance
     */
    async getLocalProvider() {
        const config = await this.loadConfig();

        if (config.provider === 'ntfy') {
            return require('./ntfy');
        }

        return require('./apprise');
    }

    /**
     * Send notification through the router
     * This is the main entry point for sending notifications
     */
    async sendNotification(eventType, options = {}) {
        const results = {
            local: null,
            director: null
        };

        try {
            // Map event types to notification types
            const notificationTypeMap = {
                'backup_started': 'success',
                'backup_completed': 'success',
                'backup_failed': 'failure',
                'backup_warning': 'warning',
                'security_alert': 'security_alert',
                'error': 'failure',
                'warning': 'warning'
            };

            const notificationType = notificationTypeMap[eventType] || 'info';

            // Check if we should send locally
            if (await this.shouldSendLocal(eventType)) {
                try {
                    const provider = await this.getLocalProvider();

                    // Use the appropriate method based on event type
                    if (eventType === 'security_alert') {
                        results.local = await provider.sendSecurityAlert(options);
                    } else if (notificationType === 'success') {
                        results.local = await provider.sendSuccessNotification(options);
                    } else if (notificationType === 'failure') {
                        results.local = await provider.sendFailureNotification(options);
                    } else if (notificationType === 'warning') {
                        results.local = await provider.sendWarningNotification(options);
                    } else {
                        // Generic notification
                        results.local = await provider.sendNotification(notificationType, options);
                    }

                    if (results.local?.success) {
                        console.log(`📤 Local notification sent: ${eventType}`);
                    }
                } catch (error) {
                    console.error(`Failed to send local notification:`, error.message);
                    results.local = { success: false, error: error.message };
                }
            }

            // Check if we should send to director
            if (await this.shouldSendToDirector(eventType)) {
                try {
                    const directorClient = require('./director-client');

                    // Only send if connected
                    const connectionInfo = directorClient.getConnectionInfo();
                    if (connectionInfo.isConnected && connectionInfo.isAuthenticated) {
                        directorClient.sendNotification(eventType, options);
                        results.director = { success: true };
                        console.log(`📤 Director notification sent: ${eventType}`);
                    } else {
                        results.director = { success: false, error: 'Not connected to Director' };
                    }
                } catch (error) {
                    console.error(`Failed to send director notification:`, error.message);
                    results.director = { success: false, error: error.message };
                }
            }

            return results;
        } catch (error) {
            console.error('Notification router error:', error.message);
            return {
                local: { success: false, error: error.message },
                director: { success: false, error: error.message }
            };
        }
    }

    /**
     * Send backup started notification
     */
    async notifyBackupStarted(backupName, repository, details = {}) {
        return this.sendNotification('backup_started', {
            severity: 'info',
            message: `Backup started: ${backupName}`,
            title: 'Backup Started',
            backup_name: backupName,
            repository,
            details
        });
    }

    /**
     * Send backup completed notification
     */
    async notifyBackupCompleted(backupName, repository, stats = {}) {
        return this.sendNotification('backup_completed', {
            severity: 'success',
            message: `Backup completed successfully: ${backupName}`,
            title: 'Backup Success',
            body: `Backup "${backupName}" completed successfully`,
            backup_name: backupName,
            repository,
            details: stats
        });
    }

    /**
     * Send backup failed notification
     */
    async notifyBackupFailed(backupName, repository, error) {
        return this.sendNotification('backup_failed', {
            severity: 'error',
            message: `Backup failed: ${backupName} - ${error}`,
            title: 'Backup Failed',
            body: `Backup "${backupName}" failed: ${error}`,
            backup_name: backupName,
            repository,
            details: { error: String(error) }
        });
    }

    /**
     * Send backup warning notification
     */
    async notifyBackupWarning(backupName, repository, warning) {
        return this.sendNotification('backup_warning', {
            severity: 'warning',
            message: `Backup warning: ${backupName} - ${warning}`,
            title: 'Backup Warning',
            body: `Backup "${backupName}" completed with warnings: ${warning}`,
            backup_name: backupName,
            repository,
            details: { warning: String(warning) }
        });
    }

    /**
     * Send security alert notification
     */
    async notifySecurityAlert(message, details = {}) {
        return this.sendNotification('security_alert', {
            severity: 'error',
            message,
            title: '🚨 SECURITY ALERT',
            body: message,
            details
        });
    }

    /**
     * Get current routing configuration and status
     */
    async getStatus() {
        const config = await this.loadConfig();
        const mode = await this.getCurrentMode();

        // Check provider status
        let providerStatus = { available: false };
        try {
            const provider = await this.getLocalProvider();
            if (config.provider === 'ntfy') {
                providerStatus = await provider.getNotificationStatus();
            } else {
                providerStatus = await provider.getNotificationStatus();
            }
        } catch (error) {
            providerStatus = { available: false, error: error.message };
        }

        // Check director connection if in client mode
        let directorStatus = { connected: false };
        if (mode === 'client') {
            try {
                const directorClient = require('./director-client');
                const connectionInfo = directorClient.getConnectionInfo();
                directorStatus = {
                    connected: connectionInfo.isConnected,
                    authenticated: connectionInfo.isAuthenticated
                };
            } catch (error) {
                directorStatus = { connected: false, error: error.message };
            }
        }

        return {
            mode,
            provider: config.provider,
            routing: config.routing,
            local_events: config.local_events,
            director_events: config.director_events,
            provider_status: providerStatus,
            director_status: directorStatus
        };
    }
}

module.exports = new NotificationRouter();
