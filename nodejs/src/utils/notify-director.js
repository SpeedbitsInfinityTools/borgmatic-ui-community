/**
 * Notification Emitter Utility
 * Can be called from borgmatic hooks or backup executor
 * to send notifications to Director
 */

/**
 * Send notification to Director if in client mode
 * @param {string} eventType - Type of event (backup_started, backup_completed, backup_failed, etc.)
 * @param {Object} options - Notification options
 * @param {string} options.severity - Severity level (info, warning, error, success)
 * @param {string} options.message - Human-readable message
 * @param {Object} options.details - Additional details
 * @param {string} options.backup_name - Name of the backup job
 * @param {string} options.repository - Repository path
 */
async function notifyDirector(eventType, options = {}) {
    try {
        // Lazy load to avoid circular dependencies
        const identityManager = require('../services/identity-manager');
        
        // Check if we're in client mode
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'client' || !identity.director_url) {
            // Not in client mode or no Director configured - skip
            return;
        }

        // Get director client
        const directorClient = require('../services/director-client');
        
        // Send notification
        directorClient.sendNotification(eventType, options);
        
    } catch (error) {
        console.error('Failed to send notification to Director:', error.message);
        // Don't throw - notifications are non-critical
    }
}

module.exports = {
    notifyDirector,
    
    // Helper functions for common notification types
    backupStarted: (backupName, repository) => notifyDirector('backup_started', {
        severity: 'info',
        message: `Backup started: ${backupName}`,
        backup_name: backupName,
        repository: repository
    }),
    
    backupCompleted: (backupName, repository, stats = {}) => notifyDirector('backup_completed', {
        severity: 'success',
        message: `Backup completed successfully: ${backupName}`,
        backup_name: backupName,
        repository: repository,
        details: stats
    }),
    
    backupFailed: (backupName, repository, error) => notifyDirector('backup_failed', {
        severity: 'error',
        message: `Backup failed: ${backupName} - ${error}`,
        backup_name: backupName,
        repository: repository,
        details: { error: error.toString() }
    }),
    
    warning: (message, details = {}) => notifyDirector('warning', {
        severity: 'warning',
        message: message,
        details: details
    }),
    
    error: (message, details = {}) => notifyDirector('error', {
        severity: 'error',
        message: message,
        details: details
    })
};

