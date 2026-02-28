const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const borgmaticCLI = require('../services/borgmatic-cli');
const borgmaticConfig = require('../services/borgmatic-config');
const { EventEmitter } = require('events');
const { execa } = require('execa');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');

/**
 * Event Manager for real-time events and broadcasting
 * Handles Server-Sent Events (SSE) for web UI updates
 */
class EventManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map(); // user_id -> response object
        this.backgroundTasks = new Map(); // task_id -> task info
        this.isRunning = false;
    }

    /**
     * Add a new SSE connection for a user
     */
    addConnection(userId, res) {
        // Check if user already has a connection
        if (this.connections.has(userId)) {
            console.log(`User ${userId} already has a connection, replacing it`);
            this.removeConnection(userId);
        }
        
        this.connections.set(userId, res);
        console.log(`Added SSE connection for user ${userId}, total connections: ${this.connections.size}`);
        
        // Don't send automatic connection_established event to reduce spam

        // Handle connection cleanup
        res.on('close', () => {
            this.removeConnection(userId);
        });

        return userId;
    }

    /**
     * Remove a connection for a user
     */
    removeConnection(userId) {
        if (this.connections.has(userId)) {
            this.connections.delete(userId);
            console.log(`Removed SSE connection for user ${userId}, total connections: ${this.connections.size}`);
        }
    }

    /**
     * Send an event to a specific user
     */
    sendEvent(userId, event) {
        const res = this.connections.get(userId);
        if (res && !res.destroyed) {
            try {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch (error) {
                console.error(`Failed to send event to user ${userId}:`, error.message);
                this.removeConnection(userId);
            }
        }
    }

    /**
     * Broadcast an event to all connected users
     */
    broadcastEvent(eventType, data, targetUserId = null) {
        const event = {
            type: eventType,
            data: data,
            timestamp: new Date().toISOString()
        };

        if (targetUserId) {
            // Send to specific user
            this.sendEvent(targetUserId, event);
        } else {
            // Broadcast to all users
            for (const [userId, res] of this.connections) {
                this.sendEvent(userId, event);
            }
        }
    }

    /**
     * Get the number of active connections
     */
    getConnectionCount() {
        return this.connections.size;
    }

    /**
     * Start background monitoring tasks
     */
    startBackgroundTasks() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        
        // Start periodic system status updates
        this.startPeriodicSystemStatus();
        
        // Start backup job monitoring
        this.startBackupJobMonitoring();
        
        // Start health monitoring
        this.startHealthMonitoring();
        
        console.log('Started SSE background tasks');
    }

    /**
     * Start periodic system status updates
     */
    startPeriodicSystemStatus() {
        const taskId = 'system_status';
        const interval = setInterval(async () => {
            try {
                const systemInfo = await this.getSystemInfo();
                this.broadcastEvent('system_status', {
                    type: 'periodic_update',
                    data: systemInfo
                });
            } catch (error) {
                console.error('Error in periodic system status:', error.message);
            }
        }, 60000); // Every 60 seconds

        this.backgroundTasks.set(taskId, { interval, type: 'system_status' });
    }

    /**
     * Start backup job monitoring
     */
    startBackupJobMonitoring() {
        const taskId = 'backup_monitoring';
        const interval = setInterval(async () => {
            try {
                // Check for running backup jobs and send progress updates
                await this.monitorBackupJobs();
            } catch (error) {
                console.error('Error in backup job monitoring:', error.message);
            }
        }, 30000); // Every 30 seconds

        this.backgroundTasks.set(taskId, { interval, type: 'backup_monitoring' });
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        const taskId = 'health_monitoring';
        const interval = setInterval(async () => {
            try {
                const healthStatus = await this.getHealthStatus();
                this.broadcastEvent('health_update', {
                    type: 'health_check',
                    data: healthStatus
                });
            } catch (error) {
                console.error('Error in health monitoring:', error.message);
            }
        }, 60000); // Every minute

        this.backgroundTasks.set(taskId, { interval, type: 'health_monitoring' });
    }

    /**
     * Get system information
     */
    async getSystemInfo() {
        try {
            const cpuUsage = await this.getCpuUsage();
            const memoryUsage = this.getMemoryUsage();
            const diskUsage = await this.getDiskUsage();
            const uptime = os.uptime();
            const networkStatus = await this.checkNetworkStatus();

            return {
                cpu_usage: cpuUsage,
                memory_usage: memoryUsage,
                disk_usage: diskUsage,
                uptime: uptime,
                network_status: networkStatus,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Failed to get system info:', error.message);
            return {
                error: 'Failed to get system information',
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get CPU usage
     */
    async getCpuUsage() {
        try {
            const startUsage = process.cpuUsage();
            await new Promise(resolve => setTimeout(resolve, 100));
            const endUsage = process.cpuUsage(startUsage);
            const totalUsage = (endUsage.user + endUsage.system) / 1000000;
            return Math.min(100, Math.max(0, totalUsage * 10));
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get memory usage
     */
    getMemoryUsage() {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            return Math.round((usedMem / totalMem) * 100);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get disk usage
     */
    async getDiskUsage() {
        try {
            // Use df command as fallback since fs.statvfs doesn't exist in Node.js
            const { stdout } = await execa('df', ['-h', '/']);
            const lines = stdout.split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                const usage = parts[4];
                return parseInt(usage.replace('%', ''));
            }
            return 0;
        } catch (error) {
            console.warn('Failed to get disk usage:', error.message);
            return 0;
        }
    }

    /**
     * Check network status
     */
    async checkNetworkStatus() {
        try {
            await execa('ping', ['-c', '1', '8.8.8.8'], { timeout: 5000 });
            return 'connected';
        } catch (error) {
            return 'disconnected';
        }
    }

    /**
     * Monitor backup jobs
     */
    async monitorBackupJobs() {
        try {
            // This would integrate with the backup job system
            // For now, we'll implement a placeholder
            // In a real implementation, this would check running backup jobs
            // and send progress updates via SSE
        } catch (error) {
            console.error('Error monitoring backup jobs:', error.message);
        }
    }

    /**
     * Get health status
     */
    async getHealthStatus() {
        try {
            const config = await borgmaticConfig.loadConfig();
            // Support both new flat format and old nested format
            const repositories = config.repositories || config.location?.repositories || [];
            
            return {
                repositories_count: repositories.length,
                borgmatic_available: await this.checkBorgmaticAvailability(),
                config_valid: !!config.location,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                error: 'Failed to get health status',
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check if borgmatic is available
     */
    async checkBorgmaticAvailability() {
        try {
            // Use silent mode to avoid spamming logs every health check interval
            const result = await borgmaticCLI.executeCommand(['--version'], { silent: true });
            return result.success;
        } catch (error) {
            return false;
        }
    }

    /**
     * Stop all background tasks
     */
    stopBackgroundTasks() {
        if (!this.isRunning) return;
        
        for (const [taskId, task] of this.backgroundTasks) {
            if (task.interval) {
                clearInterval(task.interval);
            }
        }
        this.backgroundTasks.clear();
        this.isRunning = false;
        console.log('Stopped SSE background tasks');
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        // Stop background tasks
        this.stopBackgroundTasks();
        
        // Close all connections
        for (const [userId, res] of this.connections) {
            try {
                if (!res.destroyed) {
                    res.end();
                }
            } catch (error) {
                console.error(`Error closing connection for user ${userId}:`, error.message);
            }
        }
        this.connections.clear();
        
        console.log('Event manager cleanup completed');
    }
}

// Global event manager instance
const eventManager = new EventManager();

/**
 * Handle OPTIONS preflight for SSE endpoint
 */
router.options('/stream', (req, res) => {
    const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:8000',
        process.env.DOMAIN ? `https://${process.env.DOMAIN}` : null,
        process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',')[0] : null
    ].filter(Boolean);
    
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Cache-Control, Authorization');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(204).send();
});

/**
 * Stream real-time events via Server-Sent Events
 * GET /api/events/stream?token=<jwt_token>
 */
router.get('/stream', (req, res) => {
    try {
        // Set CORS headers FIRST - restrict to allowed origins only
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:8000',
            process.env.DOMAIN ? `https://${process.env.DOMAIN}` : null,
            process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',')[0] : null
        ].filter(Boolean);
        
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
        }
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        
        // Get token from query parameter (for EventSource compatibility)
        const token = req.query.token;
        if (!token) {
            return res.status(401).json({ error: 'Token required' });
        }
        
        // Verify token manually
        const jwt = require('jsonwebtoken');
        const config = require('../config');
        let decoded;
        try {
            decoded = jwt.verify(token, config.secretKey, { algorithms: [config.algorithm] });
        } catch (error) {
            console.error('SSE Auth - Token verification failed:', error.message);
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        const userId = decoded.sub;
        
        // Set up SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Disable nginx buffering
        });

        // Add connection to event manager
        eventManager.addConnection(userId, res);

        // Send keep-alive pings every 30 seconds
        const keepAlive = setInterval(() => {
            try {
                res.write(':\n\n'); // SSE comment for keep-alive
            } catch (error) {
                clearInterval(keepAlive);
            }
        }, 30000);

        // Clean up on connection close
        req.on('close', () => {
            clearInterval(keepAlive);
            eventManager.removeConnection(userId);
        });

    } catch (error) {
        console.error('Failed to start event stream:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to start event stream'
        });
    }
});

/**
 * Send backup progress update (internal use)
 * POST /api/events/backup-progress
 */
router.post('/backup-progress', authenticateToken, async (req, res) => {
    try {
        const { job_id, progress, status, message } = req.body;

        if (!job_id || progress === undefined || !status) {
            return res.status(400).json({
                success: false,
                detail: 'job_id, progress, and status are required'
            });
        }

        eventManager.broadcastEvent('backup_progress', {
            job_id: job_id,
            progress: progress,
            status: status,
            message: message,
            user_id: req.user.username
        }, req.user.username);

        res.json({
            success: true,
            message: 'Progress update sent'
        });
    } catch (error) {
        console.error('Failed to send backup progress:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to send progress update'
        });
    }
});

/**
 * Send system status update (admin only)
 * POST /api/events/system-status
 */
router.post('/system-status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const statusData = req.body;
        
        eventManager.broadcastEvent('system_status', statusData);
        
        res.json({
            success: true,
            message: 'System status update sent'
        });
    } catch (error) {
        console.error('Failed to send system status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to send system status'
        });
    }
});

/**
 * Send log update (admin only)
 * POST /api/events/log-update
 */
router.post('/log-update', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { log_type, log_data } = req.body;

        if (!log_type || !log_data) {
            return res.status(400).json({
                success: false,
                detail: 'log_type and log_data are required'
            });
        }

        eventManager.broadcastEvent('log_update', {
            log_type: log_type,
            log_data: log_data,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Log update sent'
        });
    } catch (error) {
        console.error('Failed to send log update:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to send log update'
        });
    }
});

/**
 * Get the number of active SSE connections (admin only)
 * GET /api/events/connections
 */
router.get('/connections', authenticateToken, requireAdmin, (req, res) => {
    try {
        const count = eventManager.getConnectionCount();
        res.json({
            success: true,
            active_connections: count
        });
    } catch (error) {
        console.error('Failed to get connection count:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get connection count'
        });
    }
});

/**
 * Send notification event (for Borgmatic monitoring integration)
 * POST /api/events/notification
 */
router.post('/notification', authenticateToken, async (req, res) => {
    try {
        const { type, message, level = 'info', data = {} } = req.body;

        if (!type || !message) {
            return res.status(400).json({
                success: false,
                detail: 'type and message are required'
            });
        }

        // Broadcast notification to all connected users
        eventManager.broadcastEvent('notification', {
            type: type,
            message: message,
            level: level,
            data: data,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Notification sent'
        });
    } catch (error) {
        console.error('Failed to send notification:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to send notification'
        });
    }
});

/**
 * Send backup lifecycle event (for Borgmatic hooks integration)
 * POST /api/events/backup-lifecycle
 */
router.post('/backup-lifecycle', authenticateToken, async (req, res) => {
    try {
        const { event_type, repository, archive, status, message, data = {} } = req.body;

        if (!event_type || !repository) {
            return res.status(400).json({
                success: false,
                detail: 'event_type and repository are required'
            });
        }

        // Broadcast backup lifecycle event
        eventManager.broadcastEvent('backup_lifecycle', {
            event_type: event_type, // 'start', 'finish', 'fail', 'before_backup', 'after_backup', etc.
            repository: repository,
            archive: archive,
            status: status,
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Backup lifecycle event sent'
        });
    } catch (error) {
        console.error('Failed to send backup lifecycle event:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to send backup lifecycle event'
        });
    }
});

/**
 * Get event manager status (admin only)
 * GET /api/events/status
 */
router.get('/status', authenticateToken, requireAdmin, (req, res) => {
    try {
        const status = {
            is_running: eventManager.isRunning,
            active_connections: eventManager.getConnectionCount(),
            background_tasks: Array.from(eventManager.backgroundTasks.keys()),
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Failed to get event manager status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get event manager status'
        });
    }
});

/**
 * Start background tasks (admin only)
 * POST /api/events/start-tasks
 */
router.post('/start-tasks', authenticateToken, requireAdmin, (req, res) => {
    try {
        eventManager.startBackgroundTasks();
        res.json({
            success: true,
            message: 'Background tasks started'
        });
    } catch (error) {
        console.error('Failed to start background tasks:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to start background tasks'
        });
    }
});

/**
 * Stop background tasks (admin only)
 * POST /api/events/stop-tasks
 */
router.post('/stop-tasks', authenticateToken, requireAdmin, (req, res) => {
    try {
        eventManager.stopBackgroundTasks();
        res.json({
            success: true,
            message: 'Background tasks stopped'
        });
    } catch (error) {
        console.error('Failed to stop background tasks:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to stop background tasks'
        });
    }
});

// Export the event manager for use in other modules
module.exports = router;
module.exports.eventManager = eventManager;
