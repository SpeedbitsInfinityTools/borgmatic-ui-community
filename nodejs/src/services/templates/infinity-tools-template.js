/**
 * Infinity Tools Backup Template
 * 
 * Pre-configured backup template for Infinity Tools installations.
 * Provides one-click activation of complete backup solution.
 * 
 * Mount paths in Docker:
 * - Host filesystem: /host (entire host filesystem mounted)
 * - Backup source: /host/opt/speedbits (where Infinity Tools apps are installed)
 * - App data: /app/data, /app/config, /app/logs (app's own writable directories)
 */

// Backup source path - where Infinity Tools apps are located
// In Docker: host filesystem is mounted at /host, so /host/opt/speedbits contains the apps
// This can be overridden via environment variable if needed
const BACKUP_SOURCE = process.env.BACKUP_SOURCE_PATH || '/host/opt/speedbits';

// Backup destination path - where borg repository is stored
// In Docker: host's /opt/speedbits-backup is mounted to /backup-destination
const BACKUP_DESTINATION = process.env.BACKUP_DESTINATION_PATH || '/backup-destination';

module.exports = {
    id: 'infinity-tools',
    name: 'Infinity Tools Backup',
    description: `Complete backup solution for Infinity Tools installations - backs up all applications and databases from ${BACKUP_SOURCE}`,
    version: '1.2.0',  // Version bump: switch DB hooks to dump-to-file approach
    official: true, // Built-in template
    vendor: 'SpeedBits',
    icon: '🏗️',

    // Repository configuration
    repository: {
        name: 'Local SpeedBits Backup',
        path: `${BACKUP_DESTINATION}/borgmatic-repo`,
        storage_mode: 'direct',
        repository_type: 'local',
        encryption: 'repokey-blake2-aes-ocb', // Borg 2.0 AEAD encryption
        compression: 'lz4',  // LZ4 is recommended - fast with good ratio
        // Passphrase will be auto-generated on activation
    },

    // Files backup configuration
    filesBackup: {
        name: 'SpeedBits System Backup',
        description: 'Daily backup of all application files and configurations',
        sources: [BACKUP_SOURCE],
        exclude_patterns: [
            '*.tmp',
            '*.log',
            '*/logs/*',
            '*/cache/*',
            '*/tmp/*',
            '*/.git/*',
            '*/node_modules/*',
            '*/venv/*',
            '*/__pycache__/*',
            '*/database-dumps/*',  // Excluded from files backup (handled separately)
            '*/netdata/lib/*',     // Netdata metrics DB (can be GBs)
            '*/netdata/cache/*',
        ],
        compression: 'lz4',  // LZ4 - fast with good compression
        archive_name_format: 'infinitytools-files-{hostname}-{now:%Y-%m-%d-%H%M%S}',
        retention: {
            keep_daily: 7,
            keep_weekly: 4,
            keep_monthly: 6
        },
        schedule: {
            name: 'Daily System Backup',
            cron: '0 2 * * *', // 2 AM daily
            enabled: true
        }
    },

    // Database backup configuration
    // Uses borgmatic's native database hooks for proper streaming dumps
    databaseBackup: {
        name: 'SpeedBits Database Backup',
        description: 'Daily backup of all databases (using borgmatic native hooks)',
        // No folder sources needed - databases stream directly to borg
        sources: [],
        compression: 'lz4',  // LZ4 - fast with good compression (databases compress well)
        archive_name_format: 'infinitytools-databases-{hostname}-{now:%Y-%m-%d-%H%M%S}',
        retention: {
            keep_daily: 14,  // 2 weeks of daily backups
            keep_weekly: 4,
            keep_monthly: 6
        },
        schedule: {
            name: 'Daily Database Backup',
            cron: '0 3 * * *', // Daily at 3 AM (1 hour after files backup)
            enabled: true
        },
        auto_discover: true, // Enable automatic database discovery
        // Use "all" to backup ALL databases on discovered servers
        use_all_databases: true
    },

    // Protection features
    protection: {
        canary_file: {
            enabled: false,
            description: 'Ransomware protection via canary file monitoring (opt-in)'
        },
        consistency_checks: {
            enabled: true,
            frequency: '2 weeks',
            description: 'Regular repository integrity checks'
        }
    },

    // Notification settings
    notifications: {
        on_success: true,
        on_failure: true,
        on_warning: true,
        requires_apprise: true,
        description: 'Notifications via Apprise (if configured)'
    },

    // Metadata
    metadata: {
        compatible_with: ['wordpress', 'nextcloud', 'vaultwarden', 'matomo', 'bookstack', 'keycloak'],
        source_paths: [BACKUP_SOURCE],
        backup_destination: BACKUP_DESTINATION,
        estimated_size: 'Varies based on installed applications',
        backup_frequency: {
            files: 'Daily at 2 AM',
            databases: 'Daily at 3 AM'
        },
        // Mount path info for documentation
        mount_info: {
            backup_source: BACKUP_SOURCE,
            backup_destination: BACKUP_DESTINATION,
            description: 'Host filesystem mounted at /host, apps at /host/opt/speedbits'
        }
    }
};

