const yamlManager = require('./yaml-manager');
const path = require('path');
const config = require('../config');

/**
 * Director Notification Configuration Service
 * Manages notification forwarding settings for Director mode
 */
class DirectorNotificationConfig {
    constructor() {
        this.configPath = path.join(config.configDir, 'director-notifications.yaml');
        this.defaultConfig = {
            forwarding: {
                enabled: true,
                provider: 'ntfy', // 'apprise' or 'ntfy'
            },
            
            // Events that trigger forwarding
            events: [
                'backup_failed',
                'backup_warning',
                'error',
                'connection_lost',
                'security_alert'
            ],
            
            // Client filtering
            client_filters: {
                // Mode: 'all', 'include', 'exclude'
                mode: 'all',
                // List of client_ids (used when mode is 'include' or 'exclude')
                client_ids: []
            }
        };
    }

    /**
     * Load Director notification configuration
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
     * Save Director notification configuration
     */
    async saveConfig(configData) {
        try {
            await yamlManager.writeYaml(this.configPath, configData);
            console.log('Director notification configuration saved');
            return true;
        } catch (error) {
            console.error('Failed to save director notification config:', error.message);
            throw error;
        }
    }

    /**
     * Check if forwarding is enabled for a given event and client
     */
    async shouldForward(eventType, clientId = null) {
        const config = await this.loadConfig();
        
        // Check if forwarding is enabled
        if (!config.forwarding?.enabled) {
            return false;
        }
        
        // Check if event is in the allowed events list
        if (!config.events.includes(eventType)) {
            // Security alerts are always forwarded
            if (eventType !== 'security_alert') {
                return false;
            }
        }
        
        // Check client filtering
        if (clientId && config.client_filters) {
            const filterMode = config.client_filters.mode || 'all';
            const clientList = config.client_filters.client_ids || [];
            
            if (filterMode === 'include' && clientList.length > 0) {
                if (!clientList.includes(clientId)) {
                    return false;
                }
            } else if (filterMode === 'exclude' && clientList.length > 0) {
                if (clientList.includes(clientId)) {
                    return false;
                }
            }
            // 'all' mode allows everything
        }
        
        return true;
    }

    /**
     * Get the notification provider to use for forwarding
     */
    async getProvider() {
        const config = await this.loadConfig();
        const provider = config.forwarding?.provider || 'ntfy';
        
        if (provider === 'ntfy') {
            return require('./ntfy');
        }
        
        return require('./apprise');
    }

    /**
     * Forward a notification using the configured provider
     */
    async forwardNotification(notification) {
        const config = await this.loadConfig();
        
        // Check if we should forward this notification
        if (!await this.shouldForward(notification.event_type, notification.client_id)) {
            return { success: false, reason: 'filtered' };
        }
        
        const provider = await this.getProvider();
        const providerName = config.forwarding?.provider || 'ntfy';
        
        // Prepare notification message
        const severityEmoji = {
            success: '✅',
            info: 'ℹ️',
            warning: '⚠️',
            error: '❌'
        };
        
        const emoji = severityEmoji[notification.severity] || 'ℹ️';
        const title = `${emoji} ${notification.client_name || 'Unknown Client'}`;
        const body = `${notification.message}\n\nEvent: ${notification.event_type}\nClient: ${notification.client_name}\nTime: ${new Date(notification.timestamp || Date.now()).toLocaleString()}`;
        
        try {
            // Map event types to notification types
            const notificationTypeMap = {
                'backup_started': 'success',
                'backup_completed': 'success',
                'backup_failed': 'failure',
                'backup_warning': 'warning',
                'security_alert': 'security_alert',
                'error': 'failure',
                'warning': 'warning',
                'connection_lost': 'warning'
            };
            
            const notificationType = notificationTypeMap[notification.event_type] || 'warning';
            
            // Send using the provider
            if (providerName === 'ntfy') {
                // For ntfy, we send directly with custom title/body
                const result = await provider.sendToNtfy({
                    title,
                    message: body,
                    priority: notification.severity === 'error' ? 'high' : 
                              notification.event_type === 'security_alert' ? 'urgent' : 'default',
                    tags: ['borgmatic', notification.event_type]
                });
                
                if (result.success) {
                    console.log(`📤 Forwarded notification via ntfy: ${notification.event_type} from ${notification.client_name}`);
                }
                
                return result;
            } else {
                // For Apprise, use the notification type method
                const result = await provider.sendNotification(notificationType, {
                    title,
                    body
                });
                
                if (result.success) {
                    console.log(`📤 Forwarded notification via Apprise: ${notification.event_type} from ${notification.client_name}`);
                }
                
                return result;
            }
        } catch (error) {
            console.error('Failed to forward notification:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current status
     */
    async getStatus() {
        const config = await this.loadConfig();
        const provider = await this.getProvider();
        const providerName = config.forwarding?.provider || 'ntfy';
        
        let providerStatus = { available: false };
        try {
            providerStatus = await provider.getNotificationStatus();
        } catch (error) {
            providerStatus = { available: false, error: error.message };
        }
        
        return {
            forwarding_enabled: config.forwarding?.enabled || false,
            provider: providerName,
            events: config.events || [],
            client_filter_mode: config.client_filters?.mode || 'all',
            filtered_client_count: config.client_filters?.client_ids?.length || 0,
            provider_status: providerStatus
        };
    }

    /**
     * Get available event types for configuration
     */
    getAvailableEvents() {
        return [
            { id: 'backup_started', label: 'Backup Started', description: 'When a client starts a backup' },
            { id: 'backup_completed', label: 'Backup Completed', description: 'When a client completes a backup successfully' },
            { id: 'backup_failed', label: 'Backup Failed', description: 'When a client backup fails', recommended: true },
            { id: 'backup_warning', label: 'Backup Warning', description: 'When a backup completes with warnings' },
            { id: 'security_alert', label: 'Security Alert', description: 'Critical security events (always forwarded)', alwaysOn: true },
            { id: 'error', label: 'General Error', description: 'General errors from clients', recommended: true },
            { id: 'warning', label: 'General Warning', description: 'General warnings from clients' },
            { id: 'connection_lost', label: 'Connection Lost', description: 'When a client disconnects unexpectedly' }
        ];
    }
}

module.exports = new DirectorNotificationConfig();
