const yamlManager = require('./yaml-manager');
const path = require('path');
const config = require('../config');

/**
 * Native ntfy Notification Service
 * Sends notifications directly to ntfy server via HTTP
 * No external dependencies - uses native fetch/http
 */
class NtfyService {
    constructor() {
        this.ntfyConfigPath = path.join(config.configDir, 'ntfy.yaml');
        this.defaultConfig = {
            enabled: false,
            server: 'https://ntfy.sh',
            topic: '',
            auth: {
                type: 'none', // none, basic, token
                username: '',
                password: '',
                token: ''
            },
            defaults: {
                priority: 'default', // min, low, default, high, urgent
                tags: ['borgmatic'],
            },
            notifications: {
                success: {
                    enabled: false,
                    title: 'Backup Success',
                    message: 'Backup completed successfully',
                    priority: 'default',
                    tags: ['white_check_mark', 'borgmatic']
                },
                failure: {
                    enabled: true,
                    title: 'Backup Failed',
                    message: 'Backup failed with error',
                    priority: 'high',
                    tags: ['x', 'borgmatic']
                },
                warning: {
                    enabled: true,
                    title: 'Backup Warning',
                    message: 'Backup completed with warnings',
                    priority: 'default',
                    tags: ['warning', 'borgmatic']
                },
                security_alert: {
                    enabled: true,
                    title: '🚨 SECURITY ALERT: Possible Ransomware Detected',
                    message: 'A canary file was modified or deleted. This may indicate ransomware activity. INVESTIGATE IMMEDIATELY!',
                    priority: 'urgent',
                    tags: ['rotating_light', 'skull', 'borgmatic']
                }
            }
        };
        
        // Priority mapping for ntfy
        this.priorityMap = {
            'min': 1,
            'low': 2,
            'default': 3,
            'high': 4,
            'urgent': 5
        };
    }

    /**
     * Load ntfy configuration
     */
    async loadConfig() {
        try {
            const config = await yamlManager.readYaml(this.ntfyConfigPath);
            return config || this.defaultConfig;
        } catch (error) {
            // Return default config if file doesn't exist
            return this.defaultConfig;
        }
    }

    /**
     * Save ntfy configuration
     */
    async saveConfig(configData) {
        try {
            await yamlManager.writeYaml(this.ntfyConfigPath, configData);
            console.log('ntfy configuration saved successfully');
            return true;
        } catch (error) {
            console.error('Failed to save ntfy config:', error.message);
            throw error;
        }
    }

    /**
     * Build authorization header based on auth type
     */
    buildAuthHeader(auth) {
        if (!auth || auth.type === 'none') {
            return null;
        }
        
        if (auth.type === 'token' && auth.token) {
            return `Bearer ${auth.token}`;
        }
        
        if (auth.type === 'basic' && auth.username && auth.password) {
            const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
            return `Basic ${credentials}`;
        }
        
        return null;
    }

    /**
     * Send notification to ntfy server
     */
    async sendToNtfy(options = {}) {
        const config = await this.loadConfig();
        
        if (!config.enabled) {
            return { success: false, message: 'ntfy is not enabled' };
        }
        
        if (!config.topic) {
            return { success: false, message: 'ntfy topic is not configured' };
        }

        const url = `${config.server.replace(/\/$/, '')}/${config.topic}`;
        
        // Build headers
        const headers = {
            'Content-Type': 'text/plain'
        };
        
        // Add title if provided
        if (options.title) {
            headers['Title'] = options.title;
        }
        
        // Add priority
        const priority = options.priority || config.defaults?.priority || 'default';
        headers['Priority'] = String(this.priorityMap[priority] || 3);
        
        // Add tags
        const tags = options.tags || config.defaults?.tags || ['borgmatic'];
        if (tags && tags.length > 0) {
            headers['Tags'] = tags.join(',');
        }
        
        // Add authorization
        const authHeader = this.buildAuthHeader(config.auth);
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }
        
        // Add click action if provided
        if (options.click) {
            headers['Click'] = options.click;
        }
        
        // Add actions if provided
        if (options.actions) {
            headers['Actions'] = options.actions;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: options.message || 'Notification from Borgmatic UI'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ntfy responded with ${response.status}: ${errorText}`);
            }

            const result = await response.json().catch(() => ({}));
            
            return {
                success: true,
                message: 'Notification sent successfully',
                response: result
            };
        } catch (error) {
            console.error('Failed to send ntfy notification:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test connection to ntfy server
     */
    async testConnection(testConfig = null) {
        const config = testConfig || await this.loadConfig();
        
        if (!config.topic) {
            return { 
                success: false, 
                error: 'ntfy topic is not configured' 
            };
        }

        const url = `${(config.server || 'https://ntfy.sh').replace(/\/$/, '')}/${config.topic}`;
        
        // Build headers for test message
        const headers = {
            'Content-Type': 'text/plain',
            'Title': 'Test Notification',
            'Priority': '3',
            'Tags': 'test,borgmatic'
        };
        
        // Add authorization
        const authHeader = this.buildAuthHeader(config.auth);
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: 'This is a test notification from Borgmatic Director UI'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ntfy responded with ${response.status}: ${errorText}`);
            }

            return {
                success: true,
                message: 'Test notification sent successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send notification of a specific type
     */
    async sendNotification(type, customData = {}) {
        try {
            const config = await this.loadConfig();
            
            if (!config.enabled) {
                return { success: false, message: 'ntfy is not enabled' };
            }
            
            const notification = config.notifications?.[type];
            
            if (!notification || !notification.enabled) {
                return { success: false, message: `Notification type '${type}' not configured or disabled` };
            }

            return await this.sendToNtfy({
                title: customData.title || notification.title,
                message: customData.message || customData.body || notification.message,
                priority: customData.priority || notification.priority,
                tags: customData.tags || notification.tags,
                click: customData.click,
                actions: customData.actions
            });
        } catch (error) {
            console.error(`Failed to send ${type} notification:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send success notification
     */
    async sendSuccessNotification(customData = {}) {
        return await this.sendNotification('success', customData);
    }

    /**
     * Send failure notification
     */
    async sendFailureNotification(customData = {}) {
        return await this.sendNotification('failure', customData);
    }

    /**
     * Send warning notification
     */
    async sendWarningNotification(customData = {}) {
        return await this.sendNotification('warning', customData);
    }

    /**
     * Send security alert notification (for ransomware/canary detection)
     */
    async sendSecurityAlert(customData = {}) {
        console.log('🚨 SECURITY ALERT: Sending ransomware detection notification via ntfy...');
        const result = await this.sendNotification('security_alert', {
            title: customData.title || '🚨 SECURITY ALERT: Possible Ransomware Detected',
            message: customData.body || customData.message || 'A canary file was modified or deleted. This may indicate ransomware activity. Backups have been stopped. INVESTIGATE IMMEDIATELY!',
            priority: 'urgent',
            ...customData
        });
        
        if (result.success) {
            console.log('✅ Security alert notification sent via ntfy');
        } else {
            console.error('❌ Failed to send security alert via ntfy:', result.error || result.message);
        }
        
        return result;
    }

    /**
     * Get notification status
     */
    async getNotificationStatus() {
        try {
            const config = await this.loadConfig();
            
            return {
                enabled: config.enabled || false,
                server: config.server || 'https://ntfy.sh',
                topic: config.topic || '',
                auth_type: config.auth?.type || 'none',
                has_auth: config.auth?.type !== 'none' && (config.auth?.token || (config.auth?.username && config.auth?.password)),
                notifications: {
                    success: {
                        enabled: config.notifications?.success?.enabled || false
                    },
                    failure: {
                        enabled: config.notifications?.failure?.enabled || false
                    },
                    warning: {
                        enabled: config.notifications?.warning?.enabled || false
                    },
                    security_alert: {
                        enabled: config.notifications?.security_alert?.enabled || false
                    }
                }
            };
        } catch (error) {
            console.error('Failed to get ntfy notification status:', error.message);
            return {
                enabled: false,
                error: error.message
            };
        }
    }

    /**
     * Update specific notification type settings
     */
    async updateNotificationSettings(type, settings) {
        try {
            const config = await this.loadConfig();
            
            if (!config.notifications) {
                config.notifications = {};
            }
            
            if (!config.notifications[type]) {
                config.notifications[type] = {
                    enabled: false,
                    title: '',
                    message: '',
                    priority: 'default',
                    tags: ['borgmatic']
                };
            }

            config.notifications[type] = {
                ...config.notifications[type],
                ...settings
            };

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update notification settings:', error.message);
            throw error;
        }
    }

    /**
     * Enable/disable a notification type
     */
    async setNotificationEnabled(type, enabled) {
        try {
            const config = await this.loadConfig();
            
            if (!config.notifications) {
                config.notifications = {};
            }
            
            if (!config.notifications[type]) {
                config.notifications[type] = this.defaultConfig.notifications[type] || {
                    enabled: false,
                    title: '',
                    message: '',
                    priority: 'default',
                    tags: ['borgmatic']
                };
            }

            config.notifications[type].enabled = enabled;
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to set notification enabled:', error.message);
            throw error;
        }
    }

    /**
     * Get available priority levels
     */
    getPriorityLevels() {
        return [
            { value: 'min', label: 'Min', description: 'Lowest priority, no sound' },
            { value: 'low', label: 'Low', description: 'Low priority notification' },
            { value: 'default', label: 'Default', description: 'Standard notification' },
            { value: 'high', label: 'High', description: 'High priority, shows prominently' },
            { value: 'urgent', label: 'Urgent', description: 'Maximum priority, bypasses DND' }
        ];
    }
}

module.exports = new NtfyService();
