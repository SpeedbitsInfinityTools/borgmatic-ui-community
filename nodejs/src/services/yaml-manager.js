const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('../config');

/**
 * YAML Manager with Concurrency Control and Backup Rotation
 * Handles all YAML file operations with atomic writes and backup management
 */
class YamlManager extends EventEmitter {
    constructor() {
        super();
        this.fileLocks = new Map();
        this.cache = new Map();
        this.watchers = new Map();
        this.backupDir = path.join(config.configDir, 'backups');
    }

    /**
     * Acquire a file lock for concurrent operations
     */
    async acquireLock(filePath) {
        const normalizedPath = path.resolve(filePath);
        
        if (this.fileLocks.has(normalizedPath)) {
            // Wait for existing lock to be released
            return new Promise((resolve) => {
                const checkLock = () => {
                    if (!this.fileLocks.has(normalizedPath)) {
                        this.fileLocks.set(normalizedPath, true);
                        resolve();
                    } else {
                        setTimeout(checkLock, 10);
                    }
                };
                checkLock();
            });
        }
        
        this.fileLocks.set(normalizedPath, true);
    }

    /**
     * Release a file lock
     */
    releaseLock(filePath) {
        const normalizedPath = path.resolve(filePath);
        this.fileLocks.delete(normalizedPath);
    }

    /**
     * Create backup of YAML file before modification
     */
    async createBackup(filePath) {
        try {
            await fs.ensureDir(this.backupDir);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = path.basename(filePath);
            const backupPath = path.join(this.backupDir, `${fileName}.${timestamp}`);
            
            // Create backup
            await fs.copy(filePath, backupPath);
            
            // Rotate backups (keep only 3 versions)
            await this.rotateBackups(fileName);
            
            this.emit('backup-created', { filePath, backupPath });
            return backupPath;
        } catch (error) {
            this.emit('backup-error', { filePath, error: error.message });
            throw error;
        }
    }

    /**
     * Rotate backups to keep only 3 versions
     */
    async rotateBackups(fileName) {
        try {
            const backupFiles = await fs.readdir(this.backupDir);
            const fileBackups = backupFiles
                .filter(file => file.startsWith(fileName) && file !== fileName)
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    stats: fs.statSync(path.join(this.backupDir, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

            // Keep only 3 most recent backups
            if (fileBackups.length > 3) {
                const toDelete = fileBackups.slice(3);
                for (const file of toDelete) {
                    await fs.remove(file.path);
                    this.emit('backup-rotated', { filePath: file.path });
                }
            }
        } catch (error) {
            this.emit('backup-rotation-error', { error: error.message });
        }
    }

    /**
     * Read YAML file with caching
     */
    async readYaml(filePath, useCache = true) {
        const normalizedPath = path.resolve(filePath);
        
        // Check cache first
        if (useCache && this.cache.has(normalizedPath)) {
            const cached = this.cache.get(normalizedPath);
            if (cached.timestamp > (await fs.stat(normalizedPath)).mtime) {
                return cached.data;
            }
        }

        try {
            await this.acquireLock(normalizedPath);
            
            if (!await fs.pathExists(normalizedPath)) {
                return null;
            }

            const content = await fs.readFile(normalizedPath, 'utf8');
            const data = yaml.load(content);
            
            // Update cache
            if (useCache) {
                this.cache.set(normalizedPath, {
                    data,
                    timestamp: Date.now()
                });
            }
            
            this.emit('yaml-read', { filePath: normalizedPath });
            return data;
        } catch (error) {
            this.emit('yaml-read-error', { filePath: normalizedPath, error: error.message });
            throw error;
        } finally {
            this.releaseLock(normalizedPath);
        }
    }

    /**
     * Write YAML file with atomic operation
     */
    async writeYaml(filePath, data, createBackup = true) {
        const normalizedPath = path.resolve(filePath);
        const tempPath = `${normalizedPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;
        
        try {
            await this.acquireLock(normalizedPath);
            
            // Create backup if requested and file exists
            if (createBackup && await fs.pathExists(normalizedPath)) {
                await this.createBackup(normalizedPath);
            }
            
            // Ensure directory exists
            await fs.ensureDir(path.dirname(normalizedPath));
            
            // Write to temporary file first
            const yamlContent = yaml.dump(data, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
                sortKeys: false
            });
            
            await fs.writeFile(tempPath, yamlContent, 'utf8');
            
            // Atomic move (rename) to final location
            await fs.move(tempPath, normalizedPath, { overwrite: true });
            
            // Update cache
            this.cache.set(normalizedPath, {
                data,
                timestamp: Date.now()
            });
            
            this.emit('yaml-written', { filePath: normalizedPath });
            return true;
        } catch (error) {
            // Clean up temp file on error
            if (await fs.pathExists(tempPath)) {
                await fs.remove(tempPath);
            }
            
            this.emit('yaml-write-error', { filePath: normalizedPath, error: error.message });
            throw error;
        } finally {
            this.releaseLock(normalizedPath);
        }
    }

    /**
     * Update specific section in YAML file
     */
    async updateYamlSection(filePath, section, data, createBackup = true) {
        const normalizedPath = path.resolve(filePath);
        
        try {
            // Read existing data
            const existingData = await this.readYaml(normalizedPath) || {};
            
            // Update specific section
            existingData[section] = data;
            
            // Write back
            await this.writeYaml(normalizedPath, existingData, createBackup);
            
            this.emit('yaml-section-updated', { filePath: normalizedPath, section });
            return true;
        } catch (error) {
            this.emit('yaml-section-update-error', { filePath: normalizedPath, section, error: error.message });
            throw error;
        }
    }

    /**
     * Validate YAML structure against borgmatic schema
     */
    validateBorgmaticConfig(config) {
        const errors = [];
        const warnings = [];

        // Support both old format (top-level) and new format (nested under location)
        const sourceDirectories = config.location?.source_directories || config.source_directories;
        const repositories = config.location?.repositories || config.repositories;

        // Required sections
        if (!sourceDirectories || !Array.isArray(sourceDirectories)) {
            errors.push('source_directories is required and must be an array');
        }

        if (!repositories || !Array.isArray(repositories)) {
            errors.push('repositories is required and must be an array');
        }

        // Validate repositories
        if (repositories) {
            repositories.forEach((repo, index) => {
                if (!repo.path) {
                    errors.push(`Repository ${index + 1} must have a path`);
                }
            });
        }

        // Validate storage section
        if (config.storage) {
            if (config.storage.encryption_passphrase && config.storage.encryption_passphrase.length < 8) {
                warnings.push('encryption_passphrase should be at least 8 characters');
            }
        }

        // Validate retention
        if (config.retention) {
            const retentionKeys = Object.keys(config.retention);
            if (retentionKeys.length === 0) {
                warnings.push('retention section is empty, backups will never be pruned');
            }
        }

        return { errors, warnings, isValid: errors.length === 0 };
    }

    /**
     * Watch YAML file for changes
     */
    watchYaml(filePath, callback) {
        const normalizedPath = path.resolve(filePath);
        
        if (this.watchers.has(normalizedPath)) {
            return; // Already watching
        }

        const watcher = fs.watch(normalizedPath, async (eventType) => {
            if (eventType === 'change') {
                // Clear cache
                this.cache.delete(normalizedPath);
                
                try {
                    const data = await this.readYaml(normalizedPath, false);
                    callback(null, data);
                } catch (error) {
                    callback(error, null);
                }
            }
        });

        this.watchers.set(normalizedPath, watcher);
    }

    /**
     * Stop watching YAML file
     */
    unwatchYaml(filePath) {
        const normalizedPath = path.resolve(filePath);
        const watcher = this.watchers.get(normalizedPath);
        
        if (watcher) {
            watcher.close();
            this.watchers.delete(normalizedPath);
        }
    }

    /**
     * Get backup information
     */
    async getBackupInfo(filePath) {
        try {
            const fileName = path.basename(filePath);
            const backupFiles = await fs.readdir(this.backupDir);
            const fileBackups = backupFiles
                .filter(file => file.startsWith(fileName) && file !== fileName)
                .map(file => {
                    const stats = fs.statSync(path.join(this.backupDir, file));
                    return {
                        name: file,
                        path: path.join(this.backupDir, file),
                        size: stats.size,
                        created: stats.mtime
                    };
                })
                .sort((a, b) => b.created - a.created);

            return fileBackups;
        } catch (error) {
            return [];
        }
    }

    /**
     * Restore from backup
     */
    async restoreFromBackup(filePath, backupName) {
        const normalizedPath = path.resolve(filePath);
        const backupPath = path.join(this.backupDir, backupName);
        
        try {
            if (!await fs.pathExists(backupPath)) {
                throw new Error(`Backup file not found: ${backupName}`);
            }

            await this.acquireLock(normalizedPath);
            await fs.copy(backupPath, normalizedPath);
            
            // Clear cache
            this.cache.delete(normalizedPath);
            
            this.emit('yaml-restored', { filePath: normalizedPath, backupName });
            return true;
        } catch (error) {
            this.emit('yaml-restore-error', { filePath: normalizedPath, backupName, error: error.message });
            throw error;
        } finally {
            this.releaseLock(normalizedPath);
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Close all watchers
        for (const [filePath, watcher] of this.watchers) {
            watcher.close();
        }
        this.watchers.clear();
        
        // Clear cache
        this.cache.clear();
        
        // Release all locks
        this.fileLocks.clear();
    }
}

module.exports = new YamlManager();
