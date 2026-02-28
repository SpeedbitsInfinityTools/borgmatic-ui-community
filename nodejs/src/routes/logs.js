const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs-extra');
const path = require('path');
const logManager = require('../services/log-manager');

/**
 * Get logs with optional filtering and search
 * GET /api/logs
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { 
            log_type = 'borgmatic', 
            lines = 100, 
            search, 
            level, 
            start_time, 
            end_time 
        } = req.query;

        // Parse numeric parameters
        const linesCount = parseInt(lines, 10) || 100;

        // Determine log file path based on type
        let logPath;
        switch (log_type) {
            case 'borgmatic':
                logPath = logManager.getBorgmaticLogPath();
                break;
            case 'system':
                logPath = '/var/log/syslog';
                break;
            default:
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid log type'
                });
        }

        // Check if log file exists
        if (!await fs.pathExists(logPath)) {
            return res.json({
                success: true,
                logs: [],
                total_lines: 0,
                message: `Log file ${logPath} not found`,
                log_type,
                log_path: logPath
            });
        }

        // Read log file
        const logContent = await fs.readFile(logPath, 'utf8');
        const allLines = logContent.split('\n').filter(line => line.trim());

        // Apply filters
        const filteredLines = [];
        for (const line of allLines) {
            // Apply search filter
            if (search && !line.toLowerCase().includes(search.toLowerCase())) {
                continue;
            }

            // Apply level filter
            if (level && !line.toUpperCase().includes(level.toUpperCase())) {
                continue;
            }

            // Apply time filter (basic implementation)
            if (start_time || end_time) {
                try {
                    // Extract timestamp from log line (adjust pattern as needed)
                    const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                    if (timestampMatch) {
                        const logTime = new Date(timestampMatch[1]);
                        if (start_time && logTime < new Date(start_time)) {
                            continue;
                        }
                        if (end_time && logTime > new Date(end_time)) {
                            continue;
                        }
                    }
                } catch (error) {
                    // Skip time filtering if timestamp parsing fails
                    console.warn('Failed to parse timestamp:', error.message);
                }
            }

            filteredLines.push(line);
        }

        // Get requested number of lines (from end) and reverse to show latest first
        const totalLines = filteredLines.length;
        const resultLines = linesCount > 0 ? filteredLines.slice(-linesCount).reverse() : filteredLines.reverse();

        res.json({
            success: true,
            logs: resultLines,
            total_lines: totalLines,
            log_type,
            log_path: logPath
        });

    } catch (error) {
        console.error('Failed to get logs:', error.message);
        res.status(500).json({
            success: false,
            detail: `Failed to retrieve logs: ${error.message}`
        });
    }
});

/**
 * Get available log types
 * GET /api/logs/types
 */
router.get('/types', authenticateToken, async (req, res) => {
    try {
        const config = require('../config');
        const logTypes = [
            {
                id: 'borgmatic',
                name: 'Borgmatic Logs',
                description: 'Backup operation logs',
                path: logManager.getBorgmaticLogPath()
            },
            {
                id: 'system',
                name: 'System Logs',
                description: 'System and service logs',
                path: '/var/log/syslog'
            }
        ];

        res.json({
            success: true,
            log_types: logTypes
        });
    } catch (error) {
        console.error('Failed to get log types:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve log types'
        });
    }
});

/**
 * Get log statistics for the specified time period
 * GET /api/logs/stats
 */
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const { log_type = 'borgmatic', hours = 24 } = req.query;

        // Parse numeric parameters
        const hoursCount = parseInt(hours, 10) || 24;

        // Determine log file path
        let logPath;
        switch (log_type) {
            case 'borgmatic':
                logPath = logManager.getBorgmaticLogPath();
                break;
            case 'system':
                logPath = '/var/log/syslog';
                break;
            default:
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid log type'
                });
        }

        if (!await fs.pathExists(logPath)) {
            return res.json({
                success: true,
                stats: {
                    total_entries: 0,
                    error_count: 0,
                    warning_count: 0,
                    info_count: 0,
                    success_rate: 0.0
                },
                time_period_hours: hours
            });
        }

        // Calculate time threshold
        const thresholdTime = new Date(Date.now() - (hoursCount * 60 * 60 * 1000));

        // Read and analyze logs
        const logContent = await fs.readFile(logPath, 'utf8');
        const lines = logContent.split('\n').filter(line => line.trim());

        const stats = {
            total_entries: 0,
            error_count: 0,
            warning_count: 0,
            info_count: 0,
            success_rate: 0.0
        };

        for (const line of lines) {
            try {
                // Extract timestamp and check if within time range
                const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                if (timestampMatch) {
                    const logTime = new Date(timestampMatch[1]);
                    if (logTime >= thresholdTime) {
                        stats.total_entries += 1;

                        // Count by level
                        const lineLower = line.toLowerCase();
                        if (lineLower.includes('error')) {
                            stats.error_count += 1;
                        } else if (lineLower.includes('warning')) {
                            stats.warning_count += 1;
                        } else if (lineLower.includes('info')) {
                            stats.info_count += 1;
                        }
                    }
                }
            } catch (error) {
                // Skip lines that can't be parsed
                continue;
            }
        }

        // Calculate success rate (basic implementation)
        if (stats.total_entries > 0) {
            const nonErrorEntries = stats.total_entries - stats.error_count;
            stats.success_rate = (nonErrorEntries / stats.total_entries) * 100;
        }

        res.json({
            success: true,
            stats,
            time_period_hours: hoursCount
        });

    } catch (error) {
        console.error('Failed to get log stats:', error.message);
        res.status(500).json({
            success: false,
            detail: `Failed to retrieve log statistics: ${error.message}`
        });
    }
});

/**
 * Clear logs (admin only)
 * DELETE /api/logs/clear
 */
router.delete('/clear', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { log_type = 'borgmatic' } = req.query;

        // Determine log file path
        let logPath;
        switch (log_type) {
            case 'borgmatic':
                logPath = logManager.getBorgmaticLogPath();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid log type'
                });
        }

        if (await fs.pathExists(logPath)) {
            // Clear the log file
            await fs.writeFile(logPath, '');
            
            console.log(`Logs cleared: ${log_type} by user ${req.user.username}`);
            
            res.json({
                success: true,
                message: `Logs cleared successfully: ${log_type}`
            });
        } else {
            res.json({
                success: true,
                message: `Log file not found: ${logPath}`
            });
        }

    } catch (error) {
        console.error('Failed to clear logs:', error.message);
        res.status(500).json({
            success: false,
            detail: `Failed to clear logs: ${error.message}`
        });
    }
});

/**
 * Get real-time log stream (WebSocket-like functionality)
 * GET /api/logs/stream
 */
router.get('/stream', authenticateToken, async (req, res) => {
    try {
        const { log_type = 'borgmatic' } = req.query;

        // Determine log file path
        let logPath;
        switch (log_type) {
            case 'borgmatic':
                logPath = logManager.getBorgmaticLogPath();
                break;
            case 'system':
                logPath = '/var/log/syslog';
                break;
            default:
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid log type'
                });
        }

        // Set up Server-Sent Events
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // Send initial data
        if (await fs.pathExists(logPath)) {
            const logContent = await fs.readFile(logPath, 'utf8');
            const lines = logContent.split('\n').filter(line => line.trim());
            const recentLines = lines.slice(-50); // Last 50 lines
            
            try {
                res.write(`data: ${JSON.stringify({
                    type: 'initial',
                    logs: recentLines,
                    timestamp: new Date().toISOString()
                })}\n\n`);
            } catch (error) {
                console.error('Error sending initial data:', error.message);
                return;
            }
        }

        // Set up file watching (simplified approach)
        let lastSize = 0;
        if (await fs.pathExists(logPath)) {
            const stats = await fs.stat(logPath);
            lastSize = stats.size;
        }

        const checkForUpdates = async () => {
            try {
                if (await fs.pathExists(logPath)) {
                    const stats = await fs.stat(logPath);
                    if (stats.size > lastSize) {
                        // Read only new content efficiently
                        const newContent = await fs.readFile(logPath, 'utf8');
                        const allLines = newContent.split('\n').filter(line => line.trim());
                        const newLines = allLines.slice(-10); // Last 10 lines
                        
                        try {
                            res.write(`data: ${JSON.stringify({
                                type: 'update',
                                logs: newLines,
                                timestamp: new Date().toISOString()
                            })}\n\n`);
                        } catch (error) {
                            console.error('Error sending log update:', error.message);
                            clearInterval(interval);
                            clearInterval(keepAlive);
                            return;
                        }
                        
                        lastSize = stats.size;
                    }
                }
            } catch (error) {
                console.error('Error checking log updates:', error.message);
            }
        };

        // Check for updates every 2 seconds
        const interval = setInterval(checkForUpdates, 2000);

        // Send keep-alive every 30 seconds
        const keepAlive = setInterval(() => {
            try {
                res.write(`data: ${JSON.stringify({
                    type: 'keepalive',
                    timestamp: new Date().toISOString()
                })}\n\n`);
            } catch (error) {
                console.error('Error sending keep-alive:', error.message);
                clearInterval(interval);
                clearInterval(keepAlive);
            }
        }, 30000);

        // Clean up on client disconnect
        req.on('close', () => {
            clearInterval(interval);
            clearInterval(keepAlive);
        });

    } catch (error) {
        console.error('Failed to stream logs:', error.message);
        res.status(500).json({
            success: false,
            detail: `Failed to stream logs: ${error.message}`
        });
    }
});

/**
 * Download log file
 * GET /api/logs/download
 */
router.get('/download', authenticateToken, async (req, res) => {
    try {
        const { log_type = 'borgmatic' } = req.query;

        // Determine log file path
        let logPath;
        let fileName;
        switch (log_type) {
            case 'borgmatic':
                logPath = logManager.getBorgmaticLogPath();
                fileName = 'borgmatic.log';
                break;
            case 'system':
                logPath = '/var/log/syslog';
                fileName = 'syslog.log';
                break;
            default:
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid log type'
                });
        }

        if (!await fs.pathExists(logPath)) {
            return res.status(404).json({
                success: false,
                detail: 'Log file not found'
            });
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        // Stream the file
        const fileStream = fs.createReadStream(logPath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming log file:', error.message);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    detail: 'Failed to download log file'
                });
            }
        });

    } catch (error) {
        console.error('Failed to download logs:', error.message);
        res.status(500).json({
            success: false,
            detail: `Failed to download logs: ${error.message}`
        });
    }
});

/**
 * Get log settings
 * GET /api/logs/settings
 */
router.get('/settings', authenticateToken, async (req, res) => {
    try {
        const settings = await logManager.getSettings();
        const stats = await logManager.getLogStats();
        
        res.json({
            success: true,
            data: {
                settings,
                stats,
                // Include the system's managed log path for the UI to suggest
                suggested_log_path: logManager.getBorgmaticLogPath()
            }
        });
    } catch (error) {
        console.error('Failed to get log settings:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get log settings'
        });
    }
});

/**
 * Update log settings
 * PUT /api/logs/settings
 */
router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const newSettings = req.body;
        const updatedSettings = await logManager.updateSettings(newSettings);
        
        res.json({
            success: true,
            data: updatedSettings,
            message: 'Log settings updated successfully'
        });
    } catch (error) {
        console.error('Failed to update log settings:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update log settings'
        });
    }
});

/**
 * Trigger manual log cleanup
 * POST /api/logs/cleanup
 */
router.post('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await logManager.cleanupOldLogs();
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Failed to cleanup logs:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to cleanup logs'
        });
    }
});

module.exports = router;
