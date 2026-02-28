/**
 * Configuration Export/Import Service
 * 
 * Handles exporting and importing Borgmatic UI configurations including:
 * - Repositories
 * - Backup jobs
 * - Schedules
 * - Scripts
 * - Notification settings
 * - SSH Keys (with encryption)
 * - System settings
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const config = require('../config');
const yamlManager = require('./yaml-manager');
const borgmaticConfig = require('./borgmatic-config');
const configParser = require('./config-parser');
const passwordManager = require('./password-manager');
const identityManager = require('./identity-manager');
const scheduleManager = require('./schedule-manager');
const scriptManager = require('./script-manager');
const sshKeysService = require('./ssh-keys');

// Canonical paths (must match the rest of the app)
const BORGMATIC_D = path.join(config.configDir, 'borgmatic.d');
const APPRISE_CONFIG = path.join(config.configDir, 'apprise.yaml');
const SSH_KEYS_YAML = path.join(config.dataDir, 'ssh-keys.yaml'); // used by /api/ssh-keys + ssh-keys service

/**
 * Export all configuration data
 * 
 * @param {Object} options - Export options
 * @param {boolean} options.includeSecrets - Include passphrases, SSH keys, etc.
 * @param {boolean} options.includeSchedules - Include backup schedules
 * @param {boolean} options.includeScripts - Include pre/post scripts
 * @param {boolean} options.includeNotifications - Include notification settings
 * @returns {Object} Complete configuration export
 */
async function exportConfiguration(options = {}) {
    const {
        includeSecrets = false,
        includeSchedules = true,
        includeScripts = true,
        includeNotifications = true,
    } = options;

    const exportData = {
        _meta: {
            version: '1.0',
            exported_at: new Date().toISOString(),
            borgmatic_ui_version: process.env.npm_package_version || '1.0.0',
            encrypted: false,
        },
        identity: null,
        repositories: [],
        backups: [],
        schedules: [],
        scripts: [],
        notification_settings: null,
        system_settings: null,
        ssh_keys: [],
    };

    try {
        // Export identity (mode, director/client config)
        exportData.identity = await exportIdentity(includeSecrets);

        // Export repositories
        const repositories = await exportRepositories(includeSecrets);
        exportData.repositories = repositories;

        // Export backup jobs (from borgmatic.d configs)
        const backups = await exportBackupJobs(includeSecrets);
        exportData.backups = backups;

        // Export schedules (saved_schedules.yaml via scheduleManager)
        if (includeSchedules) {
            exportData.schedules = await exportSchedules();
        }

        // Export scripts (custom scripts from scripts.json via scriptManager)
        if (includeScripts) {
            exportData.scripts = await exportScripts();
        }

        // Export notification settings
        if (includeNotifications) {
            const notifications = await exportNotificationSettings(includeSecrets);
            exportData.notification_settings = notifications;
        }

        // Export system settings (stored inside borgmatic config)
        exportData.system_settings = await exportSystemSettings();

        // Export SSH key metadata always; include private keys only when secrets enabled
        exportData.ssh_keys = await exportSSHKeys(includeSecrets);

    } catch (error) {
        console.error('Error exporting configuration:', error);
        throw error;
    }

    return exportData;
}

/**
 * Export identity (mode/client/director settings)
 * Note: connection_token is a secret and is only included when includeSecrets=true
 */
async function exportIdentity(includeSecrets = false) {
    try {
        const identity = await identityManager.getIdentity();
        if (!identity) return null;

        // Shallow clone and strip private key always (it's encrypted with instance SECRET_KEY and not portable)
        const exported = { ...identity };
        delete exported.private_key;

        if (!includeSecrets) {
            // Strip any tokens/credentials
            if (typeof exported.connection_token === 'string' && exported.connection_token.length > 0) {
                exported.connection_token = '***';
            }
        }

        return exported;
    } catch (error) {
        console.warn('Error exporting identity:', error.message);
        return null;
    }
}

/**
 * Export repositories
 */
async function exportRepositories(includeSecrets = false) {
    const repositories = [];
    
    try {
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        
        for (const repo of allRepos) {
            const repoExport = {
                name: repo.name,
                path: repo.path,
                repository_type: repo.repository_type || 'local',
                compression: repo.compression,
                encryption: repo.encryption,
                read_only: repo.read_only || false,
                ssh_key_id: repo.ssh_key_id,
                ssh_auth_method: repo.ssh_auth_method,
            };

            // Include passphrase if secrets are enabled
            if (includeSecrets && repo.path) {
                try {
                    const passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
                    if (passphrase) {
                        repoExport.passphrase = passphrase;
                    }
                } catch (e) {
                    // Passphrase not found, skip
                }
            }

            repositories.push(repoExport);
        }
    } catch (error) {
        console.warn('Error exporting repositories:', error.message);
    }

    return repositories;
}

/**
 * Export backup jobs from borgmatic.d configs
 */
async function exportBackupJobs(includeSecrets = false) {
    const backups = [];

    try {
        if (await fs.pathExists(BORGMATIC_D)) {
            const files = await fs.readdir(BORGMATIC_D);
            const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

            for (const file of yamlFiles) {
                const filePath = path.join(BORGMATIC_D, file);
                const content = await fs.readFile(filePath, 'utf8');
                const config = yaml.load(content);

                if (config) {
                    backups.push({
                        name: path.basename(file, path.extname(file)),
                        filename: file,
                        config: includeSecrets ? config : redactSecrets(config),
                    });
                }
            }
        }
    } catch (error) {
        console.warn('Error exporting backup jobs:', error.message);
    }

    return backups;
}

/**
 * Redact secrets from borgmatic config objects for STANDARD export.
 * This intentionally errs on the side of masking too much rather than leaking secrets.
 */
function redactSecrets(value) {
    const secretKeyPattern = /(passphrase|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)/i;
    const redacted = '***';

    const walk = (v) => {
        if (v === null || v === undefined) return v;
        if (Array.isArray(v)) return v.map(walk);
        if (typeof v === 'object') {
            const out = {};
            for (const [k, child] of Object.entries(v)) {
                if (secretKeyPattern.test(k)) {
                    out[k] = redacted;
                } else {
                    out[k] = walk(child);
                }
            }
            return out;
        }
        // strings that look like URLs with embedded credentials
        if (typeof v === 'string') {
            return v.replace(/:\/\/([^@/]+)@/g, '://***@');
        }
        return v;
    };

    return walk(value);
}

/**
 * Export schedules
 */
async function exportSchedules() {
    try {
        return await scheduleManager.getAllSchedules();
    } catch (error) {
        console.warn('Error exporting schedules:', error.message);
    }

    return [];
}

/**
 * Export custom scripts (exclude built-in templates)
 */
async function exportScripts() {
    try {
        const cfg = await scriptManager.loadConfig();
        return cfg.scripts || [];
    } catch (error) {
        console.warn('Error exporting scripts:', error.message);
    }

    return [];
}

/**
 * Export notification settings
 */
async function exportNotificationSettings(includeSecrets = false) {
    try {
        if (await fs.pathExists(APPRISE_CONFIG)) {
            const content = await fs.readFile(APPRISE_CONFIG, 'utf8');
            const config = yaml.load(content);

            if (!includeSecrets && config) {
                // Mask sensitive parts of notification URLs
                return maskNotificationUrls(config);
            }

            return config;
        }
    } catch (error) {
        console.warn('Error exporting notification settings:', error.message);
    }

    return null;
}

/**
 * Mask sensitive parts of notification URLs
 */
function maskNotificationUrls(config) {
    if (!config || !config.notifications) return config;

    const masked = JSON.parse(JSON.stringify(config));

    for (const [key, value] of Object.entries(masked.notifications)) {
        if (value.urls && Array.isArray(value.urls)) {
            // Safer default: do not export notification URLs in standard export at all
            // (URLs often contain tokens, webhook secrets, etc.)
            value.urls = value.urls.map(() => '***');
        }
    }

    return masked;
}

/**
 * Export system settings
 */
async function exportSystemSettings() {
    try {
        const cfg = await borgmaticConfig.loadConfig();
        return cfg.system_settings || null;
    } catch (error) {
        console.warn('Error exporting system settings:', error.message);
    }

    return null;
}

/**
 * Export SSH keys.
 * - Always exports metadata (id/name/public_key/etc.)
 * - When includeSecrets=true, exports decrypted private_key + passphrase (if present)
 */
async function exportSSHKeys(includeSecrets = false) {
    try {
        if (!await fs.pathExists(SSH_KEYS_YAML)) return [];
        const data = await yamlManager.readYaml(SSH_KEYS_YAML);
        const keys = data?.ssh_keys || [];

        if (!includeSecrets) {
            // Strip encrypted blobs; keep metadata only
            return keys.map(k => ({
                id: k.id,
                name: k.name,
                description: k.description,
                key_type: k.key_type,
                public_key: k.public_key,
                is_encrypted: k.is_encrypted || false,
                is_active: k.is_active,
                created_at: k.created_at,
                updated_at: k.updated_at,
            }));
        }

        // Include decrypted secrets for encrypted export (portable within encrypted payload)
        const decrypted = [];
        for (const k of keys) {
            try {
                const full = await sshKeysService.getSSHKey(k.id);
                if (!full) continue;
                decrypted.push({
                    id: full.id,
                    name: full.name,
                    description: full.description,
                    key_type: full.key_type,
                    public_key: full.public_key,
                    private_key: full.private_key,
                    is_encrypted: full.is_encrypted || false,
                    passphrase: full.passphrase || null,
                    is_active: full.is_active,
                    created_at: full.created_at,
                    updated_at: full.updated_at,
                });
            } catch (e) {
                console.warn(`Failed to decrypt SSH key ${k.name || k.id}: ${e.message}`);
            }
        }
        return decrypted;
    } catch (error) {
        console.warn('Error exporting SSH keys:', error.message);
    }

    return [];
}

/**
 * Import configuration data
 * 
 * @param {Object} importData - Configuration data to import
 * @param {Object} options - Import options
 * @param {string} options.mergeStrategy - 'skip' | 'update' | 'rename' | 'replace'
 * @param {boolean} options.dryRun - Only preview changes, don't apply
 * @returns {Object} Import result with statistics
 */
async function importConfiguration(importData, options = {}) {
    const {
        mergeStrategy = 'skip',
        dryRun = false,
    } = options;

    const result = {
        success: true,
        repositories_created: 0,
        repositories_updated: 0,
        repositories_skipped: 0,
        backups_created: 0,
        backups_updated: 0,
        backups_skipped: 0,
        schedules_created: 0,
        schedules_updated: 0,
        schedules_skipped: 0,
        scripts_created: 0,
        scripts_updated: 0,
        scripts_skipped: 0,
        warnings: [],
        errors: [],
        preview: [],
    };

    try {
        // Identity import is intentionally not supported (mode/tokens are instance-specific).
        // Keep it in exports for audit/visibility only.
        if (importData.identity) {
            result.warnings.push('Identity settings (mode, director/client connection info) are not imported automatically for safety.');
            result.preview.push({ type: 'identity', action: 'skipped', reason: 'Instance-specific' });
        }

        // Import repositories
        if (importData.repositories && Array.isArray(importData.repositories)) {
            const repoResult = await importRepositories(importData.repositories, mergeStrategy, dryRun);
            result.repositories_created = repoResult.created;
            result.repositories_updated = repoResult.updated;
            result.repositories_skipped = repoResult.skipped;
            result.warnings.push(...repoResult.warnings);
            result.preview.push(...repoResult.preview);
        }

        // Import backup jobs
        if (importData.backups && Array.isArray(importData.backups)) {
            const backupResult = await importBackupJobs(importData.backups, mergeStrategy, dryRun);
            result.backups_created = backupResult.created;
            result.backups_updated = backupResult.updated;
            result.backups_skipped = backupResult.skipped;
            result.warnings.push(...backupResult.warnings);
            result.preview.push(...backupResult.preview);
        }

        // Import schedules
        if (importData.schedules && Array.isArray(importData.schedules)) {
            const scheduleResult = await importSchedules(importData.schedules, mergeStrategy, dryRun);
            result.schedules_created = scheduleResult.created;
            result.schedules_updated = scheduleResult.updated;
            result.schedules_skipped = scheduleResult.skipped;
            result.warnings.push(...scheduleResult.warnings);
            result.preview.push(...scheduleResult.preview);
        }

        // Import scripts
        if (importData.scripts && Array.isArray(importData.scripts)) {
            const scriptResult = await importScripts(importData.scripts, mergeStrategy, dryRun);
            result.scripts_created = scriptResult.created;
            result.scripts_updated = scriptResult.updated;
            result.scripts_skipped = scriptResult.skipped;
            result.warnings.push(...scriptResult.warnings);
            result.preview.push(...scriptResult.preview);
        }

        // Import notification settings
        if (importData.notification_settings && !dryRun) {
            await importNotificationSettings(importData.notification_settings);
            result.preview.push({ type: 'notification_settings', action: 'imported' });
        }

        // Import system settings
        if (importData.system_settings && !dryRun) {
            await importSystemSettings(importData.system_settings);
            result.preview.push({ type: 'system_settings', action: 'imported' });
        }

        // Import SSH keys
        if (importData.ssh_keys && Array.isArray(importData.ssh_keys)) {
            const sshResult = await importSSHKeys(importData.ssh_keys, mergeStrategy, dryRun);
            result.warnings.push(...sshResult.warnings);
            result.preview.push(...sshResult.preview);
        }

    } catch (error) {
        result.success = false;
        result.errors.push(error.message);
    }

    return result;
}

/**
 * Encrypt SSH private key/passphrase for at-rest storage (same format as /api/ssh-keys)
 * salt:iv:tag:encrypted (hex)
 */
function encryptSSHSecret(plaintext) {
    if (!plaintext) return null;
    const secretKey = config.secretKey || process.env.SECRET_KEY;
    if (!secretKey) {
        throw new Error('SECRET_KEY is required for SSH secret encryption');
    }

    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(secretKey, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function normalizeRepoPath(p) {
    if (!p) return '';
    const s = String(p);
    // Normalize ssh:// paths without breaking the user@host:port prefix too much
    if (s.startsWith('ssh://')) {
        return path.normalize(s.replace(/^ssh:\/\//, ''));
    }
    return path.normalize(s);
}

/**
 * Import repositories
 */
async function importRepositories(repositories, mergeStrategy, dryRun) {
    const result = { created: 0, updated: 0, skipped: 0, warnings: [], preview: [] };

    try {
        const existingRepos = await configParser.getAllRepositoriesWithUsage();
        const existingPaths = new Set(existingRepos.map(r => normalizeRepoPath(r.path)));
        const existingNames = new Set(existingRepos.map(r => r.name).filter(Boolean));

        for (const repo of repositories) {
            const repoPathNorm = normalizeRepoPath(repo.path);
            const exists = existingPaths.has(repoPathNorm);
            const nameExists = repo.name ? existingNames.has(repo.name) : false;

            if (exists) {
                if (mergeStrategy === 'skip') {
                    result.skipped++;
                    result.preview.push({ type: 'repository', name: repo.name, action: 'skip', reason: 'Path already exists' });
                } else if (mergeStrategy === 'update' || mergeStrategy === 'replace') {
                    if (!dryRun) {
                        // Update or create entry inside repositories-unused.yaml
                        const unused = await configParser.getUnusedRepositories();
                        const idx = unused.findIndex(r => normalizeRepoPath(r.path) === repoPathNorm);
                        const merged = {
                            ...(idx >= 0 ? unused[idx] : {}),
                            ...repo,
                        };
                        // Never store passphrase in repositories-unused.yaml
                        delete merged.passphrase;

                        if (idx >= 0) {
                            unused[idx] = merged;
                        } else {
                            unused.push(merged);
                        }
                        await configParser.saveUnusedRepositories(unused);

                        if (repo.passphrase) {
                            await passwordManager.storeRepositoryPassphrase(repo.path, repo.passphrase);
                        }
                    }
                    result.updated++;
                    result.preview.push({ type: 'repository', name: repo.name, action: 'update' });
                }
            } else {
                let newName = repo.name || 'Imported Repository';
                if (repo.name && nameExists && mergeStrategy === 'rename') {
                    let counter = 2;
                    while (existingNames.has(`${repo.name} (${counter})`)) {
                        counter++;
                    }
                    newName = `${repo.name} (${counter})`;
                }

                if (!dryRun) {
                    const toSave = { ...repo, name: newName };
                    delete toSave.passphrase;
                    await configParser.addUnusedRepository(toSave);
                    if (repo.passphrase) {
                        await passwordManager.storeRepositoryPassphrase(repo.path, repo.passphrase);
                    }
                }
                result.created++;
                result.preview.push({ type: 'repository', name: newName, action: 'create' });
                existingNames.add(newName);
                existingPaths.add(repoPathNorm);
            }
        }
    } catch (error) {
        result.warnings.push(`Repository import error: ${error.message}`);
    }

    return result;
}

/**
 * Import backup jobs
 */
async function importBackupJobs(backups, mergeStrategy, dryRun) {
    const result = { created: 0, updated: 0, skipped: 0, warnings: [], preview: [] };

    try {
        await fs.ensureDir(BORGMATIC_D);
        const existingFiles = await fs.readdir(BORGMATIC_D);
        const existingNames = new Set(existingFiles.map(f => path.basename(f, path.extname(f))));

        for (const backup of backups) {
            // SECURITY: prevent path traversal (filename is untrusted input from import file)
            const requested = (backup && (backup.filename || backup.name)) ? String(backup.filename || backup.name) : 'imported-backup';
            const safeBase = path.basename(requested).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'imported-backup';
            const safeFilename = safeBase.endsWith('.yaml') || safeBase.endsWith('.yml') ? safeBase : `${safeBase}.yaml`;
            const baseName = path.basename(safeFilename, path.extname(safeFilename));
            const exists = existingNames.has(baseName);

            if (exists) {
                if (mergeStrategy === 'skip') {
                    result.skipped++;
                    result.preview.push({ type: 'backup', name: baseName, action: 'skip', reason: 'Already exists' });
                } else if (mergeStrategy === 'update' || mergeStrategy === 'replace') {
                    if (!dryRun) {
                        const filePath = path.join(BORGMATIC_D, safeFilename);
                        // Ensure final path is inside BORGMATIC_D
                        const resolved = path.resolve(filePath);
                        const root = path.resolve(BORGMATIC_D) + path.sep;
                        if (!resolved.startsWith(root)) {
                            throw new Error('Invalid backup filename (path traversal)');
                        }
                        await fs.writeFile(resolved, yaml.dump(backup.config, { noRefs: true, lineWidth: -1 }));
                    }
                    result.updated++;
                    result.preview.push({ type: 'backup', name: baseName, action: 'update' });
                }
            } else {
                let newName = baseName;
                let newFilename = safeFilename;
                if (existingNames.has(baseName) && mergeStrategy === 'rename') {
                    let counter = 2;
                    while (existingNames.has(`${baseName}-${counter}`)) {
                        counter++;
                    }
                    newName = `${baseName}-${counter}`;
                    newFilename = `${newName}.yaml`;
                }

                if (!dryRun) {
                    const filePath = path.join(BORGMATIC_D, newFilename);
                    const resolved = path.resolve(filePath);
                    const root = path.resolve(BORGMATIC_D) + path.sep;
                    if (!resolved.startsWith(root)) {
                        throw new Error('Invalid backup filename (path traversal)');
                    }
                    await fs.writeFile(resolved, yaml.dump(backup.config, { noRefs: true, lineWidth: -1 }));
                }
                result.created++;
                result.preview.push({ type: 'backup', name: newName, action: 'create' });
                existingNames.add(newName);
            }
        }
    } catch (error) {
        result.warnings.push(`Backup import error: ${error.message}`);
    }

    return result;
}

/**
 * Import schedules
 */
async function importSchedules(schedules, mergeStrategy, dryRun) {
    const result = { created: 0, updated: 0, skipped: 0, warnings: [], preview: [] };

    try {
        const existing = await scheduleManager.getAllSchedules();
        for (const schedule of schedules) {
            const dup = existing.find(s =>
                (s.id && schedule.id && s.id === schedule.id) ||
                (s.name === schedule.name && s.cron_expression === schedule.cron_expression)
            );

            if (dup && mergeStrategy === 'skip') {
                result.skipped++;
                result.preview.push({ type: 'schedule', name: schedule.name || dup.name || 'Schedule', action: 'skip', reason: 'Already exists' });
                continue;
            }

            if (dup && (mergeStrategy === 'update' || mergeStrategy === 'replace')) {
                if (!dryRun) {
                    await scheduleManager.updateSchedule(dup.id, {
                        name: schedule.name ?? dup.name,
                        description: schedule.description ?? dup.description,
                        cron_expression: schedule.cron_expression ?? dup.cron_expression,
                    });
                }
                result.updated++;
                result.preview.push({ type: 'schedule', name: schedule.name || dup.name || 'Schedule', action: 'update' });
                continue;
            }

            // rename strategy when name collides
            let newName = schedule.name || 'Imported Schedule';
            if (mergeStrategy === 'rename' && existing.some(s => s.name === newName)) {
                let counter = 2;
                while (existing.some(s => s.name === `${newName} (${counter})`)) counter++;
                newName = `${newName} (${counter})`;
            }

            if (!dryRun) {
                const created = await scheduleManager.createSchedule({
                    name: newName,
                    description: schedule.description || '',
                    cron_expression: schedule.cron_expression,
                    enabled: schedule.enabled,
                });
                existing.push(created);
            }
            result.created++;
            result.preview.push({ type: 'schedule', name: newName, action: 'create' });
        }
    } catch (error) {
        result.warnings.push(`Schedule import error: ${error.message}`);
    }

    return result;
}

/**
 * Import scripts
 */
async function importScripts(scripts, mergeStrategy, dryRun) {
    const result = { created: 0, updated: 0, skipped: 0, warnings: [], preview: [] };

    try {
        const existing = await scriptManager.loadConfig();
        const existingNames = new Set((existing.scripts || []).map(s => s.name));

        for (const script of scripts) {
            const name = script.name || 'Imported Script';
            const exists = existingNames.has(name);

            if (exists && mergeStrategy === 'skip') {
                result.skipped++;
                result.preview.push({ type: 'script', name, action: 'skip', reason: 'Already exists' });
                continue;
            }

            if (exists && (mergeStrategy === 'update' || mergeStrategy === 'replace')) {
                if (!dryRun) {
                    const found = (existing.scripts || []).find(s => s.name === name);
                    if (found) {
                        await scriptManager.updateScript(found.id, {
                            description: script.description,
                            category: script.category,
                            icon: script.icon,
                            hook_type: script.hook_type,
                            script: script.script,
                            timeout: script.timeout,
                            run_condition: script.run_condition,
                        });
                    }
                }
                result.updated++;
                result.preview.push({ type: 'script', name, action: 'update' });
                continue;
            }

            let newName = name;
            if (exists && mergeStrategy === 'rename') {
                let counter = 2;
                while (existingNames.has(`${name} (${counter})`)) counter++;
                newName = `${name} (${counter})`;
            }

            if (!dryRun) {
                await scriptManager.createScript({
                    name: newName,
                    description: script.description,
                    category: script.category,
                    icon: script.icon,
                    hook_type: script.hook_type,
                    script: script.script,
                    timeout: script.timeout,
                    run_condition: script.run_condition,
                });
                existingNames.add(newName);
            }

            result.created++;
            result.preview.push({ type: 'script', name: newName, action: 'create' });
        }
    } catch (error) {
        result.warnings.push(`Script import error: ${error.message}`);
    }

    return result;
}

/**
 * Import notification settings
 */
async function importNotificationSettings(settings) {
    try {
        await fs.ensureDir(path.dirname(APPRISE_CONFIG));
        await fs.writeFile(APPRISE_CONFIG, yaml.dump(settings));
    } catch (error) {
        console.warn('Error importing notification settings:', error.message);
    }
}

/**
 * Import system settings
 */
async function importSystemSettings(settings) {
    try {
        const cfg = await borgmaticConfig.loadConfig();
        cfg.system_settings = settings;
        await borgmaticConfig.saveConfig(cfg);
    } catch (error) {
        console.warn('Error importing system settings:', error.message);
    }
}

/**
 * Import SSH keys
 */
async function importSSHKeys(keys, mergeStrategy, dryRun) {
    const result = { warnings: [], preview: [] };

    try {
        const data = (await fs.pathExists(SSH_KEYS_YAML)) ? await yamlManager.readYaml(SSH_KEYS_YAML) : { ssh_keys: [] };
        const existingKeys = data.ssh_keys || [];
        const existingNames = new Set(existingKeys.map(k => k.name));

        for (const key of keys) {
            if (existingNames.has(key.name) && mergeStrategy === 'skip') {
                result.preview.push({ type: 'ssh_key', name: key.name, action: 'skip', reason: 'Already exists' });
                continue;
            }

            if (!dryRun) {
                const idx = existingKeys.findIndex(k => k.name === key.name);

                // If encrypted export provided plaintext private_key, re-encrypt for at-rest storage
                const record = {
                    id: key.id,
                    name: key.name,
                    description: key.description || null,
                    key_type: key.key_type,
                    public_key: key.public_key,
                    private_key: key.private_key ? encryptSSHSecret(key.private_key) : key.private_key,
                    is_encrypted: key.is_encrypted || false,
                    passphrase_encrypted: key.passphrase ? encryptSSHSecret(key.passphrase) : key.passphrase_encrypted || null,
                    is_active: key.is_active !== undefined ? key.is_active : true,
                    created_at: key.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };

                if (idx >= 0) {
                    existingKeys[idx] = record;
                } else {
                    existingKeys.push(record);
                }
            }
            result.preview.push({ type: 'ssh_key', name: key.name, action: existingNames.has(key.name) ? 'update' : 'create' });
        }

        if (!dryRun) {
            await yamlManager.writeYaml(SSH_KEYS_YAML, { ssh_keys: existingKeys });
        }

        result.warnings.push('SSH keys imported. You may need to re-check repository SSH key references.');
    } catch (error) {
        result.warnings.push(`SSH key import error: ${error.message}`);
    }

    return result;
}

module.exports = {
    exportConfiguration,
    importConfiguration,
};

