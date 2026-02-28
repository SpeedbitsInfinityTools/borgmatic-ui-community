const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const yaml = require('js-yaml');

/**
 * Log Manager Service
 * Manages logging configuration, retention, and cleanup
 */
class LogManager {
    constructor() {
        this.logsDir = config.logsDir;
        this.settingsPath = path.join(config.configDir, 'log-settings.yaml');
        this.defaultSettings = {
            enabled: true,
            retention_days: 30,
            max_size_mb: 20,
            log_level: 'info',
            log_to_file: true,
            log_to_syslog: false,
            auto_cleanup: true
        };
    }

    /**
     * Get current log settings
     */
    async getSettings() {
        try {
            await fs.ensureDir(path.dirname(this.settingsPath));

            if (await fs.pathExists(this.settingsPath)) {
                const content = await fs.readFile(this.settingsPath, 'utf8');
                const settings = yaml.load(content);
                return { ...this.defaultSettings, ...settings };
            }

            // Return defaults if file doesn't exist
            return this.defaultSettings;
        } catch (error) {
            console.error('Failed to load log settings:', error.message);
            return this.defaultSettings;
        }
    }

    /**
     * Update log settings
     */
    async updateSettings(newSettings) {
        try {
            await fs.ensureDir(path.dirname(this.settingsPath));

            const currentSettings = await this.getSettings();
            const updatedSettings = { ...currentSettings, ...newSettings };

            await fs.writeFile(
                this.settingsPath,
                yaml.dump(updatedSettings, { indent: 2 }),
                'utf8'
            );

            // Ensure logs directory exists if logging is enabled
            if (updatedSettings.enabled && updatedSettings.log_to_file) {
                await fs.ensureDir(this.logsDir);
            }

            console.log('✅ Log settings updated');
            return updatedSettings;
        } catch (error) {
            console.error('Failed to update log settings:', error.message);
            throw error;
        }
    }

    /**
     * Get the borgmatic log file path
     */
    getBorgmaticLogPath() {
        return path.join(this.logsDir, 'borgmatic.log');
    }

    /**
     * Get the application log file path
     */
    getAppLogPath() {
        return path.join(this.logsDir, 'app.log');
    }

    /**
     * Clean up old log files based on retention settings
     */
    async cleanupOldLogs() {
        try {
            const settings = await this.getSettings();

            if (!settings.auto_cleanup) {
                console.log('⏭️  Log auto-cleanup is disabled');
                return { cleaned: 0, message: 'Auto-cleanup disabled' };
            }

            await fs.ensureDir(this.logsDir);

            const files = await fs.readdir(this.logsDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - settings.retention_days);

            let cleanedCount = 0;
            let totalSize = 0;

            for (const file of files) {
                if (file.endsWith('.log') || file.endsWith('.log.old')) {
                    const filePath = path.join(this.logsDir, file);
                    const stats = await fs.stat(filePath);

                    // Check if file is older than retention period
                    if (stats.mtime < cutoffDate) {
                        await fs.remove(filePath);
                        cleanedCount++;
                        totalSize += stats.size;
                        console.log(`🗑️  Removed old log file: ${file}`);
                    }
                }
            }

            const message = cleanedCount > 0
                ? `Cleaned up ${cleanedCount} old log file(s), freed ${(totalSize / 1024 / 1024).toFixed(2)} MB`
                : 'No old log files to clean up';

            console.log(`✅ ${message}`);
            return { cleaned: cleanedCount, size_freed: totalSize, message };
        } catch (error) {
            console.error('Failed to cleanup old logs:', error.message);
            throw error;
        }
    }

    /**
     * Rotate log file if it exceeds max size
     */
    async rotateLogIfNeeded(logPath) {
        try {
            const settings = await this.getSettings();

            if (!await fs.pathExists(logPath)) {
                return false;
            }

            const stats = await fs.stat(logPath);
            const fileSizeMB = stats.size / 1024 / 1024;

            if (fileSizeMB > settings.max_size_mb) {
                const oldPath = `${logPath}.old`;

                // Remove existing .old file if it exists
                if (await fs.pathExists(oldPath)) {
                    await fs.remove(oldPath);
                }

                // Rename current log to .old
                await fs.move(logPath, oldPath);

                console.log(`🔄 Rotated log file: ${path.basename(logPath)} (${fileSizeMB.toFixed(2)} MB)`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('Failed to rotate log:', error.message);
            return false;
        }
    }

    /**
     * Get log file stats
     */
    async getLogStats() {
        try {
            await fs.ensureDir(this.logsDir);
            const files = await fs.readdir(this.logsDir);

            let totalSize = 0;
            let fileCount = 0;
            const logFiles = [];

            for (const file of files) {
                if (file.endsWith('.log') || file.endsWith('.log.old')) {
                    const filePath = path.join(this.logsDir, file);
                    const stats = await fs.stat(filePath);

                    totalSize += stats.size;
                    fileCount++;

                    logFiles.push({
                        name: file,
                        size: stats.size,
                        size_mb: (stats.size / 1024 / 1024).toFixed(2),
                        modified: stats.mtime,
                        age_days: Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24))
                    });
                }
            }

            return {
                total_files: fileCount,
                total_size: totalSize,
                total_size_mb: (totalSize / 1024 / 1024).toFixed(2),
                files: logFiles.sort((a, b) => b.modified - a.modified)
            };
        } catch (error) {
            console.error('Failed to get log stats:', error.message);
            return {
                total_files: 0,
                total_size: 0,
                total_size_mb: '0.00',
                files: []
            };
        }
    }

    /**
     * Initialize logging system
     */
    async initialize() {
        try {
            const settings = await this.getSettings();

            if (settings.enabled && settings.log_to_file) {
                await fs.ensureDir(this.logsDir);
                console.log(`📁 Logs directory: ${this.logsDir}`);
            }

            // Run initial cleanup if auto-cleanup is enabled
            if (settings.auto_cleanup) {
                await this.cleanupOldLogs();
            }

            // Set up automatic cleanup schedule (daily)
            if (settings.auto_cleanup) {
                setInterval(async () => {
                    console.log('🔄 Running scheduled log cleanup...');
                    await this.cleanupOldLogs();
                }, 24 * 60 * 60 * 1000); // Every 24 hours
            }

            console.log('✅ Log manager initialized');
        } catch (error) {
            console.error('Failed to initialize log manager:', error.message);
        }
    }
}

// Export singleton instance
module.exports = new LogManager();

