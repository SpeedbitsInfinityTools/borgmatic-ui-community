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
        // We treat Infinity Tools as activated if expected YAMLs exist in borgmatic.d/.
        if (templateId !== 'infinity-tools') return false;

        try {
            const config = require('../../config');
            const borgmaticDir = path.join(config.configDir, 'borgmatic.d');
            const expected = [
                'SpeedBits System Backup.yaml',
                'SpeedBits Database Backup.yaml',
            ];

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

            // Step 2: Determine repository path
            let repositoryPath;
            let needsRepoInit = false;

            if (options.repository_option === 'select' && options.repository_id) {
                // Using existing repository - look up the actual path from the repository ID
                const configParser = require('../config-parser');
                const allRepos = await configParser.getAllRepositoriesWithUsage();
                const selectedRepo = allRepos.find(r => r.id === options.repository_id);
                
                if (!selectedRepo) {
                    throw new Error(`Repository not found: ${options.repository_id}`);
                }
                
                repositoryPath = selectedRepo.path;
                result.steps.push(`✅ Using existing repository: ${selectedRepo.name || selectedRepo.label || repositoryPath}`);
            } else {
                // Create new repository
                repositoryPath = options.repository_path || template.repository.path;
                needsRepoInit = true;
                result.steps.push(`✅ Will create repository at: ${repositoryPath}`);
            }
            result.created.repository_path = repositoryPath;

            // Step 3: Determine passphrase behavior.
            // - If we are creating a new repo, we must have a passphrase (auto-generate if not provided).
            // - If we are selecting an existing repo, NEVER auto-generate/store a random passphrase (it would be wrong).
            let passphrase = null;
            const wantsAuto = options.passphrase === 'AUTO_GENERATE' || !options.passphrase;
            if (needsRepoInit) {
                passphrase = wantsAuto ? this.generateSecurePassphrase() : options.passphrase;
                result.steps.push('✅ Repository passphrase generated');
            } else {
                passphrase = wantsAuto ? null : options.passphrase;
                result.steps.push('ℹ️ Using existing repository (passphrase not changed)');
            }

            // Determine Borg version to use (default to 1.x for stability)
            // This is declared outside the if block so it's available for backup creation
            const borgVersion = options.borg_version || '1.x';
            const useBorg2 = borgVersion === '2.x';

            // Step 3b: Initialize borg repository if needed
            if (needsRepoInit) {
                result.steps.push('Initializing Borg repository...');

                // Select appropriate binary, encryption, and command based on version
                const borgBinary = useBorg2 ? 'borg2' : 'borg1';
                const encryption = useBorg2 ? 'repokey-blake2-aes-ocb' : 'repokey-blake2';

                try {
                    // Create the directory if it doesn't exist
                    await fs.ensureDir(repositoryPath);
                    result.steps.push(`✅ Created directory: ${repositoryPath}`);

                    // Initialize the borg repository with version-appropriate syntax
                    if (useBorg2) {
                        // Borg 2.x syntax: borg -r /path/to/repo repo-create --encryption=...
                        await execa(borgBinary, [
                            '-r', repositoryPath,
                            'repo-create',
                            `--encryption=${encryption}`,
                        ], {
                            env: {
                                ...process.env,
                                BORG_PASSPHRASE: passphrase
                            },
                            timeout: 60000
                        });
                        result.steps.push(`✅ Borg 2.x repository initialized with ${encryption} encryption (AEAD)`);
                    } else {
                        // Borg 1.x syntax: borg init --encryption=... /path/to/repo
                        await execa(borgBinary, [
                            'init',
                            `--encryption=${encryption}`,
                            repositoryPath
                        ], {
                            env: {
                                ...process.env,
                                BORG_PASSPHRASE: passphrase
                            },
                            timeout: 60000
                        });
                        result.steps.push(`✅ Borg 1.x repository initialized with ${encryption} encryption`);
                    }

                    result.created.borg_version = borgVersion;
                } catch (initError) {
                    // Check if repo already exists
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
                        name: 'Infinity Tools Backup Repository',
                        path: repositoryPath,
                        encryption: encryption,
                        compression: template.repository.compression || 'lz4',
                        repository_type: 'local',
                        borg_version: borgVersion,
                    });
                    result.steps.push('✅ Repository registered: Infinity Tools Backup Repository');
                } catch (regError) {
                    // May fail if repo already registered - that's OK
                    if (!regError.message?.includes('already exists')) {
                        console.warn('Could not register repository:', regError.message);
                    }
                }
            }

            // Step 3c: Store passphrase in vault (only if we actually have one)
            if (passphrase) {
                try {
                    const passwordManager = require('../password-manager');
                    console.log(`🔐 Storing passphrase for repository: ${repositoryPath}`);
                    await passwordManager.storeRepositoryPassphrase(repositoryPath, passphrase);
                    console.log(`✅ Passphrase stored successfully for: ${repositoryPath}`);
                    result.steps.push('✅ Passphrase stored in vault');
                } catch (pwError) {
                    console.error('❌ Could not store passphrase in vault:', pwError.message, pwError.stack);
                    result.steps.push('⚠️ Passphrase not stored in vault (save it manually!)');
                    // Don't throw - we can continue, but user will need to enter passphrase manually
                }
            } else {
                result.steps.push('ℹ️ No passphrase provided for existing repository (vault not updated)');
            }

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

            // Step 6: Create files backup schedule
            result.steps.push('Creating files backup schedule...');
            let existingSchedules = [];
            let filesSchedule = null;
            try {
                existingSchedules = services.scheduleManager?.getAllSchedules
                    ? await services.scheduleManager.getAllSchedules()
                    : [];
                filesSchedule =
                    existingSchedules.find(s => s.cron_expression === template.filesBackup.schedule.cron) ||
                    (services.scheduleManager?.createSchedule
                        ? await services.scheduleManager.createSchedule({
                            name: template.filesBackup.schedule.name,
                            cron_expression: template.filesBackup.schedule.cron,
                        })
                        : null);
                result.created.files_schedule = filesSchedule;
                // Link schedule to backup metadata so UI shows it
                try {
                    if (filesSchedule?.id && services.backupManager?.updateBackupMetadata) {
                        await services.backupManager.updateBackupMetadata(filesBackup.id, { schedule_id: filesSchedule.id });
                    }
                } catch (e) {
                    console.warn('Could not link files schedule to backup metadata:', e.message);
                }
                if (filesSchedule) {
                    result.steps.push(`✅ Files schedule created: ${filesSchedule.name}`);
                } else {
                    result.steps.push('⚠️ Files schedule not created (schedule manager unavailable)');
                }
            } catch (scheduleError) {
                console.warn('Failed to create files schedule:', scheduleError.message);
                result.steps.push(`⚠️ Files schedule not created: ${scheduleError.message}`);
            }

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

                // Step 8: Create database backup schedule
                result.steps.push('Creating database backup schedule...');
                try {
                    const dbExistingSchedules = services.scheduleManager?.getAllSchedules
                        ? await services.scheduleManager.getAllSchedules()
                        : existingSchedules;
                    const databaseSchedule =
                        dbExistingSchedules.find(s => s.cron_expression === template.databaseBackup.schedule.cron) ||
                        (services.scheduleManager?.createSchedule
                            ? await services.scheduleManager.createSchedule({
                                name: template.databaseBackup.schedule.name,
                                cron_expression: template.databaseBackup.schedule.cron,
                            })
                            : null);
                    result.created.database_schedule = databaseSchedule;
                    // Link schedule to backup metadata so UI shows it
                    try {
                        if (databaseSchedule?.id && services.backupManager?.updateBackupMetadata) {
                            await services.backupManager.updateBackupMetadata(databaseBackup.id, { schedule_id: databaseSchedule.id });
                        }
                    } catch (e) {
                        console.warn('Could not link database schedule to backup metadata:', e.message);
                    }
                    if (databaseSchedule) {
                        result.steps.push(`✅ Database schedule created: ${databaseSchedule.name}`);
                    } else {
                        result.steps.push('⚠️ Database schedule not created (schedule manager unavailable)');
                    }
                } catch (scheduleError) {
                    console.warn('Failed to create database schedule:', scheduleError.message);
                    result.steps.push(`⚠️ Database schedule not created: ${scheduleError.message}`);
                }
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

