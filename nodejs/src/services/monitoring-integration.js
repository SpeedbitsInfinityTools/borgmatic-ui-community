const borgmaticConfig = require('./borgmatic-config');
const borgmaticCLI = require('./borgmatic-cli');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');

/**
 * Monitoring Integration Service
 * Integrates with Borgmatic's monitoring hooks and external services
 * Based on: https://torsion.org/borgmatic/docs/how-to/monitor-your-backups/
 */
class MonitoringIntegration {
    constructor() {
        this.isEnabled = true;
        this.monitoringServices = new Map();
        this.hookScripts = new Map();
    }

    /**
     * Initialize monitoring integration
     */
    async initialize() {
        try {
            const config = await borgmaticConfig.loadConfig();
            const monitoring = config.monitoring || {};
            
            // Initialize monitoring services
            await this.initializeMonitoringServices(monitoring);
            
            // Initialize hook scripts
            await this.initializeHookScripts(config.hooks || {});
            
            console.log('📡 Monitoring integration initialized');
        } catch (error) {
            console.error('Failed to initialize monitoring integration:', error.message);
        }
    }

    /**
     * Initialize monitoring services based on configuration
     */
    async initializeMonitoringServices(monitoring) {
        // Apprise integration
        if (monitoring.apprise?.urls?.length > 0) {
            this.monitoringServices.set('apprise', {
                type: 'apprise',
                urls: monitoring.apprise.urls,
                send_logs: monitoring.apprise.send_logs !== false,
                log_bytes: monitoring.apprise.log_bytes || 10000
            });
        }

        // Healthchecks integration
        if (monitoring.healthchecks?.ping_url) {
            this.monitoringServices.set('healthchecks', {
                type: 'healthchecks',
                ping_url: monitoring.healthchecks.ping_url,
                send_logs: monitoring.healthchecks.send_logs !== false,
                log_bytes: monitoring.healthchecks.log_bytes || 10000
            });
        }

        // Cronitor integration
        if (monitoring.cronitor?.ping_url) {
            this.monitoringServices.set('cronitor', {
                type: 'cronitor',
                ping_url: monitoring.cronitor.ping_url,
                send_logs: monitoring.cronitor.send_logs !== false,
                log_bytes: monitoring.cronitor.log_bytes || 10000
            });
        }

        // Cronhub integration
        if (monitoring.cronhub?.ping_url) {
            this.monitoringServices.set('cronhub', {
                type: 'cronhub',
                ping_url: monitoring.cronhub.ping_url,
                send_logs: monitoring.cronhub.send_logs !== false,
                log_bytes: monitoring.cronhub.log_bytes || 10000
            });
        }

        // PagerDuty integration
        if (monitoring.pagerduty?.integration_key) {
            this.monitoringServices.set('pagerduty', {
                type: 'pagerduty',
                integration_key: monitoring.pagerduty.integration_key,
                send_logs: monitoring.pagerduty.send_logs !== false,
                log_bytes: monitoring.pagerduty.log_bytes || 10000
            });
        }

        // Uptime Kuma integration
        if (monitoring.uptime_kuma?.push_url) {
            this.monitoringServices.set('uptime_kuma', {
                type: 'uptime_kuma',
                push_url: monitoring.uptime_kuma.push_url,
                send_logs: monitoring.uptime_kuma.send_logs !== false,
                log_bytes: monitoring.uptime_kuma.log_bytes || 10000
            });
        }

        // Zabbix integration
        if (monitoring.zabbix?.server) {
            this.monitoringServices.set('zabbix', {
                type: 'zabbix',
                server: monitoring.zabbix.server,
                username: monitoring.zabbix.username,
                password: monitoring.zabbix.password,
                api_key: monitoring.zabbix.api_key,
                host: monitoring.zabbix.host,
                key: monitoring.zabbix.key,
                itemid: monitoring.zabbix.itemid
            });
        }
    }

    /**
     * Initialize hook scripts
     */
    async initializeHookScripts(hooks) {
        const hookTypes = [
            'before_backup', 'after_backup', 'on_error',
            'before_prune', 'after_prune',
            'before_check', 'after_check',
            'before_compact', 'after_compact'
        ];

        for (const hookType of hookTypes) {
            if (hooks[hookType]?.length > 0) {
                this.hookScripts.set(hookType, hooks[hookType]);
            }
        }
    }

    /**
     * Send monitoring notification
     */
    async sendNotification(serviceType, state, data = {}) {
        try {
            const service = this.monitoringServices.get(serviceType);
            if (!service) {
                console.warn(`Monitoring service ${serviceType} not configured`);
                return;
            }

            switch (service.type) {
                case 'apprise':
                    await this.sendAppriseNotification(service, state, data);
                    break;
                case 'healthchecks':
                    await this.sendHealthchecksNotification(service, state, data);
                    break;
                case 'cronitor':
                    await this.sendCronitorNotification(service, state, data);
                    break;
                case 'cronhub':
                    await this.sendCronhubNotification(service, state, data);
                    break;
                case 'pagerduty':
                    await this.sendPagerDutyNotification(service, state, data);
                    break;
                case 'uptime_kuma':
                    await this.sendUptimeKumaNotification(service, state, data);
                    break;
                case 'zabbix':
                    await this.sendZabbixNotification(service, state, data);
                    break;
                default:
                    console.warn(`Unknown monitoring service type: ${service.type}`);
            }
        } catch (error) {
            console.error(`Failed to send ${serviceType} notification:`, error.message);
        }
    }

    /**
     * Send Apprise notification
     */
    async sendAppriseNotification(service, state, data) {
        const { urls, send_logs, log_bytes } = service;
        
        for (const urlConfig of urls) {
            try {
                const message = this.formatAppriseMessage(state, data, send_logs, log_bytes);
                await this.sendHttpRequest(urlConfig.url, 'POST', message);
            } catch (error) {
                console.error(`Failed to send Apprise notification to ${urlConfig.url}:`, error.message);
            }
        }
    }

    /**
     * Send Healthchecks notification
     */
    async sendHealthchecksNotification(service, state, data) {
        const { ping_url, send_logs, log_bytes } = service;
        
        try {
            let url = ping_url;
            if (state === 'fail') {
                url = ping_url.replace('/ping/', '/fail/');
            }
            
            if (send_logs && data.logs) {
                const logs = this.truncateLogs(data.logs, log_bytes);
                await this.sendHttpRequest(url, 'POST', logs);
            } else {
                await this.sendHttpRequest(url, 'GET');
            }
        } catch (error) {
            console.error('Failed to send Healthchecks notification:', error.message);
        }
    }

    /**
     * Send Cronitor notification
     */
    async sendCronitorNotification(service, state, data) {
        const { ping_url } = service;
        
        try {
            let url = ping_url;
            if (state === 'fail') {
                url = ping_url.replace('/start/', '/fail/');
            } else if (state === 'finish') {
                url = ping_url.replace('/start/', '/complete/');
            }
            
            await this.sendHttpRequest(url, 'GET');
        } catch (error) {
            console.error('Failed to send Cronitor notification:', error.message);
        }
    }

    /**
     * Send Cronhub notification
     */
    async sendCronhubNotification(service, state, data) {
        const { ping_url } = service;
        
        try {
            let url = ping_url;
            if (state === 'fail') {
                url = ping_url.replace('/start/', '/fail/');
            } else if (state === 'finish') {
                url = ping_url.replace('/start/', '/finish/');
            }
            
            await this.sendHttpRequest(url, 'GET');
        } catch (error) {
            console.error('Failed to send Cronhub notification:', error.message);
        }
    }

    /**
     * Send PagerDuty notification
     */
    async sendPagerDutyNotification(service, state, data) {
        const { integration_key } = service;
        
        if (state !== 'fail') return; // PagerDuty only sends on failure
        
        try {
            const payload = {
                routing_key: integration_key,
                event_action: 'trigger',
                dedup_key: `borgmatic-${data.repository || 'unknown'}`,
                payload: {
                    summary: `Borgmatic backup failed: ${data.message || 'Unknown error'}`,
                    source: 'borgmatic',
                    severity: 'critical',
                    custom_details: data
                }
            };
            
            await this.sendHttpRequest('https://events.pagerduty.com/v2/enqueue', 'POST', payload);
        } catch (error) {
            console.error('Failed to send PagerDuty notification:', error.message);
        }
    }

    /**
     * Send Uptime Kuma notification
     */
    async sendUptimeKumaNotification(service, state, data) {
        const { push_url } = service;
        
        try {
            let url = push_url;
            if (state === 'fail') {
                url += '?status=down&msg=' + encodeURIComponent(data.message || 'Backup failed');
            } else if (state === 'finish') {
                url += '?status=up&msg=' + encodeURIComponent('Backup completed successfully');
            } else {
                url += '?status=up&msg=' + encodeURIComponent('Backup started');
            }
            
            await this.sendHttpRequest(url, 'GET');
        } catch (error) {
            console.error('Failed to send Uptime Kuma notification:', error.message);
        }
    }

    /**
     * Send Zabbix notification
     */
    async sendZabbixNotification(service, state, data) {
        const { server, username, password, api_key, host, key, itemid } = service;
        
        try {
            // Authenticate with Zabbix
            const authToken = await this.authenticateZabbix(server, username, password, api_key);
            
            // Send data to Zabbix
            const payload = {
                jsonrpc: '2.0',
                method: 'sender.send',
                params: {
                    host: host,
                    key: key,
                    value: state.toUpperCase(),
                    clock: Math.floor(Date.now() / 1000)
                },
                id: 1,
                auth: authToken
            };
            
            await this.sendHttpRequest(server, 'POST', payload);
        } catch (error) {
            console.error('Failed to send Zabbix notification:', error.message);
        }
    }

    /**
     * Authenticate with Zabbix
     */
    async authenticateZabbix(server, username, password, api_key) {
        const payload = {
            jsonrpc: '2.0',
            method: 'user.login',
            params: api_key ? { api_key } : { user: username, password },
            id: 1
        };
        
        const response = await this.sendHttpRequest(server, 'POST', payload);
        return response.result;
    }

    /**
     * Send HTTP request
     */
    async sendHttpRequest(url, method = 'GET', data = null) {
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');
        
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'borgmatic-ui/1.0'
                }
            };

            const req = client.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const result = responseData ? JSON.parse(responseData) : {};
                            resolve(result);
                        } catch (parseError) {
                            resolve({ success: true, data: responseData });
                        }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data && method !== 'GET') {
                const postData = JSON.stringify(data);
                options.headers['Content-Length'] = Buffer.byteLength(postData);
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * Format Apprise message
     */
    formatAppriseMessage(state, data, sendLogs, logBytes) {
        const messages = {
            start: {
                title: 'Backup Started',
                body: `Borgmatic backup started for repository: ${data.repository || 'unknown'}`
            },
            finish: {
                title: 'Backup Completed',
                body: `Borgmatic backup completed successfully for repository: ${data.repository || 'unknown'}`
            },
            fail: {
                title: 'Backup Failed',
                body: `Borgmatic backup failed for repository: ${data.repository || 'unknown'}\nError: ${data.message || 'Unknown error'}`
            }
        };

        const message = messages[state] || messages.fail;
        let body = message.body;

        if (sendLogs && data.logs) {
            const logs = this.truncateLogs(data.logs, logBytes);
            body += `\n\nLogs:\n${logs}`;
        }

        return {
            title: message.title,
            body: body,
            format: 'text'
        };
    }

    /**
     * Truncate logs to specified byte limit
     */
    truncateLogs(logs, maxBytes) {
        if (!logs || typeof logs !== 'string') return '';
        
        if (Buffer.byteLength(logs, 'utf8') <= maxBytes) {
            return logs;
        }
        
        // Truncate from the end to keep the most recent logs
        const truncated = logs.slice(-maxBytes);
        return `... (truncated)\n${truncated}`;
    }

    /**
     * Execute hook scripts
     */
    async executeHookScripts(hookType, data = {}) {
        const scripts = this.hookScripts.get(hookType);
        if (!scripts || scripts.length === 0) return;

        for (const script of scripts) {
            try {
                await this.executeScript(script, data);
            } catch (error) {
                console.error(`Failed to execute ${hookType} script ${script}:`, error.message);
            }
        }
    }

    /**
     * Execute a single script
     */
    async executeScript(script, data = {}) {
        // Set environment variables for the script
        const env = {
            ...process.env,
            BORGMATIC_REPOSITORY: data.repository || '',
            BORGMATIC_ARCHIVE: data.archive || '',
            BORGMATIC_STATUS: data.status || '',
            BORGMATIC_MESSAGE: data.message || ''
        };

        // Execute the script
        await execa('bash', ['-c', script], { env });
    }

    /**
     * Handle backup lifecycle events
     */
    async handleBackupEvent(eventType, data) {
        try {
            // Execute hook scripts
            await this.executeHookScripts(eventType, data);
            
            // Send monitoring notifications
            for (const [serviceType] of this.monitoringServices) {
                await this.sendNotification(serviceType, this.mapEventToState(eventType), data);
            }
            
            // Note: Internal events for web UI are handled by the events route
            // This service focuses on external monitoring integrations
            
        } catch (error) {
            console.error(`Failed to handle backup event ${eventType}:`, error.message);
        }
    }

    /**
     * Map event type to monitoring state
     */
    mapEventToState(eventType) {
        const mapping = {
            'before_backup': 'start',
            'after_backup': 'finish',
            'on_error': 'fail',
            'before_prune': 'start',
            'after_prune': 'finish',
            'before_check': 'start',
            'after_check': 'finish',
            'before_compact': 'start',
            'after_compact': 'finish'
        };
        
        return mapping[eventType] || 'start';
    }

    /**
     * Get monitoring status
     */
    getStatus() {
        return {
            enabled: this.isEnabled,
            services: Array.from(this.monitoringServices.keys()),
            hooks: Array.from(this.hookScripts.keys()),
            timestamp: new Date().toISOString()
        };
    }
}

// Export singleton instance
module.exports = new MonitoringIntegration();
