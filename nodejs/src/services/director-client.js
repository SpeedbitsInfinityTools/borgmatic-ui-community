const { io } = require('socket.io-client');
const identityManager = require('./identity-manager');
const config = require('../config');
const crypto = require('crypto');

/**
 * Director Client Service
 * Handles WebSocket connection from Client to Director
 * Implements challenge-response authentication and command handling
 */
class DirectorClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5; // Reduced from 10
        this.reconnectDelay = 10000; // 10 seconds (increased from 5)
        this.heartbeatInterval = null;
        this.commandHandlers = new Map();
        this.connectionErrorLogged = false; // Prevent log spam

        // Authentication failure tracking for smart backoff
        this.authFailureCount = 0;
        this.maxAuthFailures = 5; // Reduced from 10
        this.lastAuthFailure = null;
        this.authBackoffDuration = 60 * 60 * 1000; // 1 hour in milliseconds
    }

    /**
     * Initialize and connect to Director
     */
    async connect() {
        try {
            // Check if we're in authentication backoff period
            if (this.authFailureCount >= this.maxAuthFailures && this.lastAuthFailure) {
                const timeSinceLastFailure = Date.now() - this.lastAuthFailure;
                if (timeSinceLastFailure < this.authBackoffDuration) {
                    const remainingMinutes = Math.ceil((this.authBackoffDuration - timeSinceLastFailure) / 60000);
                    console.log(`⏸️  Authentication backoff active. ${this.authFailureCount} failed attempts. Will retry in ${remainingMinutes} minutes.`);
                    return {
                        success: false,
                        reason: 'auth_backoff',
                        error: `Too many authentication failures. Retry in ${remainingMinutes} minutes.`,
                        backoff_remaining: remainingMinutes
                    };
                } else {
                    // Backoff period expired, reset counter
                    console.log('🔄 Authentication backoff expired, resetting failure count');
                    this.authFailureCount = 0;
                    this.lastAuthFailure = null;
                }
            }

            // If already connected, disconnect first to avoid multiple connections
            if (this.socket && this.socket.connected) {
                console.log('⚠️  Existing connection detected, disconnecting first...');
                this.disconnect();
                // Wait a bit for clean disconnect
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const identity = await identityManager.getIdentity();

            if (!identity || identity.mode !== 'client') {
                console.log('⏭️ Not in client mode - skipping Director connection');
                return { success: false, reason: 'not_client_mode', error: 'Not in client mode' };
            }

            if (!identity.director_url) {
                console.log('⏭️ No Director URL configured - running standalone');
                return { success: false, reason: 'no_director_configured', error: 'No Director URL configured' };
            }

            // Use the full URL as provided (includes protocol and port)
            const directorUrl = identity.director_url;
            const isSecure = directorUrl.startsWith('https://');

            console.log(`🔌 Connecting to Director: ${directorUrl}`);

            if (!isSecure) {
                console.warn(`⚠️  SSL/TLS DISABLED - Connection to Director is NOT encrypted!`);
                console.warn(`⚠️  Use https:// for secure communication`);
            }

            // Create Socket.IO client
            // For secure connections, we need to configure the underlying agent
            const isSecureConnection = directorUrl.startsWith('https://');
            const socketOptions = {
                transports: ['websocket', 'polling'],
                reconnection: false, // Disable auto-reconnection - we handle it manually
                timeout: 15000, // 15 second connection timeout
                auth: {
                    client_id: identity.client_id,
                    connection_token: identity.connection_token
                },
            };

            // For HTTPS, configure the agent to accept self-signed certs
            if (isSecureConnection) {
                const https = require('https');
                socketOptions.agent = new https.Agent({
                    rejectUnauthorized: false // Allow self-signed certs
                });
                // Also set for the websocket transport
                socketOptions.rejectUnauthorized = false;
            }

            this.socket = io(directorUrl, socketOptions);
            this.connectionErrorLogged = false; // Reset for new connection

            // Setup event handlers
            this.setupEventHandlers();

            // Wait for connection to succeed or fail (with timeout)
            return await this.waitForConnection(10000); // 10 second timeout
        } catch (error) {
            console.error('Failed to connect to Director:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Wait for connection to succeed or fail
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    waitForConnection(timeout = 10000) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                cleanup();
                resolve({
                    success: false,
                    error: 'Connection timeout - Director server not responding. Check hostname and port.'
                });
            }, timeout);

            const cleanup = () => {
                clearTimeout(timer);
                // Check if socket still exists before trying to remove listeners
                if (this.socket) {
                    this.socket.off('connect', onConnect);
                    this.socket.off('connect_error', onError);
                    this.socket.off('auth:rejected', onAuthRejected);
                    this.socket.off('auth:approved', onAuthApproved);
                }
            };

            // Socket connected - but wait for authentication
            const onConnect = () => {
                console.log('Socket connected, waiting for authentication...');
                // Don't resolve yet - wait for auth:approved or auth:rejected
            };

            // Connection failed at network level
            const onError = (error) => {
                cleanup();
                let errorMsg = 'Failed to connect to Director';
                const errStr = error.message || String(error);
                
                if (errStr.includes('ECONNREFUSED')) {
                    errorMsg = 'Connection refused - Director server not running or port blocked';
                } else if (errStr.includes('ETIMEDOUT')) {
                    errorMsg = 'Connection timeout - Director server not responding';
                } else if (errStr.includes('ENOTFOUND')) {
                    errorMsg = 'Host not found - Check Director hostname/IP address';
                } else if (errStr.includes('ENETUNREACH')) {
                    errorMsg = 'Network unreachable - Check network connection';
                } else if (errStr.includes('websocket error') || errStr.includes('xhr poll error')) {
                    errorMsg = 'WebSocket connection failed - Check Director URL matches the Director backend port';
                } else if (errStr.includes('self signed') || errStr.includes('certificate')) {
                    errorMsg = 'SSL certificate error - For local testing, try using http:// instead of https://';
                } else if (errStr) {
                    errorMsg = `Connection error: ${errStr}`;
                }

                resolve({ success: false, error: errorMsg });
            };

            // Authentication approved - connection fully successful
            const onAuthApproved = () => {
                cleanup();
                console.log('✅ Authentication approved - connection successful');
                resolve({ success: true });
            };

            // Authentication rejected (invalid token, rate limit, etc.)
            const onAuthRejected = (data) => {
                cleanup();
                let errorMsg = data.message || 'Authentication rejected by Director';

                // Provide more specific error messages based on reason
                if (data.reason === 'invalid_token') {
                    errorMsg = '❌ Invalid Connection Token - Token does not match Director. Get the correct token from Director Settings.';
                } else if (data.reason === 'rate_limit') {
                    errorMsg = '❌ Rate Limit Exceeded - Too many connection attempts. Wait an hour and try again.';
                } else if (data.reason === 'invalid_data') {
                    errorMsg = `❌ Invalid Data - ${data.message || 'Client configuration is incomplete.'}`;
                } else if (data.reason === 'server_error') {
                    errorMsg = '❌ Director Server Error - Director may not be properly configured.';
                }

                resolve({ success: false, error: errorMsg });
            };

            this.socket.once('connect', onConnect);
            this.socket.once('connect_error', onError);
            this.socket.once('auth:approved', onAuthApproved);
            this.socket.once('auth:rejected', onAuthRejected);
        });
    }

    /**
     * Setup Socket.IO event handlers
     */
    setupEventHandlers() {
        // Connection established
        this.socket.on('connect', () => {
            console.log('✅ Connected to Director');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.sendRegistration();
        });

        // Disconnection
        this.socket.on('disconnect', (reason) => {
            console.log(`❌ Disconnected from Director: ${reason}`);
            this.isConnected = false;
            this.isAuthenticated = false;
            this.stopHeartbeat();
        });

        // Reconnection attempts
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            this.reconnectAttempts = attemptNumber;
            console.log(`🔄 Reconnection attempt ${attemptNumber}/${this.maxReconnectAttempts}`);
        });

        // Reconnection failed
        this.socket.on('reconnect_failed', () => {
            console.error('❌ Failed to reconnect to Director after maximum attempts');
            this.disconnect();
        });

        // Authentication challenge
        this.socket.on('auth:challenge', this.handleAuthChallenge.bind(this));

        // Authentication approved
        this.socket.on('auth:approved', this.handleAuthApproved.bind(this));

        // Authentication rejected
        this.socket.on('auth:rejected', this.handleAuthRejected.bind(this));

        // Command from Director
        this.socket.on('command', this.handleCommand.bind(this));

        // Director requests data
        this.socket.on('query', this.handleQuery.bind(this));

        // Connection errors - avoid log spam
        this.socket.on('connect_error', (error) => {
            this.isConnected = false;
            this.isAuthenticated = false;
            
            // Only log the first error to avoid spam
            if (!this.connectionErrorLogged) {
                this.connectionErrorLogged = true;
                const errorMsg = error.message || String(error);
                
                // Provide helpful error messages
                if (errorMsg.includes('websocket error') || errorMsg.includes('xhr poll error')) {
                    console.error('❌ Connection error: WebSocket/HTTP connection failed');
                    console.error('   Possible causes:');
                    console.error('   • Director not running on the specified port');
                    console.error('   • SSL certificate issue (try http:// for local testing)');
                    console.error('   • Firewall blocking the connection');
                    console.error('   • Wrong URL (use the Director\'s backend port, e.g., https://localhost:8000)');
                } else {
                    console.error('❌ Connection error:', errorMsg);
                }
            }
        });

        // Socket errors
        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });
    }

    /**
     * Send registration to Director
     */
    async sendRegistration() {
        try {
            const identity = await identityManager.getIdentity();

            console.log('📝 Sending registration to Director...');

            this.socket.emit('register', {
                client_id: identity.client_id,
                client_name: identity.client_name,
                public_key: identity.public_key,
                connection_token: identity.connection_token,
                version: '1.0.0',
                hostname: require('os').hostname(),
                platform: require('os').platform()
            });
        } catch (error) {
            console.error('Failed to send registration:', error.message);
        }
    }

    /**
     * Handle authentication challenge from Director
     */
    async handleAuthChallenge(data) {
        try {
            console.log('🔐 Received authentication challenge');

            const { challenge, challenge_id, nonce, expires } = data;

            // Validate challenge format
            if (!challenge || !challenge_id || !nonce) {
                console.error('❌ Invalid challenge format');
                return;
            }

            // Sign the challenge with our private key
            const signature = identityManager.signData(challenge);

            // Send signed challenge back with all identifiers
            this.socket.emit('auth:response', {
                challenge_id: challenge_id,
                challenge: challenge,
                nonce: nonce,
                signature: signature
            });

            console.log('✅ Sent signed challenge');
        } catch (error) {
            console.error('Failed to handle auth challenge:', error.message);
        }
    }

    /**
     * Handle authentication approval
     */
    async handleAuthApproved(data) {
        try {
            console.log('✅ Authentication approved by Director');

            // Reset authentication failure tracking on successful auth
            this.authFailureCount = 0;
            this.lastAuthFailure = null;

            // Layered token model: when the director mints a fresh per-client token (sent
            // only on first successful auth, or after an admin rotates it), persist it as
            // our connection_token. From here on we register with this dedicated secret
            // instead of the global bootstrap, so a future rotation by the admin only
            // affects this client.
            const updates = { last_connected: new Date().toISOString() };
            if (data && typeof data.per_client_token === 'string' && data.per_client_token.length > 0) {
                updates.connection_token = data.per_client_token;
                console.log('🔐 Saved per-client token issued by director');
            }
            await identityManager.updateIdentity(updates);

            this.isAuthenticated = true;

            this.startHeartbeat();
            this.sendStatus();
        } catch (error) {
            console.error('Failed to handle auth approval:', error.message);
        }
    }

    /**
     * Handle authentication rejection
     */
    handleAuthRejected(data) {
        // Increment failure counter
        this.authFailureCount++;
        this.lastAuthFailure = Date.now();

        const reason = data.reason || 'unknown';
        const message = data.message || 'Authentication rejected';

        console.error(`❌ Authentication rejected by Director (attempt ${this.authFailureCount}/${this.maxAuthFailures}): ${message}`);

        // Check if we should implement backoff
        if (this.authFailureCount >= this.maxAuthFailures) {
            const backoffMinutes = Math.ceil(this.authBackoffDuration / 60000);
            console.warn(`⏸️  Too many authentication failures (${this.authFailureCount}). Entering ${backoffMinutes}-minute backoff period.`);
            console.warn(`💡 Fix the connection token in Settings → Client Configuration, then click "Connect" to retry.`);
        } else {
            const remaining = this.maxAuthFailures - this.authFailureCount;
            console.warn(`⚠️  ${remaining} more attempt(s) before entering backoff period.`);
        }

        this.disconnect();
    }

    /**
     * Handle command from Director
     */
    async handleCommand(data) {
        try {
            const { request_id, action, params } = data;

            console.log(`📥 Received command: ${action} (request_id: ${request_id})`);

            // Validate message size
            const messageSize = JSON.stringify(data).length;
            if (messageSize > 1000000) { // 1MB limit
                console.warn(`🚫 Oversized command message: ${messageSize} bytes`);
                this.socket.emit('command:response', {
                    request_id: request_id,
                    status: 'error',
                    error: 'Command message exceeds size limit'
                });
                return;
            }

            // Check if we have a handler for this command
            const handler = this.commandHandlers.get(action);

            if (handler) {
                // Execute with timeout (30 seconds)
                const result = await Promise.race([
                    handler(params),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Command handler timeout')), 30000)
                    )
                ]);

                // Send response
                this.socket.emit('command:response', {
                    request_id: request_id,
                    status: 'success',
                    data: result
                });
            } else {
                console.warn(`⚠️ No handler for command: ${action}`);

                this.socket.emit('command:response', {
                    request_id: request_id,
                    status: 'error',
                    error: `Unknown command: ${action}`
                });
            }
        } catch (error) {
            console.error('Failed to handle command:', error.message);

            this.socket.emit('command:response', {
                request_id: data.request_id,
                status: 'error',
                error: error.message
            });
        }
    }

    /**
     * Handle query from Director
     */
    async handleQuery(data) {
        try {
            const { request_id, query_type } = data;

            console.log(`📥 Received query: ${query_type}`);

            let result = {};

            switch (query_type) {
                case 'status':
                    result = await this.getStatus();
                    break;
                case 'backups':
                    result = await this.getBackups();
                    break;
                case 'repositories':
                    result = await this.getRepositories();
                    break;
                default:
                    throw new Error(`Unknown query type: ${query_type}`);
            }

            this.socket.emit('query:response', {
                request_id: request_id,
                status: 'success',
                data: result
            });
        } catch (error) {
            console.error('Failed to handle query:', error.message);

            this.socket.emit('query:response', {
                request_id: data.request_id,
                status: 'error',
                error: error.message
            });
        }
    }

    /**
     * Register a command handler
     */
    registerCommandHandler(action, handler) {
        this.commandHandlers.set(action, handler);
        console.log(`✅ Registered command handler: ${action}`);
    }

    /**
     * Send heartbeat to Director
     */
    startHeartbeat() {
        // Send heartbeat every 30 seconds
        this.heartbeatInterval = setInterval(async () => {
            if (this.isAuthenticated && this.socket?.connected) {
                const status = await this.getStatus();

                this.socket.emit('heartbeat', {
                    status: 'healthy',
                    metadata: status
                });
            }
        }, 30000);

        console.log('💓 Heartbeat started (every 30 seconds)');
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('💓 Heartbeat stopped');
        }
    }

    /**
     * Send status update to Director
     */
    async sendStatus() {
        if (!this.isAuthenticated || !this.socket?.connected) {
            return;
        }

        try {
            const status = await this.getStatus();

            this.socket.emit('status:update', {
                timestamp: new Date().toISOString(),
                status: status
            });
        } catch (error) {
            console.error('Failed to send status:', error.message);
        }
    }

    /**
     * Get current client status
     *
     * Counts and last-backup info MUST match what the user sees in the local
     * client UI:
     *   - backups_count: user-visible backups only (excludes internal
     *     git-job-* / git-keys-* helper configs that backup-manager hides).
     *   - repos_count: unique repositories (used + unused), not occurrences.
     *   - last_backup_event: derived from the most recent run recorded in
     *     backups-metadata.yaml so the director shows real history even if
     *     no live notification has been pushed since it (re)started.
     */
    async getStatus() {
        const status = {
            backups_count: 0,
            repos_count: 0,
            last_backup: null,
            last_backup_event: null,
            disk_usage: 0,
            cpu_usage: 0,
            memory_usage: 0
        };

        // Backups count + last-backup summary, sourced from the same service
        // that powers the user-visible Backups page.
        try {
            const backupManager = require('./backup-manager');
            const backups = await backupManager.getAllBackups();
            if (Array.isArray(backups)) {
                status.backups_count = backups.length;

                let latest = null;
                for (const b of backups) {
                    if (!b?.last_run) continue;
                    const ts = Date.parse(b.last_run);
                    if (!Number.isFinite(ts)) continue;
                    if (!latest || ts > latest._ts) latest = { ...b, _ts: ts };
                }
                if (latest) {
                    const rawStatus = String(latest.last_run_status || '').toLowerCase();
                    let severity = 'info';
                    let event_type = 'backup_completed';
                    if (rawStatus === 'failed' || rawStatus === 'error') {
                        severity = 'error';
                        event_type = 'backup_failed';
                    } else if (rawStatus === 'running') {
                        severity = 'info';
                        event_type = 'backup_running';
                    } else if (rawStatus === 'success' || rawStatus === 'completed') {
                        severity = 'info';
                        event_type = 'backup_completed';
                    }
                    status.last_backup = latest.last_run;
                    status.last_backup_event = {
                        at: latest.last_run,
                        event_type,
                        severity,
                        backup_name: latest.name || null,
                        repository: null,
                        message: `${latest.name || 'Backup'}: ${rawStatus || 'unknown'}`
                    };
                }
            }
        } catch (error) {
            console.error('Failed to read backups for heartbeat:', error.message);
        }

        // Unique repositories (used + unused).
        try {
            const configParserService = this._getConfigParser();
            const repos = await configParserService.getAllRepositoriesWithUsage();
            if (Array.isArray(repos)) {
                status.repos_count = repos.length;
            }
        } catch (error) {
            console.error('Failed to read repositories for heartbeat:', error.message);
        }

        return status;
    }

    /**
     * Get backups list
     */
    async getBackups() {
        try {
            const backupsService = this._getConfigParser();
            const state = await backupsService.getState();
            return { backups: state.configs };
        } catch (error) {
            console.error('Failed to get backups:', error.message);
            return { backups: [] };
        }
    }

    /**
     * Get repositories list
     */
    async getRepositories() {
        try {
            const repoService = this._getBorgmaticConfig();
            const repos = await repoService.getRepositories();
            return { repositories: repos };
        } catch (error) {
            console.error('Failed to get repositories:', error.message);
            return { repositories: [] };
        }
    }

    /**
     * Lazy load config parser (prevent circular dependencies)
     */
    _getConfigParser() {
        if (!this._configParserCache) {
            this._configParserCache = require('./config-parser');
        }
        return this._configParserCache;
    }

    /**
     * Lazy load borgmatic config (prevent circular dependencies)
     */
    _getBorgmaticConfig() {
        if (!this._borgmaticConfigCache) {
            this._borgmaticConfigCache = require('./borgmatic-config');
        }
        return this._borgmaticConfigCache;
    }

    /**
     * Send notification to Director
     */
    sendNotification(eventType, options = {}) {
        if (!this.socket || !this.isAuthenticated) {
            console.log(`⏭️  Skipping notification (${eventType}): Not connected to Director`);
            return;
        }

        const notification = {
            event_type: eventType,
            severity: options.severity || 'info',
            message: options.message || '',
            details: options.details || {},
            backup_name: options.backup_name || null,
            repository: options.repository || null,
            timestamp: new Date().toISOString()
        };

        this.socket.emit('notification', notification);
        console.log(`📤 Sent notification to Director: ${eventType}`);
    }

    /**
     * Disconnect from Director
     */
    disconnect() {
        console.log('🔌 Disconnecting from Director...');

        this.stopHeartbeat();

        if (this.socket) {
            // Remove all event listeners to prevent memory leaks
            this.socket.removeAllListeners();
            // Use close() instead of disconnect() to prevent automatic reconnection
            this.socket.close();
            this.socket = null;
        }

        this.isConnected = false;
        this.isAuthenticated = false;

        console.log('✅ Disconnected');
    }

    /**
     * Check connection status
     */
    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            isAuthenticated: this.isAuthenticated,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

module.exports = new DirectorClient();

