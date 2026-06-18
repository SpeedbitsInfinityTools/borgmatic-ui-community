/**
 * Linux Server Backup Template
 *
 * A generic, category-based backup template for a typical Linux server.
 * Instead of asking the user for raw folder paths, the activation modal
 * presents backup CATEGORIES (User Data, System Configuration, Docker
 * Volumes, ...). Each ticked category maps to a set of well-known host
 * paths which become the source_directories of a real, editable backup job.
 *
 * Mount paths in Docker:
 * - The host filesystem is bind-mounted at /host inside the container, so a
 *   category path like "/etc" is emitted as "/host/etc". The host prefix is
 *   resolved at activation time (see template-manager.getHostPathPrefix()),
 *   NOT baked into this file, so the same template works for native installs.
 *
 * Categories whose `paths` array is empty are "virtual" categories handled by
 * special logic during activation:
 * - databases  -> reuses the database auto-discovery flow (separate DB job)
 * - dr_extras  -> adds disaster-recovery pre-backup hooks + package-db dirs
 */

// Backup destination path - where the borg repository is stored.
// In Docker, the host's backup directory is typically mounted to /backup-destination.
const BACKUP_DESTINATION = process.env.BACKUP_DESTINATION_PATH || '/backup-destination';

/**
 * Backup categories. `paths` use BARE (un-prefixed) absolute paths; the host
 * prefix (/host in Docker) is applied during activation.
 */
const CATEGORIES = [
    {
        id: 'user_data',
        label: 'User Data',
        description: 'Home directories and root account (documents, dotfiles, ~/.ssh, app settings)',
        default: true,
        paths: ['/home', '/root'],
    },
    {
        id: 'system_config',
        label: 'System Configuration',
        description: 'The entire /etc tree (network, SSH/web server config, users/groups, cron, SSL)',
        default: true,
        paths: ['/etc'],
    },
    {
        id: 'cron',
        label: 'Scheduled Tasks (cron)',
        description: 'User crontabs and system cron jobs (mostly already covered by /etc)',
        default: true,
        paths: [
            '/var/spool/cron',
            '/etc/crontab',
            '/etc/cron.d',
            '/etc/cron.daily',
            '/etc/cron.hourly',
            '/etc/cron.weekly',
            '/etc/cron.monthly',
        ],
    },
    {
        id: 'ssh_keys',
        label: 'SSH Host Keys',
        description: 'System SSH host keys and server config (/etc/ssh). User keys are under home directories.',
        default: true,
        paths: ['/etc/ssh'],
    },
    {
        id: 'ssl_certs',
        label: 'SSL Certificates',
        description: "Let's Encrypt and system SSL certificates",
        default: true,
        paths: ['/etc/letsencrypt', '/etc/ssl'],
    },
    {
        id: 'docker_volumes',
        label: 'Docker Volumes',
        description: 'Named Docker volumes (databases, app data). Excludes the Docker overlay/image layers.',
        default: true,
        paths: ['/var/lib/docker/volumes'],
    },
    {
        id: 'web',
        label: 'Web Sites',
        description: 'Website document roots (/var/www, /srv)',
        default: true,
        paths: ['/var/www', '/srv'],
    },
    {
        id: 'app_data',
        label: 'Application Data',
        description: 'Self-hosted application data (/opt, /srv, /var/lib). Docker overlay layers are excluded.',
        default: true,
        paths: ['/opt', '/srv', '/var/lib'],
    },
    {
        id: 'vms',
        label: 'Virtual Machines',
        description: 'KVM/QEMU (/var/lib/libvirt) and Proxmox (/etc/pve) configuration & disks',
        default: false,
        paths: ['/var/lib/libvirt', '/etc/pve'],
    },
    {
        id: 'mail',
        label: 'Mail Server Data',
        description: 'Mailboxes and mail server config (Postfix, Dovecot)',
        default: false,
        paths: ['/var/mail', '/var/spool/postfix', '/etc/postfix', '/etc/dovecot'],
    },
    {
        id: 'logs',
        label: 'System Logs',
        description: 'System logs (/var/log). Usually large and not required for recovery.',
        default: false,
        paths: ['/var/log'],
    },
    {
        id: 'databases',
        label: 'Databases (auto-discover)',
        description: 'Automatically find MySQL/MariaDB/PostgreSQL/MongoDB/SQLite and create a separate database backup job with proper dumps.',
        default: true,
        virtual: 'databases',
        paths: [],
    },
    {
        id: 'dr_extras',
        label: 'Disaster-Recovery State',
        description: 'Capture installed package list, crontab dumps and firewall rules (best-effort) plus the package database directories.',
        default: true,
        virtual: 'dr_extras',
        paths: [],
    },
];

// Exclude patterns ALWAYS applied to the files backup. The pseudo-filesystems
// are never sources, but we exclude them defensively in case a broad path is
// added later by the user. The Docker overlay/image excludes prevent the
// app_data category (/var/lib) from pulling the entire container layer store.
const EXCLUDE_PATTERNS = [
    // Pseudo / volatile filesystems
    '/proc',
    '/sys',
    '/dev',
    '/run',
    '/tmp',
    '/mnt',
    '/media',
    '/lost+found',
    // Docker layer store (volumes are backed up via the docker_volumes category)
    '*/var/lib/docker/overlay2/*',
    '*/var/lib/docker/image/*',
    '*/var/lib/docker/containers/*',
    '*/var/lib/docker/tmp/*',
    // Caches / temporary / build artifacts
    '*.tmp',
    '*/cache/*',
    '*/.cache/*',
    '*/tmp/*',
    '*/__pycache__/*',
    '*/node_modules/*',
    '*/.git/*',
    // Our own DR state staging dir is recreated each run; no need to also match it
];

module.exports = {
    id: 'linux-server',
    name: 'Linux Server Backup',
    description: 'Category-based backup for a generic Linux server. Pick what to back up (home, /etc, Docker volumes, web sites, databases, ...) and it creates editable backup jobs you can fine-tune afterwards.',
    version: '1.0.0',
    official: true,
    vendor: 'SpeedBits',
    icon: '🐧',

    // Repository configuration (mirrors the SpeedBits template shape)
    repository: {
        name: 'Local Linux Server Backup',
        path: `${BACKUP_DESTINATION}/borgmatic-repo`,
        storage_mode: 'direct',
        repository_type: 'local',
        encryption: 'repokey-blake2-aes-ocb',
        compression: 'lz4',
    },

    // Selectable backup categories surfaced in the activation modal
    categories: CATEGORIES,

    // Files backup configuration
    filesBackup: {
        name: 'Linux Server Files Backup',
        description: 'Backup of selected Linux server directories and configuration',
        exclude_patterns: EXCLUDE_PATTERNS,
        compression: 'lz4',
        archive_name_format: 'linux-server-files-{hostname}-{now:%Y-%m-%d-%H%M%S}',
        retention: {
            keep_daily: 7,
            keep_weekly: 4,
            keep_monthly: 6,
        },
        schedule: {
            name: 'Daily Linux Server Backup',
            cron: '0 2 * * *', // 2 AM daily
            enabled: true,
        },
    },

    // Database backup configuration (used when the `databases` category is selected)
    databaseBackup: {
        name: 'Linux Server Database Backup',
        description: 'Daily backup of auto-discovered databases (using borgmatic native hooks)',
        compression: 'lz4',
        archive_name_format: 'linux-server-databases-{hostname}-{now:%Y-%m-%d-%H%M%S}',
        retention: {
            keep_daily: 14,
            keep_weekly: 4,
            keep_monthly: 6,
        },
        schedule: {
            name: 'Daily Linux Database Backup',
            cron: '0 3 * * *', // 3 AM daily (1 hour after files backup)
            enabled: true,
        },
        auto_discover: true,
        use_all_databases: true,
    },

    // Protection features
    protection: {
        canary_file: {
            enabled: false,
            description: 'Ransomware protection via canary file monitoring (opt-in)',
        },
        consistency_checks: {
            enabled: true,
            frequency: '2 weeks',
            description: 'Regular repository integrity checks',
        },
    },

    metadata: {
        backup_frequency: {
            files: 'Daily at 2 AM',
            databases: 'Daily at 3 AM',
        },
        mount_info: {
            description: 'Host filesystem mounted at /host; category paths are prefixed with /host in Docker.',
        },
    },
};
