const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const retentionManager = require('./retention-manager');
const configParser = require('./config-parser');

const execAsync = promisify(exec);

/**
 * Backup Configuration Manager
 * Manages backup configurations stored as YAML files in borgmatic.d/
 */
class BackupManager {
    constructor() {
        this.backupsDir = path.join(config.configDir, 'borgmatic.d');
        this.metadataPath = path.join(config.configDir, 'backups-metadata.yaml');
    }

    _isDumpTempPath(dir) {
        return typeof dir === 'string' && (
            dir === '/tmp/borgmatic_mssql_dumps' ||
            dir.startsWith('/tmp/borgmatic_mssql_dumps_') ||
            dir.startsWith('/tmp/borgmatic_db_dumps_')
        );
    }

    _validateMssqlInputs(dbSource) {
        const identifierRegex = /^[A-Za-z0-9_-]+$/;
        const hostRegex = /^[A-Za-z0-9.-]+$/;
        const userRegex = /^[A-Za-z0-9_.@\\-]+$/;
        const instanceRegex = /^[A-Za-z0-9_-]+$/;
        const guidRegex = /^[A-Za-z0-9-]+$/;

        const dbName = String(dbSource.database_name || '').trim();
        if (!dbName) throw new Error('MSSQL database name is required');
        if (dbName !== 'all' && !identifierRegex.test(dbName)) {
            throw new Error('Invalid MSSQL database name. Allowed: letters, numbers, underscore, dash');
        }

        const host = dbSource.is_host_database ? 'host.docker.internal' : String(dbSource.hostname || 'localhost');
        if (!hostRegex.test(host)) {
            throw new Error('Invalid MSSQL hostname');
        }

        const user = String(dbSource.username || 'sa').trim();
        if (!userRegex.test(user)) {
            throw new Error('Invalid MSSQL username');
        }

        const rawPort = Number(dbSource.port || 1433);
        if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
            throw new Error('Invalid MSSQL port');
        }

        const instance = dbSource.instance ? String(dbSource.instance).trim() : '';
        if (instance && !instanceRegex.test(instance)) {
            throw new Error('Invalid MSSQL instance name');
        }

        const encrypt = dbSource.encrypt ? String(dbSource.encrypt) : 'true';
        if (!['true', 'false', 'strict'].includes(encrypt)) {
            throw new Error('Invalid MSSQL encrypt mode');
        }

        const auth_method = dbSource.auth_method || 'sql';
        if (!['sql', 'ad_password', 'service_principal'].includes(auth_method)) {
            throw new Error('Invalid MSSQL auth method');
        }

        let client_id = '';
        let tenant_id = '';
        if (auth_method === 'service_principal') {
            client_id = String(dbSource.client_id || '').trim();
            if (!client_id || !guidRegex.test(client_id)) {
                throw new Error('Service Principal requires a valid Client ID (Application ID)');
            }
            tenant_id = String(dbSource.tenant_id || '').trim();
            if (!tenant_id || !guidRegex.test(tenant_id)) {
                throw new Error('Service Principal requires a valid Tenant ID');
            }
        }

        return { dbName, host, user, port: rawPort, instance, encrypt, auth_method, client_id, tenant_id };
    }

    _validateHookDbInputs(dbSource) {
        const supported = ['mariadb', 'mysql', 'postgresql', 'mongodb'];
        if (!supported.includes(dbSource?.type)) {
            throw new Error(`Unsupported database type: ${dbSource?.type || 'unknown'}`);
        }

        const dbName = String(dbSource.database_name || '').trim();
        if (!dbName) {
            throw new Error(`${dbSource.type} database name is required`);
        }
        if (dbName !== 'all' && !/^[A-Za-z0-9_.-]+$/.test(dbName)) {
            throw new Error(`Invalid ${dbSource.type} database name`);
        }

        const host = dbSource.is_host_database ? 'host.docker.internal' : String(dbSource.hostname || 'localhost').trim();
        if (!/^[A-Za-z0-9.-]+$/.test(host)) {
            throw new Error(`Invalid ${dbSource.type} hostname`);
        }

        const rawPort = Number(dbSource.port || this._getDefaultPort(dbSource.type));
        if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
            throw new Error(`Invalid ${dbSource.type} port`);
        }

        const username = String(dbSource.username || '').trim();
        if (username && !/^[A-Za-z0-9_.@\\-]+$/.test(username)) {
            throw new Error(`Invalid ${dbSource.type} username`);
        }

        const authDb = String(dbSource.authentication_database || 'admin').trim();
        if (dbSource.type === 'mongodb' && authDb && !/^[A-Za-z0-9_.-]+$/.test(authDb)) {
            throw new Error('Invalid mongodb authentication database name');
        }

        return { dbName, host, user: username, port: rawPort, authDb };
    }

    _shellSingleQuote(value) {
        return `'${String(value ?? '').replace(/'/g, `'\"'\"'`)}'`;
    }

    _extractMssqlSourcesFromHooks(config) {
        const sources = [];
        const hooks = [];
        if (Array.isArray(config.before_backup)) {
            hooks.push(...config.before_backup);
        }
        // New borgmatic 2.x hook format.
        if (Array.isArray(config.commands)) {
            for (const commandHook of config.commands) {
                if (!commandHook || !Array.isArray(commandHook.run)) continue;
                hooks.push(...commandHook.run);
            }
        }
        const marker = 'BORGMATIC_UI_MSSQL_META_B64:';

        for (const hook of hooks) {
            if (typeof hook !== 'string' || !hook.includes(marker)) continue;
            try {
                const line = hook.split('\n').find((l) => l.includes(marker));
                if (!line) continue;
                const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
                const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
                if (parsed?.type === 'mssql') {
                    const src = {
                        type: 'mssql',
                        database_name: parsed.database_name,
                        hostname: parsed.hostname,
                        port: parsed.port,
                        username: parsed.username,
                        instance: parsed.instance || '',
                        encrypt: parsed.encrypt || 'true',
                        trustServerCert: !!parsed.trustServerCert,
                        is_host_database: !!parsed.is_host_database,
                        password: undefined,
                        auth_method: parsed.auth_method || 'sql',
                    };
                    if (parsed.client_id) src.client_id = parsed.client_id;
                    if (parsed.tenant_id) src.tenant_id = parsed.tenant_id;
                    sources.push(src);
                }
            } catch (e) {
                // Ignore malformed metadata markers from older/broken configs.
            }
        }

        return sources;
    }

    _extractDbDumpSourcesFromHooks(config) {
        const sources = [];
        const hooks = [];
        if (Array.isArray(config.commands)) {
            for (const commandHook of config.commands) {
                if (!commandHook || !Array.isArray(commandHook.run)) continue;
                hooks.push(...commandHook.run);
            }
        }
        const marker = 'BORGMATIC_UI_DB_META_B64:';

        for (const hook of hooks) {
            if (typeof hook !== 'string' || !hook.includes(marker)) continue;
            try {
                const line = hook.split('\n').find((l) => l.includes(marker));
                if (!line) continue;
                const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
                const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
                if (parsed?.type && ['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(parsed.type)) {
                    const envVar = parsed.db_password_env_var;
                    const placeholder = typeof envVar === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)
                        ? '${' + envVar + '}'
                        : undefined;
                    sources.push({
                        type: parsed.type,
                        database_name: parsed.database_name,
                        hostname: parsed.hostname,
                        port: parsed.port,
                        username: parsed.username,
                        tls: parsed.tls,
                        authentication_database: parsed.authentication_database,
                        is_host_database: !!parsed.is_host_database,
                        dump_method: 'local',
                        password: placeholder,
                    });
                }
            } catch (e) {
                // Ignore malformed metadata
            }
        }

        return sources;
    }

    /**
     * Append a borgmatic 2.x command hook.
     */
    _appendCommandHook(config, hook) {
        if (!Array.isArray(config.commands)) {
            config.commands = [];
        }
        config.commands.push(hook);
    }

    /**
     * Compare two metadata entries for the same filename and pick the "best" one.
     * Preference order:
     * 1) valid configs over invalid/unknown
     * 2) newest updated_at / validation_date / created_at
     */
    _compareMetadata(a, b) {
        const aValid = a?.validation_status === 'valid';
        const bValid = b?.validation_status === 'valid';
        if (aValid !== bValid) return aValid ? 1 : -1;

        const aDate = a?.updated_at || a?.validation_date || a?.created_at || null;
        const bDate = b?.updated_at || b?.validation_date || b?.created_at || null;
        const aTs = aDate ? Date.parse(aDate) : 0;
        const bTs = bDate ? Date.parse(bDate) : 0;
        if (aTs !== bTs) return aTs > bTs ? 1 : -1;

        const aId = String(a?.id || '');
        const bId = String(b?.id || '');
        if (aId === bId) return 0;
        return aId > bId ? 1 : -1;
    }

    /**
     * Validate a borgmatic configuration file
     */
    async validateBorgmaticConfig(yamlPath) {
        try {
            // Run borgmatic config validate
            const { stdout, stderr } = await execAsync(
                `borgmatic config validate --config "${yamlPath}"`,
                { timeout: 10000 }
            );

            return {
                valid: true,
                output: stdout || 'Configuration is valid',
                error: null
            };
        } catch (error) {
            // Self-heal legacy configs that used the wrong key name ('borg_path' instead of 'local_path').
            // borgmatic rejects unknown top-level keys, so this makes older configs usable again.
            const errText = String(error?.stderr || error?.stdout || error?.message || '');
            if (errText.includes("'borg_path' was unexpected")) {
                try {
                    const raw = await fs.readFile(yamlPath, 'utf8');
                    if (raw.includes('\nborg_path:')) {
                        const migrated = raw.replace(/\nborg_path:/g, '\nlocal_path:');
                        await fs.writeFile(yamlPath, migrated);

                        const { stdout: stdout2 } = await execAsync(
                            `borgmatic config validate --config "${yamlPath}"`,
                            { timeout: 10000 }
                        );
                        return {
                            valid: true,
                            output: stdout2 || 'Configuration is valid (auto-migrated borg_path -> local_path)',
                            error: null
                        };
                    }
                } catch (migrateError) {
                    // Fall through to invalid return below
                    console.warn('⚠️ Could not auto-migrate borg_path -> local_path:', migrateError.message);
                }
            }
            // Non-zero exit code means invalid
            return {
                valid: false,
                output: error.stdout || '',
                error: error.stderr || error.message || 'Configuration validation failed'
            };
        }
    }

    /**
     * Get all backup configurations with metadata
     */
    async getAllBackups() {
        try {
            await fs.ensureDir(this.backupsDir);
            await fs.ensureFile(this.metadataPath);

            const metadata = await this.loadMetadata();
            // Clean up metadata:
            // - drop entries whose YAML no longer exists
            // - de-duplicate entries that point to the same YAML filename (can happen after failed runs)
            if (Array.isArray(metadata.backups) && metadata.backups.length > 0) {
                const dedup = new Map(); // filename -> meta
                let changed = false;

                for (const meta of metadata.backups) {
                    if (!meta?.filename) {
                        changed = true;
                        continue;
                    }

                    const yamlPath = path.join(this.backupsDir, meta.filename);
                    const exists = await fs.pathExists(yamlPath);
                    if (!exists) {
                        changed = true;
                        continue;
                    }

                    const existing = dedup.get(meta.filename);
                    if (!existing) {
                        dedup.set(meta.filename, meta);
                    } else {
                        const keep = this._compareMetadata(meta, existing) > 0 ? meta : existing;
                        if (keep !== existing) {
                            dedup.set(meta.filename, keep);
                        }
                        changed = true;
                    }
                }

                if (changed) {
                    metadata.backups = Array.from(dedup.values());
                    await this.saveMetadata(metadata);
                    console.log('🧹 Cleaned up backups-metadata.yaml (removed stale/duplicate entries)');
                }
            }
            const backups = [];

            // Load schedules once (used to backfill schedule_id for well-known backups)
            let schedules = [];
            try {
                const schedulesPath = path.join(config.configDir, 'saved_schedules.yaml');
                if (await fs.pathExists(schedulesPath)) {
                    const schedulesRaw = await fs.readFile(schedulesPath, 'utf8');
                    const parsed = yaml.load(schedulesRaw) || {};
                    schedules = parsed.schedules || [];
                }
            } catch (e) {
                // ignore
            }

            const findScheduleIdByCron = (cronExpression) => {
                if (!cronExpression) return null;
                // Prefer built-in IDs if present
                const preferred = schedules.find(s => s.id === 'schedule-daily-2am' && s.cron_expression === cronExpression)
                    || schedules.find(s => s.id === 'schedule-hourly' && s.cron_expression === cronExpression);
                if (preferred?.id) return preferred.id;
                const any = schedules.find(s => s.cron_expression === cronExpression);
                return any?.id || null;
            };

            // Load all repositories for borg_version lookup
            let allRepos = [];
            try {
                allRepos = await configParser.getAllRepositoriesWithUsage();
            } catch (e) {
                console.warn('Could not load repos for borg_version lookup:', e.message);
            }
            
            // Build a set of filenames that have metadata entries (created through UI)
            const metadataFilenames = new Set((metadata.backups || []).map(b => b.filename));

            // First, add backups with metadata (created through UI)
            for (const meta of metadata.backups || []) {
                try {
                    const yamlPath = path.join(this.backupsDir, meta.filename);
                    
                    if (await fs.pathExists(yamlPath)) {
                        const config = await this.loadBackupConfig(yamlPath);

                        // Backfill schedule_id for known templates if missing (improves UX)
                        if (!meta.schedule_id) {
                            let desiredCron = null;
                            if (meta.name === 'SpeedBits System Backup') desiredCron = '0 2 * * *';
                            if (meta.name === 'SpeedBits Database Backup') desiredCron = '0 * * * *';
                            const scheduleId = findScheduleIdByCron(desiredCron);
                            if (scheduleId) {
                                meta.schedule_id = scheduleId;
                                // Persist the change
                                try {
                                    await this.updateBackupMetadata(meta.id, { schedule_id: scheduleId });
                                } catch (e) {
                                    // ignore
                                }
                            }
                        }
                        
                        const sources_summary = this.getSourcesSummary(config);
                        const repositories_summary = this.getRepositoriesSummary(config, allRepos);
                        
                        backups.push({
                            ...meta,
                            config,
                            sources_summary,
                            repositories_summary,
                            source_count: sources_summary.length,
                            repository_count: repositories_summary.length,
                            isDiscovered: false // Created through UI
                        });
                    } else {
                        console.warn(`Backup YAML not found: ${meta.filename}`);
                    }
                } catch (error) {
                    console.error(`Error loading backup ${meta.name}:`, error.message);
                }
            }
            
            // Then, discover backups created outside the UI (YAML files without metadata)
            try {
                const files = await fs.readdir(this.backupsDir);
                const yamlFiles = files.filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !metadataFilenames.has(f));
                
                for (const filename of yamlFiles) {
                    try {
                        const yamlPath = path.join(this.backupsDir, filename);
                        const config = await this.loadBackupConfig(yamlPath);
                        
                        const sources_summary = this.getSourcesSummary(config);
                        const repositories_summary = this.getRepositoriesSummary(config, allRepos);
                        
                        // Generate a name from filename (remove extension)
                        const nameFromFile = path.basename(filename, path.extname(filename));
                        
                        // Use stable ID based on filename hash (not random)
                        const crypto = require('crypto');
                        const stableId = `discovered-${crypto.createHash('md5').update(filename).digest('hex').substring(0, 12)}`;
                        
                        backups.push({
                            id: stableId,
                            name: 'Discovered automatically - not named yet',
                            filename: filename,
                            description: '',
                            schedule_id: null,
                            is_active: true,
                            created_at: (await fs.stat(yamlPath)).mtime.toISOString(),
                            updated_at: (await fs.stat(yamlPath)).mtime.toISOString(),
                            last_run: null,
                            last_run_status: null,
                            source_count: sources_summary.length,
                            repository_count: repositories_summary.length,
                            retention_profile_id: null,
                            validation_status: 'unknown',
                            validation_error: null,
                            validation_date: null,
                            config,
                            sources_summary,
                            repositories_summary,
                            isDiscovered: true // Flag to indicate this was discovered externally
                        });
                        
                        console.log(`🔍 Discovered external backup: ${filename}`);
                    } catch (error) {
                        console.error(`Error loading discovered backup ${filename}:`, error.message);
                    }
                }
            } catch (error) {
                console.warn('Failed to discover external backups:', error.message);
            }

            return backups;
        } catch (error) {
            console.error('Failed to get all backups:', error);
            throw error;
        }
    }

    /**
     * Get a specific backup by ID
     */
    async getBackup(backupId) {
        const metadata = await this.loadMetadata();
        const meta = metadata.backups?.find(b => b.id === backupId);
        
        if (!meta) {
            throw new Error(`Backup not found: ${backupId}`);
        }

        const yamlPath = path.join(this.backupsDir, meta.filename);
        const config = await this.loadBackupConfig(yamlPath);

        const sources_summary = this.getSourcesSummary(config);
        const repositories_summary = this.getRepositoriesSummary(config);
        
        return {
            ...meta,
            config,
            sources_summary,
            repositories_summary,
            source_count: sources_summary.length,
            repository_count: repositories_summary.length,
            validation_status: meta.validation_status || 'unknown',
            validation_error: meta.validation_error || null,
            validation_date: meta.validation_date || null
        };
    }

    /**
     * Get raw YAML content for a backup
     */
    async getBackupYaml(backupId) {
        const metadata = await this.loadMetadata();
        const meta = metadata.backups?.find(b => b.id === backupId);
        
        if (!meta) {
            throw new Error(`Backup not found: ${backupId}`);
        }

        const yamlPath = path.join(this.backupsDir, meta.filename);
        
        if (!await fs.pathExists(yamlPath)) {
            throw new Error(`YAML file not found: ${meta.filename}`);
        }

        const yamlContent = await fs.readFile(yamlPath, 'utf8');
        return yamlContent;
    }

    /**
     * Create a new backup configuration
     */
    async createBackup(backupData) {
        try {
            // Generate unique ID
            const backupId = `backup-${uuidv4().split('-')[0]}-${Date.now().toString(36)}`;
            // Ensure backupData has a stable ID for downstream secret keying
            backupData = { ...backupData, id: backupId };
            const originalName = backupData.name;

            // Ensure backup name is unique by adjusting it if needed (avoid confusing "saved but not shown" states)
            const ensureUniqueName = async (baseName) => {
                const metadata = await this.loadMetadata();
                const existingNames = new Set((metadata.backups || []).map(b => b.name));
                const existingFiles = new Set((metadata.backups || []).map(b => b.filename));
                let candidate = baseName;
                let i = 2;
                while (true) {
                    const candidateFilename = `${candidate}.yaml`;
                    const candidateYamlPath = path.join(this.backupsDir, candidateFilename);
                    const fileExists = await fs.pathExists(candidateYamlPath);
                    const metaConflict = existingNames.has(candidate) || existingFiles.has(candidateFilename);
                    if (!fileExists && !metaConflict) {
                        return { name: candidate, filename: candidateFilename, yamlPath: candidateYamlPath };
                    }
                    candidate = `${baseName}-${i}`;
                    i++;
                }
            };

            const unique = await ensureUniqueName(backupData.name);
            backupData = { ...backupData, name: unique.name };
            const filename = unique.filename;
            const yamlPath = unique.yamlPath;

            // Remove stale metadata entry if YAML was deleted previously (prevents duplicates)
            const metadata = await this.loadMetadata();
            if (Array.isArray(metadata.backups)) {
                const existingMetaIndex = metadata.backups.findIndex(b => b.filename === filename);
                if (existingMetaIndex !== -1) {
                    const existingYamlPath = path.join(this.backupsDir, filename);
                    const yamlExists = await fs.pathExists(existingYamlPath);
                    if (!yamlExists) {
                        metadata.backups.splice(existingMetaIndex, 1);
                        await this.saveMetadata(metadata);
                        console.log(`🧹 Removed stale metadata entry for missing YAML: ${filename}`);
                    } else {
                        // Should be unreachable due to ensureUniqueName, but keep safety.
                        throw new Error(`Backup configuration "${backupData.name}" already exists`);
                    }
                }
            }

            // Check if file already exists
            if (await fs.pathExists(yamlPath)) {
                throw new Error(`Backup configuration "${backupData.name}" already exists`);
            }

            // Get retention profile
            const retentionProfile = await retentionManager.getProfile(backupData.retention_profile_id);
            if (!retentionProfile) {
                throw new Error('Invalid retention profile');
            }

            // Build borgmatic configuration
            const borgmaticConfig = await this.buildBorgmaticConfig(backupData, retentionProfile);

            // Save YAML file
            const yamlContent = this.generateYAML(borgmaticConfig, backupId, backupData);
            await fs.writeFile(yamlPath, yamlContent);

            // Validate the configuration with borgmatic
            console.log(`🔍 Validating backup configuration: ${filename}`);
            const validation = await this.validateBorgmaticConfig(yamlPath);

            // Save metadata (reuse loaded metadata)
            const newMeta = {
                id: backupId,
                name: backupData.name,
                filename,
                description: backupData.description || '',
                schedule_id: backupData.schedule_id || null,
                is_active: validation.valid && backupData.is_active !== false, // Only active if valid and requested
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_run: null,
                last_run_status: null,
                source_count: backupData.sources?.length || 0,
                repository_count: backupData.repositories?.length || 0,
                retention_profile_id: backupData.retention_profile_id,
                validation_status: validation.valid ? 'valid' : 'invalid',
                validation_error: validation.valid ? null : validation.error,
                validation_date: new Date().toISOString(),
                auto_break_lock: backupData.auto_break_lock === true // Auto-break stale locks before backup
            };

            if (!validation.valid) {
                console.warn(`⚠️ Backup configuration has validation errors: ${validation.error}`);
            } else {
                console.log(`✅ Backup configuration is valid`);
            }

            metadata.backups = metadata.backups || [];
            metadata.backups.push(newMeta);
            await this.saveMetadata(metadata);

            // Refresh config parser cache so repositories/state reflect the new backup immediately
            try {
                await configParser.refresh();
            } catch (e) {
                console.warn('⚠️ Could not refresh config parser after createBackup:', e.message);
            }

            console.log(`✓ Created backup configuration: ${backupData.name}`);
            
            return {
                ...newMeta,
                config: borgmaticConfig,
                name_changed_from: (originalName && originalName !== backupData.name) ? originalName : null
            };
        } catch (error) {
            console.error('Failed to create backup:', error);
            throw error;
        }
    }

    /**
     * Update an existing backup configuration
     */
    async updateBackup(backupId, updates) {
        try {
            const metadata = await this.loadMetadata();
            let metaIndex = metadata.backups?.findIndex(b => b.id === backupId);
            
            // If backup not found in metadata, it might be a discovered backup
            let oldMeta;
            if (metaIndex === -1) {
                // Check if this is a discovered backup (ID starts with "discovered-")
                if (backupId.startsWith('discovered-')) {
                    // Find the backup by checking all YAML files
                    const files = await fs.readdir(this.backupsDir);
                    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
                    
                    // Try to find matching discovered backup (we'll use filename from updates or search)
                    const filename = updates.filename || null;
                    if (filename && await fs.pathExists(path.join(this.backupsDir, filename))) {
                        // Create metadata entry for discovered backup
                        console.log(`📝 Creating metadata entry for discovered backup: ${filename}`);
                        oldMeta = {
                            id: backupId,
                            name: updates.name || 'Discovered automatically - not named yet',
                            filename: filename,
                            description: updates.description || '',
                            schedule_id: updates.schedule_id || null,
                            is_active: updates.is_active !== undefined ? updates.is_active : true,
                            created_at: (await fs.stat(path.join(this.backupsDir, filename))).mtime.toISOString(),
                            updated_at: new Date().toISOString(),
                            last_run: null,
                            last_run_status: null,
                            source_count: 0,
                            repository_count: 0,
                            retention_profile_id: updates.retention_profile_id || null,
                            validation_status: 'unknown',
                            validation_error: null,
                            validation_date: null
                        };
                        
                        metadata.backups = metadata.backups || [];
                        metadata.backups.push(oldMeta);
                        await this.saveMetadata(metadata);
                        metaIndex = metadata.backups.length - 1;
                        console.log(`✅ Metadata entry created for discovered backup`);
                    } else {
                        throw new Error(`Backup file not found for discovered backup: ${backupId}`);
                    }
                } else {
                    throw new Error(`Backup not found: ${backupId}`);
                }
            } else {
                oldMeta = metadata.backups[metaIndex];
            }
            const oldYamlPath = path.join(this.backupsDir, oldMeta.filename);

            // If name changed, rename file
            let newFilename = oldMeta.filename;
            if (updates.name && updates.name !== oldMeta.name) {
                newFilename = `${updates.name}.yaml`;
                const newYamlPath = path.join(this.backupsDir, newFilename);
                
                if (await fs.pathExists(newYamlPath)) {
                    throw new Error(`Backup configuration "${updates.name}" already exists`);
                }
                
                await fs.rename(oldYamlPath, newYamlPath);
            }

            // Get retention profile if changed
            let retentionProfile = null;
            if (updates.retention_profile_id) {
                retentionProfile = await retentionManager.getProfile(updates.retention_profile_id);
            } else if (oldMeta.retention_profile_id) {
                retentionProfile = await retentionManager.getProfile(oldMeta.retention_profile_id);
            }

            // Load existing config to preserve sources/repositories if not in updates
            const yamlPath = path.join(this.backupsDir, newFilename);
            let existingConfig = {};
            try {
                const existingYaml = await fs.readFile(path.join(this.backupsDir, oldMeta.filename), 'utf8');
                existingConfig = yaml.load(existingYaml) || {};
            } catch (error) {
                console.warn('Could not load existing config, will use only updates');
            }

            // Merge existing data with updates
            const mergedData = {
                ...oldMeta,
                sources: updates.sources || this.extractSourcesFromConfig(existingConfig),
                // Support both new flat format (repositories:) and old nested format (location.repositories:)
                repositories: updates.repositories || existingConfig.repositories || existingConfig.location?.repositories || [],
                exclude_patterns: updates.exclude_patterns !== undefined ? updates.exclude_patterns : existingConfig.exclude_patterns,
                exclude_caches: updates.exclude_caches !== undefined ? updates.exclude_caches : existingConfig.exclude_caches,
                upload_rate_limit: updates.upload_rate_limit !== undefined ? updates.upload_rate_limit : existingConfig.upload_rate_limit,
                archive_name_format: updates.archive_name_format || existingConfig.archive_name_format,
                check_frequency: updates.check_frequency || this.extractCheckFrequency(existingConfig),
                hooks: updates.hooks || existingConfig.hooks,
                ...updates,
                id: backupId,
            };

            // If the user edited DB sources but left password blank, preserve existing password placeholders.
            // This avoids accidentally wiping secrets from configs.
            if (Array.isArray(updates.sources) && updates.sources.length > 0) {
                mergedData.sources = this._preserveDatabasePasswords(
                    mergedData.sources,
                    this.extractSourcesFromConfig(existingConfig)
                );
            }

            // Build updated configuration
            const borgmaticConfig = await this.buildBorgmaticConfig(
                mergedData,
                retentionProfile
            );

            // Save YAML file
            const yamlContent = this.generateYAML(borgmaticConfig, backupId, { ...oldMeta, ...updates });
            await fs.writeFile(yamlPath, yamlContent);

            // Validate the updated configuration
            console.log(`🔍 Validating updated backup configuration: ${newFilename}`);
            const validation = await this.validateBorgmaticConfig(yamlPath);

            // Update metadata
            metadata.backups[metaIndex] = {
                ...oldMeta,
                ...updates,
                id: backupId, // Ensure ID doesn't change
                filename: newFilename,
                updated_at: new Date().toISOString(),
                source_count: updates.sources?.length || oldMeta.source_count,
                repository_count: updates.repositories?.length || oldMeta.repository_count,
                validation_status: validation.valid ? 'valid' : 'invalid',
                validation_error: validation.valid ? null : validation.error,
                validation_date: new Date().toISOString()
            };

            // If validation failed, deactivate the backup
            if (!validation.valid) {
                console.warn(`⚠️ Updated backup configuration has validation errors: ${validation.error}`);
                metadata.backups[metaIndex].is_active = false;
            } else {
                console.log(`✅ Updated backup configuration is valid`);
            }

            await this.saveMetadata(metadata);

            // Refresh config parser cache so repositories/state reflect changes immediately
            try {
                await configParser.refresh();
            } catch (e) {
                console.warn('⚠️ Could not refresh config parser after updateBackup:', e.message);
            }

            console.log(`✓ Updated backup configuration: ${backupId}`);
            
            return metadata.backups[metaIndex];
        } catch (error) {
            console.error('Failed to update backup:', error);
            throw error;
        }
    }

    /**
     * Delete a backup configuration
     * @param {string} backupId - The backup ID
     * @param {string} [filename] - Optional filename for discovered backups
     */
    async deleteBackup(backupId, filename = null) {
        try {
            const metadata = await this.loadMetadata();
            let meta = metadata.backups?.find(b => b.id === backupId);
            
            // If not found in metadata, check if it's a discovered backup
            if (!meta && backupId.startsWith('discovered-')) {
                const crypto = require('crypto');
                
                // If filename was provided directly, use it
                if (filename && await fs.pathExists(path.join(this.backupsDir, filename))) {
                    meta = { id: backupId, filename, name: filename };
                } else {
                    // Try to match by stable hash ID
                    const files = await fs.readdir(this.backupsDir);
                    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
                    
                    for (const file of yamlFiles) {
                        const stableId = `discovered-${crypto.createHash('md5').update(file).digest('hex').substring(0, 12)}`;
                        if (stableId === backupId) {
                            meta = { id: backupId, filename: file, name: file };
                            break;
                        }
                    }
                }
            }
            
            if (!meta) {
                throw new Error(`Backup not found: ${backupId}`);
            }

            // Delete YAML file
            const yamlPath = path.join(this.backupsDir, meta.filename);
            if (await fs.pathExists(yamlPath)) {
                await fs.remove(yamlPath);
                console.log(`✓ Deleted YAML file: ${yamlPath}`);
            }

            // Remove from metadata if it was there
            metadata.backups = (metadata.backups || []).filter(b => b.id !== backupId);
            await this.saveMetadata(metadata);

            // Refresh config parser cache so repositories/state reflect deletion immediately
            try {
                await configParser.refresh();
            } catch (e) {
                console.warn('⚠️ Could not refresh config parser after deleteBackup:', e.message);
            }

            console.log(`✓ Deleted backup configuration: ${meta.name}`);
            
            return true;
        } catch (error) {
            console.error('Failed to delete backup:', error);
            throw error;
        }
    }

    /**
     * Toggle backup active status
     * Also manages the cron job for scheduled backups
     */
    async toggleBackupStatus(backupId, isActive) {
        const result = await this.updateBackup(backupId, { is_active: isActive });
        
        // Manage cron job based on active status
        try {
            const scheduleManager = require('./schedule-manager');
            const backup = await this.getBackup(backupId);
            
            if (backup && backup.schedule_id) {
                const schedule = await scheduleManager.getSchedule(backup.schedule_id);
                
                if (isActive && schedule) {
                    // Start cron job when activating
                    const yamlPath = path.join(this.backupsDir, backup.filename);
                    console.log(`🕒 Starting cron job for backup: ${backup.name}`);
                    scheduleManager.startCronJob(
                        backup.schedule_id, 
                        backupId, 
                        yamlPath, 
                        schedule.cron_expression
                    );
                } else {
                    // Stop cron job when deactivating
                    console.log(`⏹️  Stopping cron job for backup: ${backup.name}`);
                    scheduleManager.stopCronJob(`${backup.schedule_id}-${backupId}`);
                }
            }
        } catch (scheduleError) {
            console.warn('⚠️ Could not manage cron job:', scheduleError.message);
            // Don't fail the toggle operation if cron management fails
        }
        
        return result;
    }

    /**
     * Build borgmatic configuration object
     * Uses the new flat format (borgmatic 1.8+) without deprecated sections
     */
    async buildBorgmaticConfig(backupData, retentionProfile) {
        const config = {};

        // Determine Borg version for this backup.
        // If not explicitly set on the backup, infer from the selected repositories.
        let effectiveBorgVersion = backupData.borg_version || null;
        if (!effectiveBorgVersion && Array.isArray(backupData.repositories) && backupData.repositories.length > 0) {
            try {
                const allRepos = await configParser.getAllRepositoriesWithUsage();
                const versions = new Set();
                for (const r of backupData.repositories) {
                    const matched = allRepos.find(x => x.path === r.path);
                    const v = matched?.borg_version || r.borg_version || '1.x';
                    versions.add(v);
                }
                if (versions.size === 1) {
                    effectiveBorgVersion = Array.from(versions)[0];
                } else if (versions.size > 1) {
                    throw new Error(`Repositories use mixed Borg versions (${Array.from(versions).join(', ')}). A single backup job must use one Borg version.`);
                }
            } catch (e) {
                // If inference fails, leave unset and borgmatic will use default `borg`.
                console.warn('⚠️ Could not infer borg_version from repositories:', e.message);
            }
        }

        // Set local_path based on borg_version (Borg 1.x vs 2.x have different binaries)
        // borgmatic uses 'local_path' to specify the Borg binary to use
        if (effectiveBorgVersion === '1.x') {
            config.local_path = '/usr/bin/borg1';
        } else if (effectiveBorgVersion === '2.x') {
            config.local_path = '/usr/bin/borg2';
        }
        // If no version specified, borgmatic uses default 'borg' (which is borg2 in our setup)

        // Source directories (flat, no 'location:' wrapper)
        config.source_directories = [];

        // Process sources
        if (backupData.sources) {
            for (const source of backupData.sources) {
                if (source.type === 'local' && source.path) {
                    config.source_directories.push(source.path);
                }
            }
        }

        // Repositories (flat, no 'location:' wrapper)
        if (backupData.repositories) {
            config.repositories = backupData.repositories.map(repo => ({
                path: repo.path,
                label: repo.label || repo.name
            }));
        }

        // Retention (flat, individual keep_* options at top level)
        if (retentionProfile) {
            const retention = retentionManager.profileToRetention(retentionProfile);
            // Spread retention options directly into config (no 'retention:' wrapper)
            Object.assign(config, retention);
        }

        // Exclude patterns
        if (backupData.exclude_patterns && backupData.exclude_patterns.length > 0) {
            config.exclude_patterns = backupData.exclude_patterns;
        }

        if (backupData.exclude_caches !== undefined) {
            config.exclude_caches = backupData.exclude_caches;
        }

        // Archive naming - include backup name for easy identification in restore views
        if (backupData.archive_name_format) {
            config.archive_name_format = backupData.archive_name_format;
        } else {
            // Sanitize backup name for use in archive names (replace spaces/special chars with dashes)
            const sanitizedName = (backupData.name || 'backup')
                .replace(/[^a-zA-Z0-9-_]/g, '-')  // Replace non-alphanumeric chars with dashes
                .replace(/-+/g, '-')              // Collapse multiple dashes
                .replace(/^-|-$/g, '');           // Trim leading/trailing dashes
            config.archive_name_format = `{hostname}-${sanitizedName}-{now}`;
        }

        // Optional logging (borgmatic supports output.log_file)
        // - Prefer explicit backupData.log_file_path if provided
        // - Otherwise, if exactly one repository is selected and it has log_file_path, use that.
        if (backupData.log_file_path) {
            config.output = config.output || {};
            config.output.log_file = backupData.log_file_path;
        } else if (Array.isArray(backupData.repositories) && backupData.repositories.length === 1) {
            try {
                const allRepos = await configParser.getAllRepositoriesWithUsage();
                const matched = allRepos.find(r => r.path === backupData.repositories[0].path);
                const repoLog = matched?.log_file_path || backupData.repositories[0]?.log_file_path;
                if (repoLog) {
                    config.output = config.output || {};
                    config.output.log_file = repoLog;
                }
            } catch (e) {
                // Non-fatal; logging is optional
            }
        }

        // Upload settings
        if (backupData.upload_rate_limit !== undefined) {
            config.upload_rate_limit = backupData.upload_rate_limit;
        }

        // Lock wait timeout - fail fast if repo is locked instead of waiting forever
        // This helps prevent backup jobs from hanging and makes lock issues visible
        // Default: 60 seconds (configurable per backup)
        config.lock_wait = backupData.lock_wait !== undefined ? backupData.lock_wait : 60;

        // Borgmatic 2.x treats borg exit code 105 (permission warning: unreadable
        // files) as a fatal error by default. In borg 1.x this was just a warning.
        // Treat it as a warning so the backup completes with the files that ARE
        // accessible, rather than aborting the entire job.
        config.borg_exit_codes = [
            { code: 105, treat_as: 'warning' },
        ];

        // Checks
        if (backupData.check_frequency) {
            config.checks = this.buildChecksConfig(backupData.check_frequency);
        }

        // Logging - Removed deprecated top-level log_file properties
        // These are now handled via command-line options or borgmatic's own logging
        // if (backupData.log_file) {
        //     config.log_file = backupData.log_file;
        // }
        // if (backupData.log_level) {
        //     config.log_file_verbosity = this.logLevelToVerbosity(backupData.log_level);
        // }

        // Command hooks using borgmatic 2.0+ format
        // The new 'commands:' syntax replaces deprecated before_backup/after_backup/on_error
        const commands = [];

        // Add canary file check as before create action if enabled
        if (backupData.canary_file_enabled && backupData.canary_file_path) {
            const canaryCheckCommand = this.buildCanaryCheckCommand(backupData.canary_file_path);
            commands.push({
                before: 'action',
                when: ['create'],
                run: [canaryCheckCommand]
            });
        }
        
        // User-defined hooks - convert to new format
        if (backupData.hooks) {
            if (backupData.hooks.before_backup && backupData.hooks.before_backup.length > 0) {
                commands.push({
                    before: 'action',
                    when: ['create'],
                    run: backupData.hooks.before_backup
                });
            }
            if (backupData.hooks.after_backup && backupData.hooks.after_backup.length > 0) {
                commands.push({
                    after: 'action',
                    when: ['create'],
                    states: ['finish'],
                    run: backupData.hooks.after_backup
                });
            }
            if (backupData.hooks.on_error && backupData.hooks.on_error.length > 0) {
                commands.push({
                    after: 'error',
                    run: backupData.hooks.on_error
                });
            }
        }

        // Only add commands section if there are any hooks
        if (commands.length > 0) {
            config.commands = commands;
        }

        // Database configuration - collect password storage promises to await them all
        if (backupData.sources) {
            const dbSources = backupData.sources.filter(s => s.type !== 'local');
            const passwordPromises = [];
            for (let i = 0; i < dbSources.length; i++) {
                const dbSource = dbSources[i];
                const promise = this.addDatabaseConfig(config, dbSource, { backupId: backupData.id, dbIndex: i });
                if (promise) passwordPromises.push(promise);
            }
            // Wait for all password storage operations to complete
            if (passwordPromises.length > 0) {
                await Promise.all(passwordPromises);
            }
        }

        return config;
    }

    /**
     * Get the hash file path for a canary file.
     * Hash files are stored in /app/data/canary-hashes/ to avoid permission issues
     * on mounted host filesystems (e.g., /host/opt/speedbits).
     */
    getCanaryHashPath(canaryFilePath) {
        // Create a safe filename from the canary path
        // e.g., /host/opt/speedbits/file.txt -> host_opt_speedbits_file.txt.hash
        const safeName = canaryFilePath.replace(/^\//, '').replace(/\//g, '_') + '.hash';
        const hashDir = path.join(config.dataDir, 'canary-hashes');
        return path.join(hashDir, safeName);
    }

    /**
     * Build canary file check command for before_backup hook
     * This checks if the canary file exists and has not been modified
     */
    buildCanaryCheckCommand(canaryFilePath) {
        const apiUrl = process.env.BORGMATIC_UI_API_URL || 'http://localhost:8000';
        
        // Hash files are stored in app data directory (writable)
        const hashFile = this.getCanaryHashPath(canaryFilePath);
        
        // This command:
        // 1. Checks if canary file exists
        // 2. Compares current hash with stored hash
        // 3. Sends alert via API if compromised
        // 4. Exits with error to stop backup if compromised
        return `CANARY="${canaryFilePath}"; HASH_FILE="${hashFile}"; API_URL="${apiUrl}"; ` +
            `if [ ! -f "$CANARY" ]; then ` +
            `  echo "❌ CANARY FILE DELETED: $CANARY"; ` +
            `  curl -s -X POST "$API_URL/api/backups/canary-alert" -H "Content-Type: application/json" ` +
            `    -d "{\\"reason\\": \\"DELETED\\", \\"file_path\\": \\"$CANARY\\"}" > /dev/null 2>&1 || true; ` +
            `  exit 1; ` +
            `fi; ` +
            `if [ -f "$HASH_FILE" ]; then ` +
            `  EXPECTED=$(cat "$HASH_FILE"); ` +
            `  ACTUAL=$(sha256sum "$CANARY" | cut -d" " -f1); ` +
            `  if [ "$EXPECTED" != "$ACTUAL" ]; then ` +
            `    echo "❌ CANARY FILE MODIFIED: $CANARY"; ` +
            `    curl -s -X POST "$API_URL/api/backups/canary-alert" -H "Content-Type: application/json" ` +
            `      -d "{\\"reason\\": \\"MODIFIED\\", \\"file_path\\": \\"$CANARY\\"}" > /dev/null 2>&1 || true; ` +
            `    exit 1; ` +
            `  fi; ` +
            `fi; ` +
            `echo "✅ Canary file check passed: $CANARY"`;
    }

    /**
     * Add database configuration to borgmatic config
     * 
     * Supports both containerized databases (via docker network) and host databases.
     *
     * Important: We do NOT run dumps inside DB containers (no docker exec).
     * Instead, borgmatic runs inside the borgmatic-ui container and connects to:
     *   - Containerized DBs via docker network (e.g. borgmatic-db), using hostname=container-name
     *   - Host DBs via hostname=host.docker.internal (requires extra_hosts in docker compose)
     *
     * This means the borgmatic-ui container image must include the database client tools:
     * mariadb-dump/mysqldump, pg_dump, mongodump, sqlite3, etc.
     * @returns {Promise|null} Promise for password storage operation, or null if no storage needed
     */
    addDatabaseConfig(config, dbSource, opts = {}) {
        const backupId = opts.backupId || 'unknown';
        const dbIndex = Number.isInteger(opts.dbIndex) ? opts.dbIndex : 0;

        // If a plaintext password is provided, store it in password-manager and replace with env placeholder.
        // This prevents secrets from being written to borgmatic YAML (which is commonly exported/backed up/viewed).
        let passwordValue = dbSource.password;
        let storagePromise = null;
        
        if (typeof passwordValue === 'string' && passwordValue.length > 0) {
            const looksLikePlaceholder = /^\$\{BORGMATIC_UI_DB_PASS_[A-Za-z0-9_]+\}$/.test(passwordValue);
            if (!looksLikePlaceholder) {
                const passwordManager = require('./password-manager');
                const safeBackup = String(backupId).replace(/[^A-Za-z0-9_]/g, '_');
                const envVar = `BORGMATIC_UI_DB_PASS_${safeBackup}_${dbSource.type}_${dbIndex}`;
                // Store full context (encrypted at rest); return promise so caller can await it
                storagePromise = passwordManager.storeDatabaseCredentials(envVar, dbSource.type, {
                    password: passwordValue,
                    hostname: dbSource.hostname,
                    port: dbSource.port,
                    username: dbSource.username,
                    database_name: dbSource.database_name,
                }).catch((e) => {
                    console.warn(`⚠️ Could not store DB password for ${envVar}:`, e.message);
                    // Don't rethrow - allow backup to proceed even if password storage fails
                });
                passwordValue = '${' + envVar + '}';
            }
        }

        const dbConfig = {
            name: dbSource.database_name,
            hostname: dbSource.is_host_database ? 'host.docker.internal' : (dbSource.hostname || 'localhost'),
            port: dbSource.port,
            username: dbSource.username,
            password: passwordValue
        };

        if (dbSource.format) dbConfig.format = dbSource.format;
        if (dbSource.compression) dbConfig.compression = dbSource.compression;

        const dumpMethod = dbSource.dump_method || 'local';
        const useNativeHook = dumpMethod === 'native';
        const hookEligible = ['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(dbSource.type);

        if (hookEligible && useNativeHook) {
            // Experimental: use borgmatic's native FIFO/streaming mechanism
            switch (dbSource.type) {
                case 'postgresql':
                    config.postgresql_databases = config.postgresql_databases || [];
                    config.postgresql_databases.push(dbConfig);
                    break;
                case 'mysql':
                    config.mysql_databases = config.mysql_databases || [];
                    dbConfig.tls = dbSource.tls !== undefined ? dbSource.tls : false;
                    config.mysql_databases.push(dbConfig);
                    break;
                case 'mariadb':
                    config.mariadb_databases = config.mariadb_databases || [];
                    dbConfig.tls = dbSource.tls !== undefined ? dbSource.tls : false;
                    config.mariadb_databases.push(dbConfig);
                    break;
                case 'mongodb':
                    config.mongodb_databases = config.mongodb_databases || [];
                    config.mongodb_databases.push(dbConfig);
                    break;
            }
        } else if (hookEligible && !useNativeHook) {
            // Default: dump to temp directory via command hooks (reliable with all repo types)
            const safeBackup = String(backupId || 'unknown').replace(/[^A-Za-z0-9_]/g, '_');
            const safeHost = String(dbSource.is_host_database ? 'host' : (dbSource.hostname || 'localhost')).replace(/[^A-Za-z0-9_.-]/g, '_');
            const tempDir = `/tmp/borgmatic_db_dumps_${safeBackup}_${dbSource.type}_${dbIndex}_${safeHost}`;
            const passEnvVar = (typeof passwordValue === 'string' && passwordValue.startsWith('${'))
                ? passwordValue.slice(2, -1)
                : null;

            config.source_directories = config.source_directories || [];
            if (!config.source_directories.includes(tempDir)) {
                config.source_directories.push(tempDir);
            }

            this._appendCommandHook(config, {
                before: 'action',
                when: ['create'],
                run: [this.generateDbDumpScript(dbSource, passEnvVar, tempDir)],
            });

            const cleanupCmd = `rm -rf "${tempDir}"`;
            const hasCleanup = Array.isArray(config.commands) && config.commands.some(
                (hook) => Array.isArray(hook?.run) && hook.run.includes(cleanupCmd)
            );
            if (!hasCleanup) {
                this._appendCommandHook(config, {
                    after: 'action',
                    when: ['create'],
                    run: [cleanupCmd],
                });
            }
        } else {
            switch (dbSource.type) {
                case 'sqlite':
                    if (!dbSource.path) {
                        console.warn(`Skipping SQLite database "${dbSource.database_name}" - missing path`);
                        break;
                    }
                    config.sqlite_databases = config.sqlite_databases || [];
                    config.sqlite_databases.push({
                        name: dbSource.database_name,
                        path: dbSource.path
                    });
                    break;
                case 'mssql': {
                    const safeBackup = String(backupId || 'unknown').replace(/[^A-Za-z0-9_]/g, '_');
                    const mssqlTempDir = `/tmp/borgmatic_mssql_dumps_${safeBackup}_${dbIndex}`;
                    const mssqlPassEnvVar = (typeof passwordValue === 'string' && passwordValue.startsWith('${'))
                        ? passwordValue.slice(2, -1)
                        : null;

                    config.source_directories = config.source_directories || [];
                    if (!config.source_directories.includes(mssqlTempDir)) {
                        config.source_directories.push(mssqlTempDir);
                    }

                    this._appendCommandHook(config, {
                        before: 'action',
                        when: ['create'],
                        run: [this.generateMssqlDumpScript(dbSource, mssqlPassEnvVar, mssqlTempDir)],
                    });

                    const cleanupCmd = `rm -rf "${mssqlTempDir}"`;
                    const hasCleanup = Array.isArray(config.commands) && config.commands.some(
                        (hook) => Array.isArray(hook?.run) && hook.run.includes(cleanupCmd)
                    );
                    if (!hasCleanup) {
                        this._appendCommandHook(config, {
                            after: 'action',
                            when: ['create'],
                            run: [cleanupCmd],
                        });
                    }
                    break;
                }
            }
        }
        
        // Return the password storage promise (or null) so caller can await it
        return storagePromise;
    }

    /**
     * Generate MSSQL dump script for before_backup hook
     * Uses sqlpackage to export databases as .bacpac files (client-side export)
     * This streams data over the network to local storage, unlike sqlcmd BACKUP
     * which writes files on the SQL Server side.
     */
    generateMssqlDumpScript(dbSource, passEnvVar, tempDir) {
        const validated = this._validateMssqlInputs(dbSource);
        const hostname = validated.host;
        const port = validated.port;
        const authMethod = validated.auth_method;

        // Build server string for sqlpackage: "host,port" or "host,port\instance"
        const serverName = validated.instance
            ? `${hostname},${port}\\\\${validated.instance}`
            : `${hostname},${port}`;

        // Build server string for sqlcmd (used for listing databases in "all" mode)
        const sqlcmdServer = validated.instance
            ? `${hostname},${port}\\\\${validated.instance}`
            : `${hostname},${port}`;

        // sqlpackage encryption parameters
        const encryptValue = validated.encrypt === 'true' ? 'True' 
            : validated.encrypt === 'false' ? 'False' 
            : 'Strict';
        const trustCertValue = dbSource.trustServerCert ? 'True' : 'False';

        // sqlcmd flags for listing databases (in "all" mode)
        const sqlcmdEncryptMode = validated.encrypt === 'false' ? 'disable' : validated.encrypt;
        const sqlcmdEncryptFlag = `-N ${sqlcmdEncryptMode}`;
        const sqlcmdTrustCert = dbSource.trustServerCert ? '-C' : '';

        // Build password reference (use env var if available, otherwise direct value)
        const passwordRef = passEnvVar ? `\${${passEnvVar}}` : String(dbSource.password || '');
        const passwordRefQuoted = passEnvVar ? `"\${${passEnvVar}}"` : `"${String(dbSource.password || '')}"`;

        // Build auth-specific sqlcmd args for database listing
        let sqlcmdAuthArgs;
        if (authMethod === 'ad_password') {
            sqlcmdAuthArgs = `--authentication-method ActiveDirectoryPassword -U "${validated.user}" -P ${passwordRefQuoted}`;
        } else if (authMethod === 'service_principal') {
            sqlcmdAuthArgs = `--authentication-method ActiveDirectoryServicePrincipal -U "${validated.client_id}" -P ${passwordRefQuoted} --tenant-id "${validated.tenant_id}"`;
        } else {
            sqlcmdAuthArgs = `-U "${validated.user}" -P ${passwordRefQuoted}`;
        }

        // Build sqlpackage auth args: use /scs: (SourceConnectionString) for AD auth
        let sqlpackageAuthArgs;
        if (authMethod === 'ad_password') {
            const connStr = `Server=tcp:${serverName};Authentication=Active Directory Password;User ID=${validated.user};Encrypt=${encryptValue};TrustServerCertificate=${trustCertValue}`;
            sqlpackageAuthArgs = { useConnectionString: true, connStrTemplate: connStr };
        } else if (authMethod === 'service_principal') {
            const connStr = `Server=tcp:${serverName};Authentication=Active Directory Service Principal;User ID=${validated.client_id};Encrypt=${encryptValue};TrustServerCertificate=${trustCertValue}`;
            sqlpackageAuthArgs = { useConnectionString: true, connStrTemplate: connStr };
        } else {
            sqlpackageAuthArgs = { useConnectionString: false };
        }

        // Resolver for sqlcmd binary (used for listing databases)
        const sqlcmdResolver = `SQLCMD_BIN="$(command -v sqlcmd || true)"; if [ -z "$SQLCMD_BIN" ]; then if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then SQLCMD_BIN=/opt/mssql-tools18/bin/sqlcmd; elif [ -x /opt/mssql-tools/bin/sqlcmd ]; then SQLCMD_BIN=/opt/mssql-tools/bin/sqlcmd; else echo "sqlcmd not found"; exit 1; fi; fi`;

        // Resolver for sqlpackage binary (standalone zip on x64, dotnet tool on ARM64)
        const sqlpackageResolver = `SQLPACKAGE_BIN="$(command -v sqlpackage || true)"; if [ -z "$SQLPACKAGE_BIN" ]; then if [ -x /opt/sqlpackage/sqlpackage ]; then SQLPACKAGE_BIN=/opt/sqlpackage/sqlpackage; elif [ -x /opt/dotnet-cli/.dotnet/tools/sqlpackage ]; then SQLPACKAGE_BIN=/opt/dotnet-cli/.dotnet/tools/sqlpackage; else echo "sqlpackage not found"; exit 1; fi; fi`;

        // Metadata for round-trip config extraction
        const metadata = {
            type: 'mssql',
            database_name: validated.dbName,
            hostname,
            port,
            username: validated.user,
            instance: validated.instance,
            encrypt: validated.encrypt,
            trustServerCert: !!dbSource.trustServerCert,
            is_host_database: !!dbSource.is_host_database,
            auth_method: authMethod,
            client_id: validated.client_id || undefined,
            tenant_id: validated.tenant_id || undefined,
        };
        const metadataB64 = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');

        // Helper: build sqlpackage export command for a database.
        // dbNameQuoted is a shell-quoted reference (e.g. '"$db"' or '"MyDB"').
        // dbNameRaw is unquoted (e.g. '$db' or 'MyDB') for embedding inside a connection string.
        const buildSqlpackageCmd = (dbNameQuoted, dbNameRaw, targetFileRef) => {
            if (sqlpackageAuthArgs.useConnectionString) {
                return `"$SQLPACKAGE_BIN" /Action:Export \\
        /scs:"${sqlpackageAuthArgs.connStrTemplate};Password=\\"$DB_PASS_ESC\\";Initial Catalog=${dbNameRaw}" \\
        /TargetFile:${targetFileRef}`;
            }
            return `"$SQLPACKAGE_BIN" /Action:Export \\
        /SourceServerName:"${serverName}" \\
        /SourceDatabaseName:${dbNameQuoted} \\
        /SourceUser:"${validated.user}" \\
        /SourcePassword:"${passwordRef}" \\
        /SourceTrustServerCertificate:${trustCertValue} \\
        /SourceEncryptConnection:${encryptValue} \\
        /TargetFile:${targetFileRef}`;
        };

        // DB_PASS assignment used in connection string templates
        const dbPassLine = `DB_PASS="${passwordRef}"`;
        const dbPassEscLine = `DB_PASS_ESC="$(printf '%s' "$DB_PASS" | sed 's/"/""/g')"`;

        // For "all" databases, query with sqlcmd then export each with sqlpackage
        if (validated.dbName === 'all') {
            return `#!/bin/sh
# MSSQL export script - all user databases (using sqlpackage)
set -eu
# BORGMATIC_UI_MSSQL_META_B64:${metadataB64}
${dbPassLine}
${sqlpackageAuthArgs.useConnectionString ? dbPassEscLine : ''}
${sqlcmdResolver}
${sqlpackageResolver}
mkdir -p "${tempDir}"
echo "Listing MSSQL databases..."
"$SQLCMD_BIN" -S "${sqlcmdServer}" ${sqlcmdAuthArgs} ${sqlcmdEncryptFlag} ${sqlcmdTrustCert} -b -r 1 -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND name NOT IN ('master','tempdb','model','msdb')" | while IFS= read -r db; do
    [ -z "$db" ] && continue
    if ! printf '%s' "$db" | grep -Eq '^[A-Za-z0-9_-]+$'; then
        echo "Skipping MSSQL database with unsupported name: $db"
        continue
    fi
    echo "Exporting MSSQL database: $db"
    ${buildSqlpackageCmd('"$db"', '$db', `"${tempDir}/$db.bacpac"`)}
done`;
        }

        // Single database export
        return `#!/bin/sh
# MSSQL export script - single database: ${validated.dbName} (using sqlpackage)
set -eu
# BORGMATIC_UI_MSSQL_META_B64:${metadataB64}
${dbPassLine}
${sqlpackageAuthArgs.useConnectionString ? dbPassEscLine : ''}
${sqlpackageResolver}
mkdir -p "${tempDir}"
echo "Exporting MSSQL database: ${validated.dbName}"
${buildSqlpackageCmd(`"${validated.dbName}"`, validated.dbName, `"${tempDir}/${validated.dbName}.bacpac"`)}`;
    }

    /**
     * Generate a database dump script for MariaDB, MySQL, PostgreSQL, or MongoDB.
     * Dumps to a temp directory which gets included in source_directories.
     * This avoids borgmatic's internal FIFO/streaming mechanism which has JSON
     * parsing bugs with SSH warnings from remote repositories.
     */
    generateDbDumpScript(dbSource, passEnvVar, tempDir) {
        const validated = this._validateHookDbInputs(dbSource);
        const hostname = validated.host;
        const port = validated.port;
        const username = validated.user;
        const dbName = validated.dbName;
        const authDb = validated.authDb;
        const hasEnvVar = typeof passEnvVar === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(passEnvVar);
        const passwordLiteral = hasEnvVar ? '' : String(dbSource.password || '');

        const metadata = {
            type: dbSource.type,
            database_name: dbName,
            hostname,
            port,
            username,
            tls: dbSource.tls,
            authentication_database: dbSource.authentication_database,
            is_host_database: !!dbSource.is_host_database,
            db_password_env_var: hasEnvVar ? passEnvVar : null,
        };
        const metadataB64 = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');
        const metadataComment = `# BORGMATIC_UI_DB_META_B64:${metadataB64}`;
        const dbPassLine = hasEnvVar
            ? `DB_PASS="\${${passEnvVar}:-}"`
            : `DB_PASS=${this._shellSingleQuote(passwordLiteral)}`;
        const hostQ = this._shellSingleQuote(hostname);
        const userQ = this._shellSingleQuote(username);
        const dbNameQ = this._shellSingleQuote(dbName);
        const authDbQ = this._shellSingleQuote(authDb);
        const tempDirQ = this._shellSingleQuote(tempDir);

        switch (dbSource.type) {
            case 'mariadb':
            case 'mysql': {
                const dumpCmd = dbSource.type === 'mariadb' ? 'mariadb-dump' : 'mysqldump';
                const tlsFlag = dbSource.tls === false ? ' --skip-ssl' : '';
                if (dbName === 'all') {
                    return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
echo "Dumping all ${dbSource.type} databases from ${hostname}:${port}..."
MYSQL_PWD="$DB_PASS" ${dumpCmd} -h ${hostQ} -P ${port} -u ${userQ} --single-transaction --all-databases${tlsFlag} > ${tempDirQ}/all-databases.sql
echo "Database dump completed: ${tempDir}/all-databases.sql"`;
                }
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
echo "Dumping ${dbSource.type} database '${dbName}' from ${hostname}:${port}..."
MYSQL_PWD="$DB_PASS" ${dumpCmd} -h ${hostQ} -P ${port} -u ${userQ} --single-transaction --databases ${dbNameQ}${tlsFlag} > ${tempDirQ}/${dbNameQ}.sql
echo "Database dump completed: ${tempDir}/${dbName}.sql"`;
            }

            case 'postgresql': {
                const pgpassLineQ = this._shellSingleQuote(`${hostname}:${port}:*:${username}:`);
                if (dbName === 'all') {
                    return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
export PGPASSFILE="$(mktemp)"
trap 'rm -f "$PGPASSFILE"' EXIT
printf "%s%s\\n" ${pgpassLineQ} "$DB_PASS" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
echo "Dumping all PostgreSQL databases from ${hostname}:${port}..."
pg_dumpall -h ${hostQ} -p ${port} -U ${userQ} -f ${tempDirQ}/all-databases.sql
echo "Database dump completed: ${tempDir}/all-databases.sql"`;
                }
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
export PGPASSFILE="$(mktemp)"
trap 'rm -f "$PGPASSFILE"' EXIT
printf "%s%s\\n" ${pgpassLineQ} "$DB_PASS" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
echo "Dumping PostgreSQL database '${dbName}' from ${hostname}:${port}..."
pg_dump -h ${hostQ} -p ${port} -U ${userQ} -d ${dbNameQ} -Fc -f ${tempDirQ}/${dbNameQ}.dump
echo "Database dump completed: ${tempDir}/${dbName}.dump"`;
            }

            case 'mongodb': {
                const authPart = username ? ` --username=${userQ} --password="$DB_PASS" --authenticationDatabase=${authDbQ}` : '';
                if (dbName === 'all') {
                    return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
echo "Dumping all MongoDB databases from ${hostname}:${port}..."
mongodump --host=${hostQ} --port=${port}${authPart} --archive=${tempDirQ}/all-databases.archive
echo "Database dump completed: ${tempDir}/all-databases.archive"`;
                }
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
mkdir -p ${tempDirQ}
echo "Dumping MongoDB database '${dbName}' from ${hostname}:${port}..."
mongodump --host=${hostQ} --port=${port} --db=${dbNameQ}${authPart} --archive=${tempDirQ}/${dbNameQ}.archive
echo "Database dump completed: ${tempDir}/${dbName}.archive"`;
            }

            default:
                throw new Error(`Unsupported database type for dump script: ${dbSource.type}`);
        }
    }

    _getDefaultPort(dbType) {
        const defaults = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, mssql: 1433 };
        return defaults[dbType] || 5432;
    }

    /**
     * Build checks configuration
     */
    buildChecksConfig(frequency) {
        const checks = [
            { name: 'repository', frequency }
        ];

        // Add data check monthly if frequency allows
        if (['weekly', 'monthly'].includes(frequency)) {
            checks.push({ name: 'data', frequency: '1 month' });
        }

        return checks;
    }

    /**
     * Extract sources from existing config
     * Handles both old sectioned format (location:) and new flat format
     */
    extractSourcesFromConfig(config) {
        const sources = [];
        
        // Extract local sources (handle both old and new format)
        const sourceDirs = config.source_directories || config.location?.source_directories || [];
        for (const dir of sourceDirs) {
            if (this._isDumpTempPath(dir)) continue;
            sources.push({ type: 'local', path: dir });
        }
        
        // Extract PostgreSQL databases (native borgmatic hooks)
        if (config.postgresql_databases) {
            for (const db of config.postgresql_databases) {
                sources.push({
                    type: 'postgresql',
                    database_name: db.name,
                    hostname: db.hostname,
                    port: db.port,
                    username: db.username,
                    password: db.password,
                    dump_method: 'native',
                });
            }
        }
        
        // Extract MySQL databases (native borgmatic hooks)
        if (config.mysql_databases) {
            for (const db of config.mysql_databases) {
                sources.push({
                    type: 'mysql',
                    database_name: db.name,
                    hostname: db.hostname,
                    port: db.port,
                    username: db.username,
                    password: db.password,
                    tls: db.tls,
                    dump_method: 'native',
                });
            }
        }
        
        // Extract MariaDB databases (native borgmatic hooks)
        if (config.mariadb_databases) {
            for (const db of config.mariadb_databases) {
                sources.push({
                    type: 'mariadb',
                    database_name: db.name,
                    hostname: db.hostname,
                    port: db.port,
                    username: db.username,
                    password: db.password,
                    tls: db.tls,
                    dump_method: 'native',
                });
            }
        }
        
        // Extract MongoDB databases (native borgmatic hooks)
        if (config.mongodb_databases) {
            for (const db of config.mongodb_databases) {
                sources.push({
                    type: 'mongodb',
                    database_name: db.name,
                    hostname: db.hostname,
                    port: db.port,
                    username: db.username,
                    password: db.password,
                    authentication_database: db.authentication_database,
                    dump_method: 'native',
                });
            }
        }
        
        // Extract SQLite databases
        if (config.sqlite_databases) {
            for (const db of config.sqlite_databases) {
                sources.push({
                    type: 'sqlite',
                    database_name: db.name,
                    path: db.path
                });
            }
        }

        // Extract MSSQL databases from generated hook metadata markers
        sources.push(...this._extractMssqlSourcesFromHooks(config));

        // Extract MariaDB/MySQL/PostgreSQL/MongoDB from command-hook dump scripts
        sources.push(...this._extractDbDumpSourcesFromHooks(config));
        
        return sources;
    }

    /**
     * Preserve existing DB password placeholders when user-provided source has no password.
     * Match is based on type + name + host + port + username.
     */
    _preserveDatabasePasswords(newSources, existingSources) {
        const existingDb = (existingSources || []).filter(s => s.type && s.type !== 'local');
        return (newSources || []).map((s) => {
            if (!s || !s.type || s.type === 'local') return s;
            // SQLite has no password
            if (s.type === 'sqlite') return s;

            const hasPassword = typeof s.password === 'string' && s.password.trim().length > 0;
            if (hasPassword) return s;

            const match = existingDb.find((e) =>
                e.type === s.type &&
                String(e.database_name || '') === String(s.database_name || '') &&
                String(e.hostname || '') === String(s.hostname || '') &&
                String(e.port || '') === String(s.port || '') &&
                String(e.username || '') === String(s.username || '') &&
                (s.type !== 'mssql' || String(e.instance || '') === String(s.instance || ''))
            );
            if (match && match.password) {
                return { ...s, password: match.password };
            }
            return s;
        });
    }

    /**
     * Extract check frequency from existing config
     */
    extractCheckFrequency(config) {
        if (config.checks && config.checks.length > 0) {
            return config.checks[0].frequency || '2 weeks';
        }
        return '2 weeks';
    }

    /**
     * Convert log level string to borgmatic verbosity number
     */
    logLevelToVerbosity(logLevel) {
        const levels = {
            'error': -1,
            'warning': 0,
            'info': 1,
            'debug': 2
        };
        return levels[logLevel.toLowerCase()] || 1;
    }

    /**
     * Generate YAML file content with header
     */
    generateYAML(config, backupId, metadata) {
        const header = `# Generated by Borgmatic-UI
# Backup Name: ${metadata.name}
${metadata.description ? `# Description: ${metadata.description}\n` : ''}# Backup ID: ${backupId}
# Created: ${metadata.created_at || new Date().toISOString()}
# Last Updated: ${new Date().toISOString()}
# Active: ${metadata.is_active !== false ? 'Yes' : 'No'}
${metadata.schedule_id ? `# Schedule ID: ${metadata.schedule_id}\n` : ''}
`;

        return header + '\n' + yaml.dump(config, { 
            indent: 2,
            lineWidth: 120,
            noRefs: true
        });
    }

    /**
     * Load metadata file
     */
    async loadMetadata() {
        try {
            const content = await fs.readFile(this.metadataPath, 'utf8');
            if (!content.trim()) {
                return { backups: [] };
            }
            return yaml.load(content) || { backups: [] };
        } catch (error) {
            return { backups: [] };
        }
    }

    /**
     * Save metadata file
     */
    async saveMetadata(metadata) {
        await fs.writeFile(
            this.metadataPath,
            yaml.dump(metadata, { indent: 2 })
        );
    }

    /**
     * Load backup configuration from YAML file
     */
    async loadBackupConfig(yamlPath) {
        const content = await fs.readFile(yamlPath, 'utf8');
        // Remove comment lines for parsing
        const cleanContent = content.split('\n')
            .filter(line => !line.trim().startsWith('#'))
            .join('\n');
        return yaml.load(cleanContent) || {};
    }

    /**
     * Update backup metadata (last_run, status, etc.)
     */
    async updateBackupMetadata(backupId, updates) {
        try {
            const metadata = await this.loadMetadata();
            const backupIndex = metadata.backups.findIndex(b => b.id === backupId);
            
            if (backupIndex === -1) {
                throw new Error(`Backup not found: ${backupId}`);
            }

            metadata.backups[backupIndex] = {
                ...metadata.backups[backupIndex],
                ...updates,
                updated_at: new Date().toISOString()
            };

            await this.saveMetadata(metadata);
            console.log(`✅ Updated metadata for backup: ${backupId}`);
        } catch (error) {
            console.error('Failed to update backup metadata:', error);
            throw error;
        }
    }

    /**
     * Get sources summary for UI display
     * Handles both old sectioned format (location:) and new flat format
     */
    getSourcesSummary(config) {
        const sources = [];
        
        // Local directories (handle both formats)
        const sourceDirs = config.source_directories || config.location?.source_directories || [];
        sources.push(...sourceDirs.map(dir => ({
            type: 'local',
            path: dir
        })).filter((s) => !this._isDumpTempPath(s.path)));

        // Native borgmatic database hooks (FIFO/streaming) - dump_method: 'native'
        ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite'].forEach(dbType => {
            const dbKey = `${dbType}_databases`;
            if (config[dbKey]) {
                config[dbKey].forEach(db => {
                    const isHostDatabase = db.hostname === 'host.docker.internal';
                    const connection_type = dbType === 'sqlite' ? 'file' : (isHostDatabase ? 'host' : 'network');
                    
                    sources.push({
                        type: dbType,
                        database_type: dbType,
                        database_name: db.name,
                        hostname: db.hostname,
                        port: db.port,
                        username: db.username,
                        password: undefined,
                        tls: db.tls,
                        path: db.path,
                        is_host_database: isHostDatabase,
                        connection_type,
                        dump_method: dbType === 'sqlite' ? undefined : 'native',
                    });
                });
            }
        });

        // Hook-based DB dumps (dump-to-file) - dump_method: 'local'
        const dbDumpSources = this._extractDbDumpSourcesFromHooks(config).map((db) => ({
            type: db.type,
            database_type: db.type,
            database_name: db.database_name,
            hostname: db.hostname,
            port: db.port,
            username: db.username,
            password: undefined,
            tls: db.tls,
            is_host_database: !!db.is_host_database,
            connection_type: db.is_host_database ? 'host' : 'network',
            dump_method: 'local',
        }));
        sources.push(...dbDumpSources);

        // MSSQL is always hook-based
        const mssqlSources = this._extractMssqlSourcesFromHooks(config).map((db) => {
            const src = {
                type: 'mssql',
                database_type: 'mssql',
                database_name: db.database_name,
                hostname: db.hostname,
                port: db.port,
                username: db.username,
                password: undefined,
                instance: db.instance || '',
                encrypt: db.encrypt || 'true',
                trustServerCert: !!db.trustServerCert,
                is_host_database: !!db.is_host_database,
                connection_type: db.is_host_database ? 'host' : 'network',
                auth_method: db.auth_method || 'sql',
            };
            if (db.client_id) src.client_id = db.client_id;
            if (db.tenant_id) src.tenant_id = db.tenant_id;
            return src;
        });
        sources.push(...mssqlSources);

        return sources;
    }

    /**
     * Get repositories summary for UI display
     * Handles both old sectioned format (location:) and new flat format
     */
    getRepositoriesSummary(config, allRepos = []) {
        const repos = config.repositories || config.location?.repositories || [];
        if (!repos.length) return [];
        
        return repos.map(repo => {
            // Try to find matching repo from all repos to get borg_version
            const matchedRepo = allRepos.find(r => r.path === repo.path);
            return {
                path: repo.path,
                label: repo.label,
                borg_version: matchedRepo?.borg_version || repo.borg_version || null
            };
        });
    }
}

module.exports = new BackupManager();
