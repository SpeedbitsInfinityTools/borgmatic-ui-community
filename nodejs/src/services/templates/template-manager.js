/**
 * Template Manager Service
 * 
 * Manages backup configuration templates including activation,
 * validation, and lifecycle management.
 * 
 * NOTE: This module uses lazy loading for dependencies that may not exist yet.
 * The Infinity Tools template activation requires services that are only
 * available when the full backup system is configured.
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execa } = require('execa');

// Lazy-loaded dependencies (may not exist in all configurations)
let backupManager = null;
let repositoryManager = null;
let scheduleManager = null;
let canaryFile = null;
let databaseDiscovery = null;

/**
 * Lazy load a service module, returning null if not found
 */
function lazyLoad(modulePath, serviceName) {
    try {
        return require(modulePath);
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            console.warn(`⚠️  Template Manager: ${serviceName} not available (${modulePath})`);
            return null;
        }
        throw error;
    }
}

/**
 * Get services (lazy loaded on first use)
 */
function getServices() {
    if (!backupManager) backupManager = lazyLoad('../backup-manager', 'Backup Manager');
    if (!scheduleManager) scheduleManager = lazyLoad('../schedule-manager', 'Schedule Manager');
    if (!canaryFile) canaryFile = lazyLoad('../canary-file', 'Canary File');
    if (!databaseDiscovery) databaseDiscovery = lazyLoad('../database-discovery', 'Database Discovery');
    return { backupManager, scheduleManager, canaryFile, databaseDiscovery };
}

// Import built-in templates
const infinityToolsTemplate = require('./infinity-tools-template');
const linuxServerTemplate = require('./linux-server-template');

/**
 * Resolve the host filesystem prefix.
 *
 * In Docker the host root is bind-mounted at /host, so a category path like
 * "/etc" must be backed up as "/host/etc". On a native (non-Docker) install we
 * return an empty string and use bare paths.
 *
 * @returns {string} '/host' when the host fs is mounted there, otherwise ''
 */
function getHostPathPrefix() {
    try {
        if (fs.existsSync('/host/etc')) {
            return '/host';
        }
    } catch (_) {
        // ignore - fall through to native paths
    }
    return '';
}

/**
 * Discover Infinity Tools installation paths from /etc/infinitytools.conf
 * This file is created by the Infinity Tools installer and contains:
 *   INSTALL_DIR="/opt/infinitytools"
 *   DATA_ROOT="/opt/speedbits"
 * 
 * @returns {Object} Discovered paths or defaults
 */
async function discoverInfinityToolsPaths() {
    const defaults = {
        installDir: '/opt/infinitytools',
        dataRoot: '/opt/speedbits',
        discovered: false,
        configExists: false
    };

    try {
        // In Docker container, host filesystem is at /host
        const configPaths = [
            '/host/etc/infinitytools.conf',  // Docker container (host mounted at /host)
            '/etc/infinitytools.conf'         // Direct access (dev or non-Docker)
        ];

        for (const configPath of configPaths) {
            if (await fs.pathExists(configPath)) {
                const content = await fs.readFile(configPath, 'utf8');
                const result = { ...defaults, configExists: true };

                // Parse shell-style config file
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

                    const [key, ...valueParts] = trimmed.split('=');
                    const value = valueParts.join('=').replace(/^["']|["']$/g, '').trim();

                    if (key.trim() === 'INSTALL_DIR') {
                        result.installDir = value;
                    } else if (key.trim() === 'DATA_ROOT') {
                        result.dataRoot = value;
                    }
                }

                result.discovered = true;
                console.log(`✅ Discovered Infinity Tools paths from ${configPath}:`, result);
                return result;
            }
        }

        console.log('ℹ️ No infinitytools.conf found, using defaults');
        return defaults;
    } catch (error) {
        console.warn('⚠️ Error reading infinitytools.conf:', error.message);
        return defaults;
    }
}

class TemplateManager {
    constructor() {
        this.builtInTemplates = new Map();
        this.builtInTemplates.set('infinity-tools', infinityToolsTemplate);
        this.builtInTemplates.set('linux-server', linuxServerTemplate);
    }

    /**
     * Get discovered Infinity Tools paths
     */
    async getInfinityToolsPaths() {
        return discoverInfinityToolsPaths();
    }

    /**
     * Get all available templates
     */
    getAllTemplates() {
        const templates = [];

        // Add built-in templates
        for (const [id, template] of this.builtInTemplates) {
            templates.push({
                id,
                ...template,
                is_activated: this.isTemplateActivated(id)
            });
        }

        return templates;
    }

    /**
     * Get a specific template by ID
     */
    getTemplate(templateId) {
        return this.builtInTemplates.get(templateId);
    }

    /**
     * Check if a template is activated
     */
    isTemplateActivated(templateId) {
        // Synchronous check (used by getAllTemplates()).
        // A built-in template is considered activated if any of the backup-job
        // YAMLs it creates exist in borgmatic.d/.
        const expectedByTemplate = {
            'infinity-tools': [
                'SpeedBits System Backup.yaml',
                'SpeedBits Database Backup.yaml',
            ],
            'linux-server': [
                'Linux Server Files Backup.yaml',
                'Linux Server Database Backup.yaml',
            ],
        };

        const expected = expectedByTemplate[templateId];
        if (!expected) return false;

        try {
            const config = require('../../config');
            const borgmaticDir = path.join(config.configDir, 'borgmatic.d');
            return expected.some((filename) => fs.existsSync(path.join(borgmaticDir, filename)));
        } catch (e) {
            return false;
        }
    }

    /**
     * Activate Infinity Tools template
     * @param {Object} options
     * @param {string} options.passphrase - Passphrase for repository encryption
     * @param {string} options.repository_option - 'create' or 'select'
     * @param {string} options.repository_path - Path for new repository (if creating)
     * @param {string} options.repository_id - ID of existing repository (if selecting)
     * @param {string} options.log_file_path - Path for log file (optional)
     * @param {string} options.backup_source_path - Custom backup source path (optional, defaults to discovered or /host/opt/speedbits)
     */
    async activateInfinityToolsTemplate(options = {}) {
        // Get lazy-loaded services
        const services = getServices();

        const template = this.builtInTemplates.get('infinity-tools');
        if (!template) {
            throw new Error('Template not found');
        }

        // Check if already activated
        if (this.isTemplateActivated('infinity-tools')) {
            throw new Error('Infinity Tools template is already activated');
        }

        // Validate required services
        if (!services.backupManager) {
            throw new Error('Backup Manager not available');
        }

        const result = {
            template_id: 'infinity-tools',
            steps: [],
            created: {
                repository_path: null,
                files_backup: null,
                database_backup: null,
                files_schedule: null,
                database_schedule: null,
                canary_file: null
            }
        };

        try {
            // Step 1: Canary file protection (opt-in)
            // For now, we keep this disabled by default for Infinity Tools activation.
            // Users can enable canary monitoring later via the Backup Wizard (Advanced settings).
            if (template.protection?.canary_file?.enabled && services.canaryFile) {
                result.steps.push('Initializing canary file protection...');
                try {
                    const canaryResult = await services.canaryFile.initialize();
                    result.created.canary_file = canaryResult;
                    result.steps.push('✅ Canary file protection enabled');
                } catch (canaryError) {
                    result.steps.push(`⚠️ Canary file setup skipped: ${canaryError.message}`);
                }
            } else {
                result.steps.push('ℹ️ Canary file protection is disabled by default (enable later in Backup → Advanced).');
            }

            // Step 2-3: Provision repository, passphrase and borg init (shared helper)
            const { repositoryPath, passphrase, borgVersion } = await this._provisionRepository(options, {
                defaultRepositoryPath: template.repository.path,
                repoName: 'Infinity Tools Backup Repository',
                compression: template.repository.compression,
            }, result);

            // Step 4: Get retention profile
            const retentionProfiles = await this.getRetentionProfiles();
            const defaultRetention = retentionProfiles.find(p => p.name === 'Conservative')
                || retentionProfiles[0];

            // Step 5: Create files backup job
            result.steps.push('Creating files backup job...');

            // Determine log file path - use system-managed path if not specified
            const logManager = require('../log-manager');
            const logFilePath = options.log_file_path || logManager.getBorgmaticLogPath();

            // Determine backup source path - use provided path, or auto-discover, or default
            let backupSourcePath = options.backup_source_path ? String(options.backup_source_path).trim() : '';
            if (!backupSourcePath) {
                const discoveredPaths = await discoverInfinityToolsPaths();
                // In Docker, we need to prefix with /host since host filesystem is mounted there
                backupSourcePath = `/host${discoveredPaths.dataRoot}`;
            }
            result.steps.push(`✅ Backup source path: ${backupSourcePath}`);
            result.created.backup_source_path = backupSourcePath;

            const filesBackupData = {
                name: template.filesBackup.name,
                description: template.filesBackup.description,
                // BackupManager expects sources as objects ({type:'local', path})
                // Use custom backup source path instead of template default
                sources: [{ type: 'local', path: backupSourcePath }],
                repositories: [{ path: repositoryPath, label: 'Infinity Tools Repo' }],
                // Never include passphrase in backup payloads for existing repos.
                ...(passphrase ? { repository_passphrase: passphrase } : {}),
                retention_profile_id: defaultRetention.id,
                compression: template.filesBackup.compression,
                exclude_patterns: template.filesBackup.exclude_patterns,
                archive_name_format: template.filesBackup.archive_name_format,
                log_file: logFilePath,
                is_active: true,
                borg_version: borgVersion, // Pass Borg version so correct binary is used
                metadata: {
                    template_id: 'infinity-tools',
                    type: 'files',
                    created_at: new Date().toISOString()
                }
            };

            // Add canary check if enabled
            if (template.protection.canary_file.enabled && services.canaryFile) {
                try {
                    filesBackupData.pre_backup_commands = [
                        services.canaryFile.getPreBackupCommand()
                    ];
                } catch (e) {
                    console.warn('Could not add canary check to files backup:', e.message);
                }
            }

            const filesBackup = await services.backupManager.createBackup(filesBackupData);
            result.created.files_backup = filesBackup;
            result.steps.push(`✅ Files backup job created: ${filesBackup.name}`);

            // Step 6: Create files backup schedule (shared helper)
            result.steps.push('Creating files backup schedule...');
            result.created.files_schedule = await this._createScheduleForBackup(
                filesBackup, template.filesBackup.schedule, result
            );

            // Step 7: Auto-discover databases and create database backup job
            result.steps.push('Auto-discovering databases...');

            // Build database sources from auto-discovery
            let databaseSources = [];
            let discoveredCount = 0;

            if (template.databaseBackup.auto_discover && services.databaseDiscovery) {
                try {
                    // Run database discovery WITH credentials (internal use - passwords stay server-side).
                    //
                    // We deliberately scan EVERY container the Docker daemon can see
                    // (`includeHost: true`) rather than only the opinionated
                    // `borgmatic-db` network. The Infinity template promises to
                    // automatically find databases on this host — restricting it to
                    // one specific Docker network silently misses every standard
                    // Compose deployment (Wordpress, Nextcloud, ...) where the DB
                    // container is on `<app>_default`.
                    const discoveryResult = await services.databaseDiscovery.discoverDatabasesWithCredentials({
                        includeHost: true,
                        forceRefresh: true
                    });

                    if (discoveryResult.databases && discoveryResult.databases.length > 0) {
                        discoveredCount = discoveryResult.databases.length;
                        result.steps.push(`✅ Found ${discoveredCount} database container(s)`);

                        // Group by container/host for "all" databases approach
                        // SQLite is handled separately (doesn't support "all")
                        const hosts = new Map();
                        const sqliteDatabases = [];

                        for (const db of discoveryResult.databases) {
                            // SQLite databases need special handling - they don't support "all"
                            // and require a path instead of hostname/port
                            if (db.type === 'sqlite') {
                                if (db.path) {
                                    sqliteDatabases.push({
                                        type: 'sqlite',
                                        database_name: db.database || path.basename(db.path, '.sqlite'),
                                        path: db.path,
                                        discovered: true
                                    });
                                }
                                continue;
                            }

                            // For other databases, group by host to use "all"
                            const hostKey = db.container || db.hostname || 'localhost';
                            if (!hosts.has(hostKey)) {
                                hosts.set(hostKey, {
                                    type: db.type,
                                    // For containerized DBs, hostname should be the container name on borgmatic-db network
                                    hostname: db.container || db.hostname,
                                    port: db.port,
                                    username: db.username || (db.type === 'postgresql' ? 'postgres' : 'root'),
                                    password: db.password || '',
                                    // Flag for host databases (accessible via host.docker.internal via extra_hosts)
                                    is_host_database: db.is_host_database || false
                                });
                            }
                        }

                        // Create source for each unique host with "all" databases
                        for (const [hostKey, hostInfo] of hosts) {
                            const dbSource = {
                                type: hostInfo.type,
                                database_name: template.databaseBackup.use_all_databases ? 'all' : hostInfo.database_name,
                                hostname: hostInfo.hostname,
                                port: hostInfo.port,
                                username: hostInfo.username,
                                password: hostInfo.password,
                                discovered: true
                            };

                            // Mark host databases for proper hostname handling
                            if (hostInfo.is_host_database) {
                                dbSource.is_host_database = true;
                                dbSource.hostname = 'host.docker.internal';
                            }

                            databaseSources.push(dbSource);

                            // Log with connection method info
                            const connMethod = hostInfo.is_host_database ? 'host.docker.internal' : 'docker network';
                            result.steps.push(`  → ${hostInfo.type}: ${hostKey} (${template.databaseBackup.use_all_databases ? 'all databases' : 'specific DB'}, ${connMethod})`);
                        }

                        // Add SQLite databases (each one individually since "all" doesn't work)
                        for (const sqliteDb of sqliteDatabases) {
                            databaseSources.push(sqliteDb);
                            result.steps.push(`  → sqlite: ${sqliteDb.path}`);
                        }
                    } else {
                        result.steps.push('⚠️ No databases discovered - backup will be created but empty');
                    }
                } catch (discoverError) {
                    console.warn('Database discovery failed:', discoverError.message);
                    result.steps.push(`⚠️ Database discovery failed: ${discoverError.message}`);
                }
            }

            result.steps.push('Creating database backup job...');
            const databaseBackupData = {
                name: template.databaseBackup.name,
                description: template.databaseBackup.description,
                // Use discovered database sources (with proper hooks) instead of folder backup
                sources: databaseSources,
                repositories: [{ path: repositoryPath, label: 'Infinity Tools Repo' }],
                // Never include passphrase in backup payloads for existing repos.
                ...(passphrase ? { repository_passphrase: passphrase } : {}),
                retention_profile_id: defaultRetention.id,
                compression: template.databaseBackup.compression,
                archive_name_format: template.databaseBackup.archive_name_format,
                log_file: logFilePath,
                is_active: true,
                borg_version: borgVersion, // Pass Borg version so correct binary is used
                metadata: {
                    template_id: 'infinity-tools',
                    type: 'databases',
                    auto_discover: template.databaseBackup.auto_discover,
                    discovered_count: discoveredCount,
                    created_at: new Date().toISOString()
                }
            };

            // Add canary check for database backup too
            if (template.protection.canary_file.enabled && services.canaryFile) {
                try {
                    databaseBackupData.pre_backup_commands = [
                        services.canaryFile.getPreBackupCommand()
                    ];
                } catch (e) {
                    console.warn('Could not add canary check to database backup:', e.message);
                }
            }

            console.log('📦 Creating database backup with data:', JSON.stringify({
                name: databaseBackupData.name,
                sources_count: databaseBackupData.sources?.length || 0,
                repositories_count: databaseBackupData.repositories?.length || 0
            }));

            try {
                const databaseBackup = await services.backupManager.createBackup(databaseBackupData);
                result.created.database_backup = databaseBackup;
                result.steps.push(`✅ Database backup job created: ${databaseBackup.name} (${discoveredCount} source${discoveredCount !== 1 ? 's' : ''})`);

                // Step 8: Create database backup schedule (shared helper)
                result.steps.push('Creating database backup schedule...');
                result.created.database_schedule = await this._createScheduleForBackup(
                    databaseBackup, template.databaseBackup.schedule, result
                );
            } catch (dbBackupError) {
                console.error('❌ Database backup creation failed:', dbBackupError.message, dbBackupError.stack);
                result.steps.push(`⚠️ Database backup creation failed: ${dbBackupError.message}`);
                // Continue without failing the whole activation - files backup is already created
                result.warnings = result.warnings || [];
                result.warnings.push(`Database backup creation failed: ${dbBackupError.message}`);
            }

            // Step 9: (Optional) Save passphrase to file (DISABLED by default for security).
            // If needed for legacy workflows, set INFINITY_TOOLS_WRITE_PASSPHRASE_FILE=true.
            if (String(process.env.INFINITY_TOOLS_WRITE_PASSPHRASE_FILE || '').toLowerCase() === 'true') {
                await this.savePassphrase(passphrase);
                result.steps.push('✅ Passphrase saved to file (legacy mode enabled)');
            } else {
                result.steps.push('✅ Passphrase stored in vault (recommended)');
            }

            result.success = true;
            if (result.warnings && result.warnings.length > 0) {
                result.message = `Infinity Tools backup activated with ${result.warnings.length} warning(s)`;
                result.partial_success = true;
            } else {
                result.message = 'Infinity Tools backup activated successfully';
            }

            return result;

        } catch (error) {
            // Rollback on error
            console.error('Template activation failed:', error);
            result.success = false;
            result.error = error.message;
            result.steps.push(`❌ Error: ${error.message}`);

            // Attempt cleanup
            await this.cleanupFailedActivation(result.created);

            throw error;
        }
    }

    /**
     * Deactivate Infinity Tools template
     */
    async deactivateInfinityToolsTemplate() {
        const services = getServices();

        try {
            const template = this.builtInTemplates.get('infinity-tools');
            const backups = services.backupManager?.getAllBackups ? await services.backupManager.getAllBackups() : [];
            const templateNames = new Set([
                template?.filesBackup?.name,
                template?.databaseBackup?.name,
            ].filter(Boolean));

            // Find all backup jobs by name (matches YAML/metadata)
            const templateBackups = backups.filter(b => templateNames.has(b.name));

            const result = {
                deleted: {
                    backups: [],
                    schedules: []
                }
            };

            // Delete schedules and backups
            for (const backup of templateBackups) {
                // Delete associated schedule if linked via schedule_id
                if (backup.schedule_id && services.scheduleManager?.deleteSchedule) {
                    try {
                        await services.scheduleManager.deleteSchedule(backup.schedule_id);
                        result.deleted.schedules.push(backup.schedule_id);
                    } catch (e) {
                        // ignore
                    }
                }

                // Delete backup
                if (services.backupManager?.deleteBackup) {
                    await services.backupManager.deleteBackup(backup.id);
                    result.deleted.backups.push(backup.id);
                }
            }

            result.success = true;
            result.message = 'Infinity Tools template deactivated';
            return result;

        } catch (error) {
            throw new Error(`Failed to deactivate template: ${error.message}`);
        }
    }

    // ===================================================================
    // SHARED ACTIVATION HELPERS (used by Infinity Tools + Linux Server)
    // ===================================================================

    /**
     * Provision a borg repository for a template activation.
     *
     * Handles both "use existing" and "create new" flows, generates/stores the
     * passphrase, initializes the borg repo and registers it. Pushes
     * human-readable progress into result.steps and records the path/version
     * into result.created.
     *
     * @param {Object} options - activation options (repository_option, repository_path, repository_id, passphrase, borg_version)
     * @param {Object} meta - { defaultRepositoryPath, repoName, compression }
     * @param {Object} result - mutable result accumulator
     * @returns {Promise<{repositoryPath:string, passphrase:(string|null), borgVersion:string, needsRepoInit:boolean}>}
     */
    async _provisionRepository(options, meta, result) {
        let repositoryPath;
        let needsRepoInit = false;

        if (options.repository_option === 'select' && options.repository_id) {
            const configParser = require('../config-parser');
            const allRepos = await configParser.getAllRepositoriesWithUsage();
            let selectedRepo = allRepos.find(r => r.id === options.repository_id);

            // Fallback: repositories parsed from existing configs may not carry a
            // stable id (the UI assigns synthetic "repo-legacy-N" ids based on list
            // order, which won't match here). Match on the path when it was sent.
            if (!selectedRepo && options.repository_path) {
                const normalize = (p) => {
                    if (!p) return p;
                    if (p.startsWith('ssh://') || p.startsWith('s3:') || p.startsWith('rclone:')) return p;
                    return path.normalize(p);
                };
                const target = normalize(options.repository_path);
                selectedRepo = allRepos.find(r => normalize(r.path) === target);
            }

            if (!selectedRepo) {
                throw new Error(`Repository not found: ${options.repository_id}`);
            }

            repositoryPath = selectedRepo.path;
            result.steps.push(`✅ Using existing repository: ${selectedRepo.name || selectedRepo.label || repositoryPath}`);
        } else {
            repositoryPath = options.repository_path || meta.defaultRepositoryPath;
            needsRepoInit = true;
            result.steps.push(`✅ Will create repository at: ${repositoryPath}`);
        }
        result.created.repository_path = repositoryPath;

        // Determine passphrase behavior.
        // - Creating a new repo: must have a passphrase (auto-generate if absent).
        // - Selecting an existing repo: NEVER auto-generate (it would be wrong).
        let passphrase = null;
        const wantsAuto = options.passphrase === 'AUTO_GENERATE' || !options.passphrase;
        if (needsRepoInit) {
            passphrase = wantsAuto ? this.generateSecurePassphrase() : options.passphrase;
            result.steps.push('✅ Repository passphrase generated');
        } else {
            passphrase = wantsAuto ? null : options.passphrase;
            result.steps.push('ℹ️ Using existing repository (passphrase not changed)');
        }

        const borgVersion = options.borg_version || '1.x';
        const useBorg2 = borgVersion === '2.x';
        const encryption = useBorg2 ? 'repokey-blake2-aes-ocb' : 'repokey-blake2';

        if (needsRepoInit) {
            result.steps.push('Initializing Borg repository...');
            const borgBinary = useBorg2 ? 'borg2' : 'borg1';

            try {
                await fs.ensureDir(repositoryPath);
                result.steps.push(`✅ Created directory: ${repositoryPath}`);

                if (useBorg2) {
                    await execa(borgBinary, [
                        '-r', repositoryPath,
                        'repo-create',
                        `--encryption=${encryption}`,
                    ], {
                        env: { ...process.env, BORG_PASSPHRASE: passphrase },
                        timeout: 60000
                    });
                    result.steps.push(`✅ Borg 2.x repository initialized with ${encryption} encryption (AEAD)`);
                } else {
                    await execa(borgBinary, [
                        'init',
                        `--encryption=${encryption}`,
                        repositoryPath
                    ], {
                        env: { ...process.env, BORG_PASSPHRASE: passphrase },
                        timeout: 60000
                    });
                    result.steps.push(`✅ Borg 1.x repository initialized with ${encryption} encryption`);
                }

                result.created.borg_version = borgVersion;
            } catch (initError) {
                if (initError.stderr?.includes('already exists') || initError.message?.includes('already exists')) {
                    result.steps.push('⚠️ Repository already exists at this path - using existing');
                } else {
                    throw new Error(`Failed to initialize repository: ${initError.message}`);
                }
            }

            // Register the repository with a proper name
            try {
                const configParser = require('../config-parser');
                await configParser.addUnusedRepository({
                    name: meta.repoName,
                    path: repositoryPath,
                    encryption: encryption,
                    compression: meta.compression || 'lz4',
                    repository_type: 'local',
                    borg_version: borgVersion,
                });
                result.steps.push(`✅ Repository registered: ${meta.repoName}`);
            } catch (regError) {
                if (!regError.message?.includes('already exists')) {
                    console.warn('Could not register repository:', regError.message);
                }
            }
        }

        // Store passphrase in vault (only if we actually have one)
        if (passphrase) {
            try {
                const passwordManager = require('../password-manager');
                await passwordManager.storeRepositoryPassphrase(repositoryPath, passphrase);
                result.steps.push('✅ Passphrase stored in vault');
            } catch (pwError) {
                console.error('❌ Could not store passphrase in vault:', pwError.message);
                result.steps.push('⚠️ Passphrase not stored in vault (save it manually!)');
            }
        } else {
            result.steps.push('ℹ️ No passphrase provided for existing repository (vault not updated)');
        }

        return { repositoryPath, passphrase, borgVersion, needsRepoInit };
    }

    /**
     * Find or create a schedule for a backup job and link it via metadata.
     *
     * @param {Object} backup - created backup object (must have .id)
     * @param {Object} scheduleSpec - { name, cron }
     * @param {Object} result - mutable result accumulator
     * @returns {Promise<Object|null>} the schedule, or null if unavailable
     */
    async _createScheduleForBackup(backup, scheduleSpec, result) {
        const services = getServices();
        try {
            const schedules = services.scheduleManager?.getAllSchedules
                ? await services.scheduleManager.getAllSchedules()
                : [];

            const schedule =
                schedules.find(s => s.cron_expression === scheduleSpec.cron) ||
                (services.scheduleManager?.createSchedule
                    ? await services.scheduleManager.createSchedule({
                        name: scheduleSpec.name,
                        cron_expression: scheduleSpec.cron,
                    })
                    : null);

            // Link schedule to backup metadata so the UI shows it
            try {
                if (schedule?.id && services.backupManager?.updateBackupMetadata) {
                    await services.backupManager.updateBackupMetadata(backup.id, { schedule_id: schedule.id });
                }
            } catch (e) {
                console.warn('Could not link schedule to backup metadata:', e.message);
            }

            if (schedule) {
                result.steps.push(`✅ Schedule created: ${schedule.name}`);
            } else {
                result.steps.push('⚠️ Schedule not created (schedule manager unavailable)');
            }
            return schedule;
        } catch (scheduleError) {
            console.warn('Failed to create schedule:', scheduleError.message);
            result.steps.push(`⚠️ Schedule not created: ${scheduleError.message}`);
            return null;
        }
    }

    /**
     * Auto-discover databases and build borgmatic database source objects.
     *
     * Shared by the Infinity Tools and Linux Server templates.
     *
     * @param {Object} template - template with a databaseBackup config
     * @param {Object} result - mutable result accumulator
     * @returns {Promise<{databaseSources:Array, discoveredCount:number}>}
     */
    async _discoverDatabaseSources(template, result) {
        const services = getServices();
        const databaseSources = [];
        let discoveredCount = 0;

        if (!(template.databaseBackup.auto_discover && services.databaseDiscovery)) {
            return { databaseSources, discoveredCount };
        }

        try {
            // Scan EVERY container the Docker daemon can see (includeHost: true)
            // so standard Compose deployments are not missed.
            const discoveryResult = await services.databaseDiscovery.discoverDatabasesWithCredentials({
                includeHost: true,
                forceRefresh: true
            });

            if (discoveryResult.databases && discoveryResult.databases.length > 0) {
                discoveredCount = discoveryResult.databases.length;
                result.steps.push(`✅ Found ${discoveredCount} database container(s)`);

                const hosts = new Map();
                const sqliteDatabases = [];

                for (const db of discoveryResult.databases) {
                    // SQLite databases don't support "all" and need a path
                    if (db.type === 'sqlite') {
                        if (db.path) {
                            sqliteDatabases.push({
                                type: 'sqlite',
                                database_name: db.database || path.basename(db.path, '.sqlite'),
                                path: db.path,
                                discovered: true
                            });
                        }
                        continue;
                    }

                    const hostKey = db.container || db.hostname || 'localhost';
                    if (!hosts.has(hostKey)) {
                        hosts.set(hostKey, {
                            type: db.type,
                            hostname: db.container || db.hostname,
                            port: db.port,
                            username: db.username || (db.type === 'postgresql' ? 'postgres' : 'root'),
                            password: db.password || '',
                            is_host_database: db.is_host_database || false
                        });
                    }
                }

                for (const [hostKey, hostInfo] of hosts) {
                    const dbSource = {
                        type: hostInfo.type,
                        database_name: template.databaseBackup.use_all_databases ? 'all' : hostInfo.database_name,
                        hostname: hostInfo.hostname,
                        port: hostInfo.port,
                        username: hostInfo.username,
                        password: hostInfo.password,
                        discovered: true
                    };

                    if (hostInfo.is_host_database) {
                        dbSource.is_host_database = true;
                        dbSource.hostname = 'host.docker.internal';
                    }

                    databaseSources.push(dbSource);

                    const connMethod = hostInfo.is_host_database ? 'host.docker.internal' : 'docker network';
                    result.steps.push(`  → ${hostInfo.type}: ${hostKey} (${template.databaseBackup.use_all_databases ? 'all databases' : 'specific DB'}, ${connMethod})`);
                }

                for (const sqliteDb of sqliteDatabases) {
                    databaseSources.push(sqliteDb);
                    result.steps.push(`  → sqlite: ${sqliteDb.path}`);
                }
            } else {
                result.steps.push('⚠️ No databases discovered - backup will be created but empty');
            }
        } catch (discoverError) {
            console.warn('Database discovery failed:', discoverError.message);
            result.steps.push(`⚠️ Database discovery failed: ${discoverError.message}`);
        }

        return { databaseSources, discoveredCount };
    }

    // ===================================================================
    // LINUX SERVER TEMPLATE
    // ===================================================================

    /**
     * Remove paths that are nested inside another selected path.
     * e.g. ['/host/etc', '/host/etc/ssh'] -> ['/host/etc']
     */
    _dedupeNestedPaths(paths) {
        const unique = Array.from(new Set(paths));
        // Sort ascending so shorter parents come first
        const sorted = unique.sort();
        const kept = [];
        for (const p of sorted) {
            const covered = kept.some(parent => p === parent || p.startsWith(parent.endsWith('/') ? parent : parent + '/'));
            if (!covered) {
                kept.push(p);
            }
        }
        return kept;
    }

    /**
     * Map selected category ids to host-prefixed, de-duplicated source paths.
     */
    _buildLinuxSources(template, selectedIds, hostPrefix) {
        const paths = [];
        for (const category of template.categories) {
            if (!selectedIds.includes(category.id)) continue;
            if (category.virtual) continue; // databases / dr_extras handled separately
            for (const p of (category.paths || [])) {
                paths.push(hostPrefix ? `${hostPrefix}${p}` : p);
            }
        }
        return this._dedupeNestedPaths(paths);
    }

    /**
     * Build disaster-recovery extras: extra source dirs + best-effort
     * pre-backup hooks that capture package lists, crontabs and firewall rules.
     *
     * Hooks run inside the (Alpine) borgmatic container, so host tooling is
     * reached via `chroot <hostPrefix>` when running in Docker. Everything is
     * best-effort (`|| true`) so a missing tool never fails the backup.
     */
    _buildDrExtras(hostPrefix) {
        const hostRoot = hostPrefix || '';
        const drDir = `${hostRoot}/var/lib/borgmatic-ui/dr-state`;
        const chrootPrefix = hostPrefix ? `chroot ${hostPrefix} ` : '';

        const hooks = [
            `mkdir -p '${drDir}'`,
            // Installed package list (Debian/Ubuntu, then RPM). Fall back to copying the on-disk dpkg status.
            `{ ${chrootPrefix}dpkg --get-selections > '${drDir}/packages-dpkg.txt' 2>/dev/null; } || cp '${hostRoot}/var/lib/dpkg/status' '${drDir}/dpkg-status.txt' 2>/dev/null || true`,
            `{ ${chrootPrefix}rpm -qa > '${drDir}/packages-rpm.txt' 2>/dev/null; } || true`,
            // Per-user crontabs
            `{ ${chrootPrefix}sh -c 'for u in $(cut -d: -f1 /etc/passwd); do echo "### $u"; crontab -l -u "$u" 2>/dev/null; done' > '${drDir}/crontabs.txt' 2>/dev/null; } || true`,
            // Firewall rules (iptables + nftables)
            `{ ${chrootPrefix}iptables-save > '${drDir}/iptables.txt' 2>/dev/null; } || true`,
            `{ ${chrootPrefix}nft list ruleset > '${drDir}/nftables.txt' 2>/dev/null; } || true`,
        ];

        // Source dirs: the staging dir plus the on-disk package databases (the
        // most reliable disaster-recovery artifact). Nested-path dedupe later
        // collapses these if a broader category like /var/lib is also selected.
        const sourcePaths = [
            drDir,
            `${hostRoot}/var/lib/dpkg`,
            `${hostRoot}/var/lib/rpm`,
        ];

        return { hooks, sourcePaths };
    }

    /**
     * Activate the Linux Server backup template.
     *
     * @param {Object} options
     * @param {string[]} options.categories - selected category ids (defaults to template defaults)
     * @param {string} options.passphrase
     * @param {string} options.repository_option - 'create' | 'select'
     * @param {string} options.repository_path
     * @param {string} options.repository_id
     * @param {string} options.log_file_path
     * @param {string} options.borg_version - '1.x' | '2.x'
     * @param {string} [options.source_type] - 'local' (default) | 'remote'
     * @param {Object} [options.ssh] - remote connection { host, port, username, auth_method, ssh_key_id, ssh_password, use_sftp } (required when source_type==='remote')
     */
    async activateLinuxServerTemplate(options = {}) {
        const services = getServices();

        const template = this.builtInTemplates.get('linux-server');
        if (!template) {
            throw new Error('Template not found');
        }

        if (this.isTemplateActivated('linux-server')) {
            throw new Error('Linux Server template is already activated');
        }

        if (!services.backupManager) {
            throw new Error('Backup Manager not available');
        }

        // Determine the backup target: the local server (default) or a remote
        // server reached over SSH/SFTP (files are sshfs-mounted at backup time).
        const isRemote = options.source_type === 'remote';
        const ssh = options.ssh || {};
        const sshAuthMethod = ssh.auth_method === 'password' ? 'password' : 'key';

        if (isRemote) {
            if (!ssh.host || !String(ssh.host).trim()) {
                throw new Error('Remote backup requires an SSH host');
            }
            if (!ssh.username || !String(ssh.username).trim()) {
                throw new Error('Remote backup requires an SSH username');
            }
            if (sshAuthMethod === 'key' && !ssh.ssh_key_id) {
                throw new Error('Remote backup requires an SSH key for key authentication');
            }
            if (sshAuthMethod === 'password' && !ssh.ssh_password) {
                throw new Error('Remote backup requires an SSH password for password authentication');
            }
        }

        // Resolve selected categories (fall back to the template defaults)
        let selectedCategories = Array.isArray(options.categories) && options.categories.length > 0
            ? options.categories
            : template.categories.filter(c => c.default).map(c => c.id);

        // Database auto-discovery (scans the local Docker daemon) and
        // disaster-recovery capture (chroots into the local /host mount) only work
        // for the local server, so they are dropped for a remote SSH target.
        if (isRemote) {
            selectedCategories = selectedCategories.filter(id => id !== 'databases' && id !== 'dr_extras');
        }

        const result = {
            template_id: 'linux-server',
            steps: [],
            created: {
                repository_path: null,
                files_backup: null,
                database_backup: null,
                files_schedule: null,
                database_schedule: null,
            }
        };

        try {
            // For a remote target the only valid categories are file categories;
            // give a clear message instead of the generic "no jobs created" guard.
            if (isRemote && selectedCategories.length === 0) {
                throw new Error('Select at least one file category for a remote backup. Databases and disaster-recovery capture are only available for the local server.');
            }

            result.steps.push(`ℹ️ Selected categories: ${selectedCategories.join(', ')}`);
            result.steps.push('ℹ️ Canary file protection is disabled by default (enable later in Backup → Advanced).');

            // Step 1: Provision repository (shared)
            const { repositoryPath, passphrase, borgVersion } = await this._provisionRepository(options, {
                defaultRepositoryPath: template.repository.path,
                repoName: 'Linux Server Backup Repository',
                compression: template.repository.compression,
            }, result);

            // Step 2: Retention + log path
            const retentionProfiles = await this.getRetentionProfiles();
            const defaultRetention = retentionProfiles.find(p => p.name === 'Conservative') || retentionProfiles[0];

            const logManager = require('../log-manager');
            const logFilePath = options.log_file_path || logManager.getBorgmaticLogPath();

            // Step 3: Build file source paths from selected categories.
            // Local target: prefix with /host in Docker. Remote target: bare paths
            // on the remote server (sshfs-mounted at backup time, so no prefix).
            const hostPrefix = isRemote ? '' : getHostPathPrefix();
            if (isRemote) {
                result.steps.push(`ℹ️ Remote target ${ssh.username}@${ssh.host} (files mounted via sshfs/SFTP at backup time)`);
            } else {
                result.steps.push(hostPrefix
                    ? `ℹ️ Host filesystem detected at ${hostPrefix} (paths prefixed accordingly)`
                    : 'ℹ️ Using native paths (no /host prefix)');
            }

            let sources = this._buildLinuxSources(template, selectedCategories, hostPrefix);

            // Step 3b: Disaster-recovery extras (LOCAL target only)
            let drHooks = [];
            if (!isRemote && selectedCategories.includes('dr_extras')) {
                const dr = this._buildDrExtras(hostPrefix);
                drHooks = dr.hooks;
                sources = this._dedupeNestedPaths([...sources, ...dr.sourcePaths]);
                result.steps.push('✅ Disaster-recovery capture enabled (package list, crontabs, firewall - best-effort)');
            }

            result.created.backup_sources = sources;

            // Step 4: Create files backup job (only if there are file sources)
            if (sources.length > 0) {
                result.steps.push(`✅ Files backup sources (${sources.length}): ${sources.join(', ')}`);
                result.steps.push('Creating files backup job...');

                // Remote target: each path becomes an SSH source (sshfs-mounted).
                // Local target: each path is a plain local directory.
                const fileSourceObjects = isRemote
                    ? sources.map(p => ({
                        type: 'ssh',
                        host: String(ssh.host).trim(),
                        port: Number.isInteger(ssh.port) ? ssh.port : (parseInt(ssh.port, 10) || 22),
                        username: String(ssh.username).trim(),
                        auth_method: sshAuthMethod,
                        ssh_key_id: sshAuthMethod === 'key' ? ssh.ssh_key_id : undefined,
                        ssh_password: sshAuthMethod === 'password' ? ssh.ssh_password : undefined,
                        use_sftp: ssh.use_sftp !== false,
                        remote_path: p,
                    }))
                    : sources.map(p => ({ type: 'local', path: p }));

                const filesBackupData = {
                    name: template.filesBackup.name,
                    description: template.filesBackup.description,
                    sources: fileSourceObjects,
                    repositories: [{ path: repositoryPath, label: 'Linux Server Repo' }],
                    ...(passphrase ? { repository_passphrase: passphrase } : {}),
                    retention_profile_id: defaultRetention.id,
                    compression: template.filesBackup.compression,
                    exclude_patterns: template.filesBackup.exclude_patterns,
                    archive_name_format: template.filesBackup.archive_name_format,
                    log_file: logFilePath,
                    is_active: true,
                    borg_version: borgVersion,
                    metadata: {
                        template_id: 'linux-server',
                        type: 'files',
                        categories: selectedCategories,
                        target: isRemote ? 'remote' : 'local',
                        ...(isRemote ? { remote_host: `${String(ssh.username).trim()}@${String(ssh.host).trim()}` } : {}),
                        created_at: new Date().toISOString()
                    }
                };

                if (drHooks.length > 0) {
                    filesBackupData.hooks = { before_backup: drHooks };
                }

                const filesBackup = await services.backupManager.createBackup(filesBackupData);
                result.created.files_backup = filesBackup;
                result.steps.push(`✅ Files backup job created: ${filesBackup.name}`);

                result.steps.push('Creating files backup schedule...');
                result.created.files_schedule = await this._createScheduleForBackup(
                    filesBackup, template.filesBackup.schedule, result
                );
            } else {
                result.steps.push('ℹ️ No file categories selected - skipping files backup job');
            }

            // Step 5: Database backup job (auto-discovery) when selected
            if (selectedCategories.includes('databases')) {
                result.steps.push('Auto-discovering databases...');
                const { databaseSources, discoveredCount } = await this._discoverDatabaseSources(template, result);

                result.steps.push('Creating database backup job...');
                const databaseBackupData = {
                    name: template.databaseBackup.name,
                    description: template.databaseBackup.description,
                    sources: databaseSources,
                    repositories: [{ path: repositoryPath, label: 'Linux Server Repo' }],
                    ...(passphrase ? { repository_passphrase: passphrase } : {}),
                    retention_profile_id: defaultRetention.id,
                    compression: template.databaseBackup.compression,
                    archive_name_format: template.databaseBackup.archive_name_format,
                    log_file: logFilePath,
                    is_active: true,
                    borg_version: borgVersion,
                    metadata: {
                        template_id: 'linux-server',
                        type: 'databases',
                        auto_discover: template.databaseBackup.auto_discover,
                        discovered_count: discoveredCount,
                        created_at: new Date().toISOString()
                    }
                };

                try {
                    const databaseBackup = await services.backupManager.createBackup(databaseBackupData);
                    result.created.database_backup = databaseBackup;
                    result.steps.push(`✅ Database backup job created: ${databaseBackup.name} (${discoveredCount} source${discoveredCount !== 1 ? 's' : ''})`);

                    result.steps.push('Creating database backup schedule...');
                    result.created.database_schedule = await this._createScheduleForBackup(
                        databaseBackup, template.databaseBackup.schedule, result
                    );
                } catch (dbBackupError) {
                    console.error('❌ Database backup creation failed:', dbBackupError.message);
                    result.steps.push(`⚠️ Database backup creation failed: ${dbBackupError.message}`);
                    result.warnings = result.warnings || [];
                    result.warnings.push(`Database backup creation failed: ${dbBackupError.message}`);
                }
            }

            // Guard: make sure we actually created at least one job
            if (!result.created.files_backup && !result.created.database_backup) {
                throw new Error('No backup jobs were created - select at least one file category or the Databases category.');
            }

            result.success = true;
            if (result.warnings && result.warnings.length > 0) {
                result.message = `Linux Server backup activated with ${result.warnings.length} warning(s)`;
                result.partial_success = true;
            } else {
                result.message = 'Linux Server backup activated successfully';
            }

            return result;
        } catch (error) {
            console.error('Linux Server template activation failed:', error);
            result.success = false;
            result.error = error.message;
            result.steps.push(`❌ Error: ${error.message}`);

            await this.cleanupFailedActivation(result.created);

            throw error;
        }
    }

    /**
     * Deactivate the Linux Server template (removes its jobs + schedules)
     */
    async deactivateLinuxServerTemplate() {
        const services = getServices();

        try {
            const template = this.builtInTemplates.get('linux-server');
            const backups = services.backupManager?.getAllBackups ? await services.backupManager.getAllBackups() : [];
            const templateNames = new Set([
                template?.filesBackup?.name,
                template?.databaseBackup?.name,
            ].filter(Boolean));

            const templateBackups = backups.filter(b => templateNames.has(b.name));

            const result = {
                deleted: {
                    backups: [],
                    schedules: []
                }
            };

            for (const backup of templateBackups) {
                if (backup.schedule_id && services.scheduleManager?.deleteSchedule) {
                    try {
                        await services.scheduleManager.deleteSchedule(backup.schedule_id);
                        result.deleted.schedules.push(backup.schedule_id);
                    } catch (e) {
                        // ignore
                    }
                }

                if (services.backupManager?.deleteBackup) {
                    await services.backupManager.deleteBackup(backup.id);
                    result.deleted.backups.push(backup.id);
                }
            }

            result.success = true;
            result.message = 'Linux Server template deactivated';
            return result;
        } catch (error) {
            throw new Error(`Failed to deactivate template: ${error.message}`);
        }
    }

    /**
     * Generate secure random passphrase
     */
    generateSecurePassphrase() {
        // Generate 32 random bytes and convert to base64
        return crypto.randomBytes(32).toString('base64');
    }

    /**
     * Save passphrase to file
     */
    async savePassphrase(passphrase) {
        const passphraseFile = '/opt/speedbits/borgmatic-ui/repo-passphrase.txt';
        const dir = path.dirname(passphraseFile);

        await fs.ensureDir(dir);
        await fs.writeFile(passphraseFile, passphrase, 'utf8');
        await fs.chmod(passphraseFile, 0o600); // Read/write for owner only
    }

    /**
     * Get retention profiles from the actual retention manager
     */
    async getRetentionProfiles() {
        try {
            const retentionManager = require('../retention-manager');
            const profiles = await retentionManager.getProfiles();

            // Return all profiles (built-in + custom)
            const allProfiles = profiles.all || [];

            if (allProfiles.length === 0) {
                // Fallback: create a default profile inline
                console.warn('No retention profiles found, using inline default');
                return [
                    {
                        id: 'profile-standard',
                        name: 'Standard',
                        keep_daily: 7,
                        keep_weekly: 4,
                        keep_monthly: 6
                    }
                ];
            }

            return allProfiles;
        } catch (error) {
            console.error('Failed to get retention profiles:', error.message);
            // Fallback to inline default
            return [
                {
                    id: 'profile-standard',
                    name: 'Standard',
                    keep_daily: 7,
                    keep_weekly: 4,
                    keep_monthly: 6
                }
            ];
        }
    }

    /**
     * Cleanup after failed activation
     */
    async cleanupFailedActivation(created) {
        const services = getServices();

        try {
            if (created.files_schedule && services.scheduleManager?.deleteSchedule) {
                await services.scheduleManager.deleteSchedule(created.files_schedule.id).catch(() => { });
            }
            if (created.database_schedule && services.scheduleManager?.deleteSchedule) {
                await services.scheduleManager.deleteSchedule(created.database_schedule.id).catch(() => { });
            }
            if (created.files_backup && services.backupManager?.deleteBackup) {
                await services.backupManager.deleteBackup(created.files_backup.id).catch(() => { });
            }
            if (created.database_backup && services.backupManager?.deleteBackup) {
                await services.backupManager.deleteBackup(created.database_backup.id).catch(() => { });
            }
            // Repository is just a path, not a managed object
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }
}

module.exports = new TemplateManager();

