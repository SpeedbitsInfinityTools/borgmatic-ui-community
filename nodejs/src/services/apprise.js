const { exec } = require('child_process');
const { promisify } = require('util');
const yamlManager = require('./yaml-manager');
const path = require('path');
const config = require('../config');

const execAsync = promisify(exec);

// Cache for apprise availability check
let appriseCliAvailable = null;
let appriseCheckTime = 0;
const APPRISE_CHECK_CACHE_MS = 60000; // Cache for 1 minute

/**
 * Apprise Integration Service
 * Handles notifications through Apprise for borgmatic hooks
 * Supports both CLI mode (local apprise command) and API mode (Apprise server)
 */
class AppriseService {
    constructor() {
        this.appriseConfigPath = path.join(config.configDir, 'apprise.yaml');
        this.defaultConfig = {
            // API mode configuration (for Apprise server like infinity-apprise)
            api: {
                enabled: false,
                url: '',  // e.g., 'http://infinity-apprise:8000'
                key: 'borgmatic'  // Apprise stateless key or config key
            },
            notifications: {
                success: {
                    enabled: false,  // Off by default - can be noisy
                    urls: [],
                    title: 'Backup Success',
                    body: 'Backup completed successfully'
                },
                failure: {
                    enabled: true,  // On by default - important to know about failures
                    urls: [],
                    title: 'Backup Failed',
                    body: 'Backup failed with error'
                },
                warning: {
                    enabled: true,  // On by default - warnings may need attention
                    urls: [],
                    title: 'Backup Warning',
                    body: 'Backup completed with warnings'
                },
                security_alert: {
                    enabled: true,  // On by default - critical security alerts
                    urls: [],
                    title: '🚨 SECURITY ALERT: Possible Ransomware Detected',
                    body: 'A canary file was modified or deleted. This may indicate ransomware activity. Backups have been stopped. INVESTIGATE IMMEDIATELY!'
                }
            },
            settings: {
                timeout: 30,
                retry_attempts: 3,
                retry_delay: 5
            }
        };
    }

    /**
     * Load Apprise configuration
     */
    async loadConfig() {
        try {
            const config = await yamlManager.readYaml(this.appriseConfigPath);
            // Merge with defaults to ensure all fields exist
            return {
                ...this.defaultConfig,
                ...config,
                api: { ...this.defaultConfig.api, ...config?.api },
                notifications: {
                    ...this.defaultConfig.notifications,
                    ...config?.notifications
                },
                settings: { ...this.defaultConfig.settings, ...config?.settings }
            };
        } catch (error) {
            console.error('Failed to load Apprise config:', error.message);
            return this.defaultConfig;
        }
    }

    /**
     * Save Apprise configuration
     */
    async saveConfig(configData) {
        try {
            await yamlManager.writeYaml(this.appriseConfigPath, configData);
            console.log('Apprise configuration saved successfully');
            return true;
        } catch (error) {
            console.error('Failed to save Apprise config:', error.message);
            throw error;
        }
    }

    /**
     * Check if apprise CLI command is available on the system
     */
    async isAppriseCliAvailable() {
        // Return cached result if still valid
        if (appriseCliAvailable !== null && (Date.now() - appriseCheckTime) < APPRISE_CHECK_CACHE_MS) {
            return appriseCliAvailable;
        }

        try {
            await execAsync('which apprise || command -v apprise', { timeout: 5000 });
            appriseCliAvailable = true;
            appriseCheckTime = Date.now();
            return true;
        } catch (error) {
            console.warn('⚠️ Apprise CLI is not installed or not in PATH.');
            appriseCliAvailable = false;
            appriseCheckTime = Date.now();
            return false;
        }
    }

    /**
     * Check if Apprise API server is available
     */
    async isAppriseApiAvailable() {
        try {
            const config = await this.loadConfig();
            if (!config.api?.enabled || !config.api?.url) {
                return false;
            }

            // Try to reach the Apprise API health endpoint
            const response = await fetch(`${config.api.url}/status`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            return response.ok;
        } catch (error) {
            console.warn('⚠️ Apprise API server not reachable:', error.message);
            return false;
        }
    }

    /**
     * Check if Apprise is available (either CLI or API)
     */
    async isAppriseAvailable() {
        const config = await this.loadConfig();

        // If API mode is enabled, check API availability
        if (config.api?.enabled && config.api?.url) {
            return await this.isAppriseApiAvailable();
        }

        // Otherwise check CLI availability
        return await this.isAppriseCliAvailable();
    }

    /**
     * Test Apprise API connection
     */
    async testApiConnection(apiUrl) {
        try {
            // Validate URL format first
            let parsedUrl;
            try {
                parsedUrl = new URL(apiUrl);
            } catch (e) {
                return {
                    success: false,
                    error: `Invalid URL format. Please enter a valid URL like http://infinity-apprise:8000`
                };
            }

            const response = await fetch(`${apiUrl}/status`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
                return {
                    success: true,
                    message: 'Apprise API server is reachable'
                };
            } else {
                return {
                    success: false,
                    error: `Apprise API returned status ${response.status}. Is the Apprise server running?`
                };
            }
        } catch (error) {
            // Provide user-friendly error messages based on error type
            const errorCode = error.cause?.code || error.code;
            const hostname = (() => {
                try { return new URL(apiUrl).hostname; } catch { return apiUrl; }
            })();

            if (errorCode === 'ECONNREFUSED') {
                return {
                    success: false,
                    error: `Connection refused. The Apprise server at "${hostname}" is not accepting connections. Make sure the Apprise container is running.`
                };
            } else if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
                return {
                    success: false,
                    error: `Cannot resolve hostname "${hostname}". If using Docker, make sure the Apprise container is running and both containers are on the same network (infinity-notifications).`
                };
            } else if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
                return {
                    success: false,
                    error: `Connection timed out. The Apprise server at "${hostname}" is not responding. Check if the server is running and the port is correct.`
                };
            } else if (error.message?.includes('fetch failed')) {
                return {
                    success: false,
                    error: `Cannot connect to "${hostname}". Possible causes:\n• Apprise container is not running\n• Wrong hostname or port\n• Containers not on the same Docker network\n\nFor Infinity Tools, use: http://infinity-apprise:8000`
                };
            } else {
                return {
                    success: false,
                    error: `Connection failed: ${error.message}. Check if the Apprise server is running and accessible.`
                };
            }
        }
    }

    /**
     * Test Apprise connection (CLI or API based on config)
     */
    async testConnection(url) {
        try {
            const config = await this.loadConfig();

            // If API mode is enabled, test via API
            if (config.api?.enabled && config.api?.url) {
                return await this.testConnectionViaApi(url, config);
            }

            // Otherwise test via CLI
            return await this.testConnectionViaCli(url);
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test connection via Apprise CLI
     */
    async testConnectionViaCli(url) {
        if (!await this.isAppriseCliAvailable()) {
            return {
                success: false,
                error: 'Apprise CLI is not installed. Please install it with Infinity Tools (under Infinity Apps) or manually with: pip install apprise'
            };
        }

        const testCommand = `apprise -vv -t "Test Notification" -b "This is a test notification from Borgmatic UI" "${url}"`;
        const { stdout, stderr } = await execAsync(testCommand, { timeout: 30000 });

        return {
            success: true,
            output: stdout,
            error: stderr,
            mode: 'cli'
        };
    }

    /**
     * Test connection via Apprise API
     */
    async testConnectionViaApi(url, config) {
        try {
            const apiUrl = config.api.url;

            // Use the stateless notify endpoint with URLs in the body
            const response = await fetch(`${apiUrl}/notify/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    urls: url,
                    title: 'Test Notification',
                    body: 'This is a test notification from Borgmatic UI',
                    type: 'info'
                }),
                signal: AbortSignal.timeout(30000)
            });

            const result = await response.json().catch(() => ({}));

            if (response.ok) {
                return {
                    success: true,
                    message: 'Test notification sent via Apprise API',
                    mode: 'api'
                };
            } else {
                return {
                    success: false,
                    error: result.error || `API returned status ${response.status}`,
                    mode: 'api'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                mode: 'api'
            };
        }
    }

    /**
     * Send notification via Apprise API
     */
    async sendNotificationViaApi(urls, title, body, config) {
        try {
            const apiUrl = config.api.url;

            // Join URLs if array
            const urlString = Array.isArray(urls) ? urls.join(',') : urls;

            const response = await fetch(`${apiUrl}/notify/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    urls: urlString,
                    title: title,
                    body: body,
                    type: 'info'
                }),
                signal: AbortSignal.timeout(config.settings?.timeout ? config.settings.timeout * 1000 : 30000)
            });

            const result = await response.json().catch(() => ({}));

            if (response.ok) {
                return {
                    success: true,
                    message: 'Notification sent via Apprise API',
                    mode: 'api'
                };
            } else {
                return {
                    success: false,
                    error: result.error || `API returned status ${response.status}`,
                    mode: 'api'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                mode: 'api'
            };
        }
    }

    /**
     * Send notification via Apprise CLI
     */
    async sendNotificationViaCli(urls, title, body, config) {
        if (!await this.isAppriseCliAvailable()) {
            return {
                success: false,
                message: 'Apprise CLI not installed',
                apprise_not_installed: true,
                mode: 'cli'
            };
        }

        // Join URLs if array
        const urlString = Array.isArray(urls) ? urls.join(' ') : urls;

        // Escape quotes in title and body to prevent command injection
        const safeTitle = title.replace(/"/g, '\\"');
        const safeBody = body.replace(/"/g, '\\"');

        const command = `apprise -vv -t "${safeTitle}" -b "${safeBody}" ${urlString}`;
        const { stdout, stderr } = await execAsync(command, {
            timeout: config.settings?.timeout ? config.settings.timeout * 1000 : 30000
        });

        return {
            success: true,
            output: stdout,
            error: stderr,
            mode: 'cli'
        };
    }

    /**
     * Send notification
     */
    async sendNotification(type, customData = {}) {
        try {
            const config = await this.loadConfig();
            const notification = config.notifications[type];

            if (!notification || !notification.enabled || !notification.urls.length) {
                return { success: false, message: 'Notification not configured' };
            }

            const title = customData.title || notification.title;
            const body = customData.body || notification.body;
            const urls = notification.urls;

            // Use API mode if enabled
            if (config.api?.enabled && config.api?.url) {
                return await this.sendNotificationViaApi(urls, title, body, config);
            }

            // Otherwise use CLI mode
            return await this.sendNotificationViaCli(urls, title, body, config);
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
     * This is a critical alert that should always be sent if configured
     */
    async sendSecurityAlert(customData = {}) {
        console.log('🚨 SECURITY ALERT: Sending ransomware detection notification...');
        const result = await this.sendNotification('security_alert', {
            title: customData.title || '🚨 SECURITY ALERT: Possible Ransomware Detected',
            body: customData.body || 'A canary file was modified or deleted. This may indicate ransomware activity. Backups have been stopped. INVESTIGATE IMMEDIATELY!',
            ...customData
        });

        if (result.success) {
            console.log('✅ Security alert notification sent successfully');
        } else {
            console.error('❌ Failed to send security alert notification:', result.error || result.message);
        }

        return result;
    }

    /**
     * Add notification URL
     */
    async addNotificationUrl(type, url) {
        try {
            const config = await this.loadConfig();

            if (!config.notifications[type]) {
                config.notifications[type] = {
                    enabled: false,
                    urls: [],
                    title: '',
                    body: ''
                };
            }

            if (!config.notifications[type].urls.includes(url)) {
                config.notifications[type].urls.push(url);
            }

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add notification URL:', error.message);
            throw error;
        }
    }

    /**
     * Remove notification URL
     */
    async removeNotificationUrl(type, url) {
        try {
            const config = await this.loadConfig();

            if (config.notifications[type] && config.notifications[type].urls) {
                config.notifications[type].urls = config.notifications[type].urls.filter(u => u !== url);
            }

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to remove notification URL:', error.message);
            throw error;
        }
    }

    /**
     * Enable/disable notification type
     */
    async setNotificationEnabled(type, enabled) {
        try {
            const config = await this.loadConfig();

            if (!config.notifications[type]) {
                config.notifications[type] = {
                    enabled: false,
                    urls: [],
                    title: '',
                    body: ''
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
     * Update notification settings
     */
    async updateNotificationSettings(type, settings) {
        try {
            const config = await this.loadConfig();

            if (!config.notifications[type]) {
                config.notifications[type] = {
                    enabled: false,
                    urls: [],
                    title: '',
                    body: ''
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
     * Update API configuration
     */
    async updateApiConfig(apiConfig) {
        try {
            const config = await this.loadConfig();
            config.api = {
                ...config.api,
                ...apiConfig
            };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update API config:', error.message);
            throw error;
        }
    }

    /**
     * Get supported notification services
     */
    getSupportedServices() {
        return {
            ntfy: {
                name: 'ntfy',
                description: 'Simple push notifications (recommended)',
                example: 'ntfy://hostname/topic'
            },
            email: {
                name: 'Email',
                description: 'Send notifications via email',
                example: 'mailto://user:pass@gmail.com'
            },
            discord: {
                name: 'Discord',
                description: 'Send notifications to Discord webhook',
                example: 'discord://webhook_id/webhook_token'
            },
            slack: {
                name: 'Slack',
                description: 'Send notifications to Slack',
                example: 'slack://token@channel'
            },
            telegram: {
                name: 'Telegram',
                description: 'Send notifications to Telegram',
                example: 'tgram://bot_token/chat_id'
            },
            webhook: {
                name: 'Webhook',
                description: 'Send notifications to custom webhook',
                example: 'https://hooks.slack.com/services/...'
            },
            gotify: {
                name: 'Gotify',
                description: 'Send notifications to Gotify server',
                example: 'gotify://hostname/token'
            },
            pushover: {
                name: 'Pushover',
                description: 'Send notifications via Pushover',
                example: 'pover://user@token'
            }
        };
    }

    /**
     * Generate borgmatic hooks for Apprise
     */
    async generateBorgmaticHooks() {
        try {
            const config = await this.loadConfig();
            const hooks = [];

            // Success notification
            if (config.notifications.success.enabled && config.notifications.success.urls.length > 0) {
                const urls = config.notifications.success.urls.join(' ');
                hooks.push({
                    type: 'after_backup',
                    command: `apprise -vv -t "${config.notifications.success.title}" -b "${config.notifications.success.body}" ${urls}`
                });
            }

            // Failure notification
            if (config.notifications.failure.enabled && config.notifications.failure.urls.length > 0) {
                const urls = config.notifications.failure.urls.join(' ');
                hooks.push({
                    type: 'on_error',
                    command: `apprise -vv -t "${config.notifications.failure.title}" -b "${config.notifications.failure.body}" ${urls}`
                });
            }

            return hooks;
        } catch (error) {
            console.error('Failed to generate borgmatic hooks:', error.message);
            return [];
        }
    }

    /**
     * Get notification status
     */
    async getNotificationStatus() {
        try {
            const config = await this.loadConfig();
            const cliAvailable = await this.isAppriseCliAvailable();
            const apiAvailable = config.api?.enabled ? await this.isAppriseApiAvailable() : false;

            return {
                apprise_installed: cliAvailable || apiAvailable,
                cli_available: cliAvailable,
                api_enabled: config.api?.enabled || false,
                api_available: apiAvailable,
                api_url: config.api?.url || '',
                mode: config.api?.enabled ? 'api' : 'cli',
                success: {
                    enabled: config.notifications.success?.enabled || false,
                    urlCount: config.notifications.success?.urls?.length || 0
                },
                failure: {
                    enabled: config.notifications.failure?.enabled || false,
                    urlCount: config.notifications.failure?.urls?.length || 0
                },
                warning: {
                    enabled: config.notifications.warning?.enabled || false,
                    urlCount: config.notifications.warning?.urls?.length || 0
                },
                security_alert: {
                    enabled: config.notifications.security_alert?.enabled || false,
                    urlCount: config.notifications.security_alert?.urls?.length || 0
                }
            };
        } catch (error) {
            console.error('Failed to get notification status:', error.message);
            return {
                apprise_installed: false,
                error: error.message
            };
        }
    }
}

module.exports = new AppriseService();
