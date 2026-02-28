const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config');

/**
 * Normalize path for comparison - avoids path.normalize for URLs
 * path.normalize mangles URLs (e.g., ssh://host//path becomes ssh:/host/path)
 * which breaks Borg 2.x absolute paths and other URL-based repositories
 * @param {string} p - Path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(p) {
    if (!p) return p;
    // Don't normalize URLs - they have special syntax (e.g., // for absolute paths in Borg 2.x)
    if (p.startsWith('ssh://') || p.startsWith('s3:') || p.startsWith('rclone:')) {
        return p;
    }
    return path.normalize(p);
}

/**
 * Multi-Config Parser Service
 * Reads and parses all YAML configuration files from borgmatic.d/ directory
 */
class ConfigParser {
    constructor() {
        this.configDir = path.join(config.configDir, 'borgmatic.d');
        this.unusedReposPath = path.join(config.configDir, 'repositories-unused.yaml');
        this.parsedConfigs = [];
        this.unusedRepositories = [];
        this.lastParsed = null;
    }

    /**
     * Parse all configuration files in borgmatic.d/
     * @returns {Promise<Object>} Parsed configurations
     */
    async parseAllConfigs() {
        console.log(`📂 Parsing config files from: ${this.configDir}`);
        const startTime = Date.now();

        try {
            // Ensure directories exist
            await fs.ensureDir(this.configDir);

            // Read all YAML files from borgmatic.d/
            const files = await fs.readdir(this.configDir);
            const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

            console.log(`   Found ${yamlFiles.length} config file(s)`);

            // Parse each YAML file
            this.parsedConfigs = [];
            for (const file of yamlFiles) {
                const filePath = path.join(this.configDir, file);
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const parsed = yaml.load(content);

                    this.parsedConfigs.push({
                        filename: file,
                        path: filePath,
                        name: path.basename(file, path.extname(file)), // backup-name without extension
                        config: parsed,
                        repositories: this.extractRepositories(parsed),
                        sourceDirectories: this.extractSourceDirectories(parsed),
                        schedule: this.extractSchedule(parsed)
                    });

                    console.log(`   ✓ Parsed: ${file}`);
                } catch (error) {
                    console.error(`   ✗ Error parsing ${file}:`, error.message);
                }
            }

            // Parse unused repositories
            await this.parseUnusedRepositories();

            this.lastParsed = new Date();
            const duration = Date.now() - startTime;

            console.log(`✅ Config parsing complete in ${duration}ms`);

            return {
                success: true,
                configs: this.parsedConfigs,
                unusedRepositories: this.unusedRepositories,
                totalConfigs: this.parsedConfigs.length,
                totalUnusedRepos: this.unusedRepositories.length,
                lastParsed: this.lastParsed,
                duration
            };

        } catch (error) {
            console.error('❌ Error parsing configs:', error);
            throw error;
        }
    }

    /**
     * Parse unused repositories YAML
     */
    async parseUnusedRepositories() {
        try {
            if (await fs.pathExists(this.unusedReposPath)) {
                const content = await fs.readFile(this.unusedReposPath, 'utf8');
                const parsed = yaml.load(content);
                this.unusedRepositories = parsed?.repositories || [];
                console.log(`   ℹ️  Found ${this.unusedRepositories.length} unused repository(ies)`);
            } else {
                // Create the file if it doesn't exist
                await fs.writeFile(this.unusedReposPath, yaml.dump({ repositories: [] }));
                this.unusedRepositories = [];
            }
        } catch (error) {
            console.error('   ✗ Error parsing unused repositories:', error.message);
            this.unusedRepositories = [];
        }
    }

    /**
     * Extract repositories from a config
     * Handles both new flat format and deprecated sectioned format
     */
    extractRepositories(config) {
        if (!config) return [];

        // Try flat format first (new borgmatic 1.8+ format)
        if (config.repositories) {
            return config.repositories;
        }

        // Fallback to location.repositories (deprecated sectioned format)
        if (config.location?.repositories) {
            return config.location.repositories;
        }

        return [];
    }

    /**
     * Extract source directories from a config
     * Handles both new flat format and deprecated sectioned format
     */
    extractSourceDirectories(config) {
        if (!config) return [];

        // Try flat format first (new borgmatic 1.8+ format)
        if (config.source_directories) {
            return config.source_directories;
        }

        // Fallback to location.source_directories (deprecated sectioned format)
        if (config.location?.source_directories) {
            return config.location.source_directories;
        }

        return [];
    }

    /**
     * Extract schedule information from config filename or config
     * This is a placeholder - actual schedule comes from cron
     */
    extractSchedule(config) {
        // Could extract from hooks or other metadata
        return null;
    }

    /**
     * Get all repositories with their usage status
     * @returns {Promise<Array>} Array of repositories with usage info
     */
    async getAllRepositoriesWithUsage() {
        if (!this.lastParsed) {
            await this.parseAllConfigs();
        }

        const allRepos = [];
        const repoUsageMap = new Map(); // normalized path -> array of backup names

        // Build usage map from active configs (normalize paths for consistency)
        for (const configData of this.parsedConfigs) {
            for (const repo of configData.repositories) {
                const normalizedPath = normalizePath(repo.path);
                if (!repoUsageMap.has(normalizedPath)) {
                    repoUsageMap.set(normalizedPath, []);
                }
                repoUsageMap.get(normalizedPath).push(configData.name);
            }
        }

        // Build a map of unused repositories by path for quick lookup
        const unusedRepoMap = new Map();
        for (const repo of this.unusedRepositories) {
            unusedRepoMap.set(normalizePath(repo.path), repo);
        }

        // Process used repositories
        const usedRepoPaths = new Set();
        for (const configData of this.parsedConfigs) {
            for (const repo of configData.repositories) {
                const normalizedPath = normalizePath(repo.path);
                if (usedRepoPaths.has(normalizedPath)) continue; // Already added

                // Merge with unused repo data if it exists (for name, label, etc.)
                const unusedData = unusedRepoMap.get(normalizedPath);

                usedRepoPaths.add(normalizedPath);

                // Check if this repository was discovered externally (not in unused repos)
                const isDiscovered = !unusedData;
                const defaultName = isDiscovered ? 'Discovered automatically - not named yet' : null;

                allRepos.push({
                    ...repo,
                    // Merge name, label, encryption, compression and type-specific fields from unused repos if available
                    name: unusedData?.name || repo.name || defaultName,
                    label: unusedData?.label || repo.label || defaultName || path.basename(repo.path),
                    encryption: unusedData?.encryption || repo.encryption,
                    compression: unusedData?.compression || repo.compression,
                    repository_type: unusedData?.repository_type || repo.repository_type,
                    read_only: unusedData?.read_only ?? repo.read_only ?? false,
                    rclone_remote: unusedData?.rclone_remote || repo.rclone_remote,
                    rclone_path: unusedData?.rclone_path || repo.rclone_path,
                    // SSH/SFTP fields - critical for authentication during backups
                    host: unusedData?.host || repo.host,
                    port: unusedData?.port || repo.port,
                    username: unusedData?.username || repo.username,
                    ssh_key_id: unusedData?.ssh_key_id ?? repo.ssh_key_id,
                    ssh_auth_method: unusedData?.ssh_auth_method || repo.ssh_auth_method,
                    // S3 fields
                    s3_endpoint: unusedData?.s3_endpoint || repo.s3_endpoint,
                    s3_bucket: unusedData?.s3_bucket || repo.s3_bucket,
                    s3_path: unusedData?.s3_path || repo.s3_path,
                    s3_region: unusedData?.s3_region || repo.s3_region,
                    // Borg version
                    borg_version: unusedData?.borg_version || repo.borg_version,
                    isUsed: true,
                    usedInBackups: repoUsageMap.get(normalizedPath) || [],
                    isDiscovered: isDiscovered // Flag to indicate this was discovered externally
                });
            }
        }

        // Add unused repositories (skip if already in used list)
        for (const repo of this.unusedRepositories) {
            const normalizedPath = normalizePath(repo.path);
            // Check if this path is already in the used repositories (using normalized path)
            if (!usedRepoPaths.has(normalizedPath)) {
                allRepos.push({
                    ...repo,
                    isUsed: false,
                    usedInBackups: [],
                    label: repo.label || repo.name || path.basename(repo.path),
                    isDiscovered: false // Unused repos are created through UI, not discovered
                });
            }
        }

        return allRepos;
    }

    /**
     * Check if a repository path is already in use (including unused list)
     * @param {string} repoPath - Repository path to check
     * @param {string} repoType - Repository type (local, ssh, etc.)
     * @returns {Promise<boolean>}
     */
    async isRepositoryDuplicate(repoPath, repoType) {
        if (!this.lastParsed) {
            await this.parseAllConfigs();
        }

        // Normalize path for comparison (URL-safe)
        const normalizedPath = normalizePath(repoPath);

        // Check in active configs
        for (const configData of this.parsedConfigs) {
            for (const repo of configData.repositories) {
                if (normalizePath(repo.path) === normalizedPath) {
                    return true;
                }
            }
        }

        // Check in unused repositories
        for (const repo of this.unusedRepositories) {
            if (normalizePath(repo.path) === normalizedPath) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get backups that use a specific repository
     * @param {string} repoPath - Repository path
     * @returns {Promise<Array>} Array of backup names
     */
    async getBackupsUsingRepository(repoPath) {
        if (!this.lastParsed) {
            await this.parseAllConfigs();
        }

        const normalizedPath = normalizePath(repoPath);
        const backupNames = [];

        for (const configData of this.parsedConfigs) {
            for (const repo of configData.repositories) {
                if (normalizePath(repo.path) === normalizedPath) {
                    backupNames.push(configData.name);
                    break;
                }
            }
        }

        return backupNames;
    }

    /**
     * Add a new repository to the unused list
     * @param {Object} repoData - Repository data
     */
    async addUnusedRepository(repoData) {
        // Check for duplicates first
        if (await this.isRepositoryDuplicate(repoData.path, repoData.repository_type)) {
            throw new Error('Repository with this path already exists');
        }

        // Add to unused list (preserve all fields including type-specific ones)
        const repoEntry = {
            name: repoData.name,
            path: repoData.path,
            label: repoData.name,
            encryption: repoData.encryption,
            compression: repoData.compression,
            repository_type: repoData.repository_type,
            created_at: new Date().toISOString()
        };

        // Add type-specific fields if present
        if (repoData.rclone_remote) repoEntry.rclone_remote = repoData.rclone_remote;
        if (repoData.rclone_path !== undefined) repoEntry.rclone_path = repoData.rclone_path;
        if (repoData.storage_mode) repoEntry.storage_mode = repoData.storage_mode;
        if (repoData.local_path) repoEntry.local_path = repoData.local_path;
        if (repoData.mount_path) repoEntry.mount_path = repoData.mount_path;
        if (repoData.id) repoEntry.id = repoData.id;
        // Read-only mode (monitor only - no backups allowed)
        if (repoData.read_only !== undefined) repoEntry.read_only = repoData.read_only;
        // SSH/SFTP fields
        if (repoData.host) repoEntry.host = repoData.host;
        if (repoData.port) repoEntry.port = repoData.port;
        if (repoData.username) repoEntry.username = repoData.username;
        if (repoData.ssh_key_id !== undefined) repoEntry.ssh_key_id = repoData.ssh_key_id;
        if (repoData.ssh_auth_method) repoEntry.ssh_auth_method = repoData.ssh_auth_method;
        // S3 fields
        if (repoData.s3_endpoint) repoEntry.s3_endpoint = repoData.s3_endpoint;
        if (repoData.s3_bucket) repoEntry.s3_bucket = repoData.s3_bucket;
        if (repoData.s3_path) repoEntry.s3_path = repoData.s3_path;
        if (repoData.s3_region) repoEntry.s3_region = repoData.s3_region;
        // Borg version (1.x or 2.x) - critical for choosing correct binary
        if (repoData.borg_version) repoEntry.borg_version = repoData.borg_version;
        // Optional borgmatic log file path for backups using this repository
        if (repoData.log_file_path) repoEntry.log_file_path = repoData.log_file_path;

        this.unusedRepositories.push(repoEntry);

        // Save to file
        await fs.writeFile(
            this.unusedReposPath,
            yaml.dump({ repositories: this.unusedRepositories }, { indent: 2 })
        );

        console.log(`✓ Added unused repository: ${repoData.name}`);
    }

    /**
     * Remove a repository from the unused list
     * @param {string} repoPath - Repository path
     */
    async removeUnusedRepository(repoPath) {
        const normalizedPath = normalizePath(repoPath);
        const initialLength = this.unusedRepositories.length;

        this.unusedRepositories = this.unusedRepositories.filter(
            repo => normalizePath(repo.path) !== normalizedPath
        );

        if (this.unusedRepositories.length < initialLength) {
            await fs.writeFile(
                this.unusedReposPath,
                yaml.dump({ repositories: this.unusedRepositories }, { indent: 2 })
            );
            console.log(`✓ Removed unused repository: ${repoPath}`);
            return true;
        }

        return false;
    }

    /**
     * Get current parsed state without re-parsing
     */
    getCurrentState() {
        return {
            configs: this.parsedConfigs,
            unusedRepositories: this.unusedRepositories,
            lastParsed: this.lastParsed,
            totalConfigs: this.parsedConfigs.length,
            totalUnusedRepos: this.unusedRepositories.length
        };
    }

    /**
     * Force refresh all configs
     */
    async refresh() {
        console.log('🔄 Refreshing configuration...');
        return await this.parseAllConfigs();
    }

    /**
     * Get all unused repositories
     * @returns {Array} Array of unused repository objects
     */
    async getUnusedRepositories() {
        // Ensure we have the latest data
        if (!this.lastParsed) {
            await this.parseAllConfigs();
        }
        return this.unusedRepositories || [];
    }

    /**
     * Save unused repositories to file
     * @param {Array} repositories - Array of repository objects
     */
    async saveUnusedRepositories(repositories) {
        this.unusedRepositories = repositories;
        await fs.writeFile(
            this.unusedReposPath,
            yaml.dump({ repositories: this.unusedRepositories }, { indent: 2 })
        );
        console.log(`✓ Saved ${repositories.length} unused repositories`);
    }

    /**
     * Remove a repository from all backup configs that reference it
     * @param {string} repoPath - Repository path to remove
     * @returns {Promise<Object>} Result with affected backups and deleted configs
     */
    async removeRepositoryFromBackups(repoPath) {
        const normalizedPath = normalizePath(repoPath);
        const result = {
            affectedBackups: [],
            deletedBackups: [],
            errors: []
        };

        // Make sure we have the latest configs
        if (!this.lastParsed) {
            await this.parseAllConfigs();
        }

        // Find all config files that reference this repository
        for (const configData of this.parsedConfigs) {
            const hasRepo = configData.repositories.some(
                repo => normalizePath(repo.path) === normalizedPath
            );

            if (!hasRepo) continue;

            const filePath = configData.path;
            const backupName = configData.name;

            try {
                // Read the current config file
                const content = await fs.readFile(filePath, 'utf8');
                const parsed = yaml.load(content);

                if (!parsed) {
                    result.errors.push(`${backupName}: Invalid config structure`);
                    continue;
                }

                // Handle both flat format (new) and sectioned format (deprecated)
                const usesNewFormat = !!parsed.repositories;
                const usesOldFormat = !!parsed.location?.repositories;

                if (!usesNewFormat && !usesOldFormat) {
                    result.errors.push(`${backupName}: No repositories found in config`);
                    continue;
                }

                // Get the repositories array reference
                const reposArray = usesNewFormat ? parsed.repositories : parsed.location.repositories;
                const originalCount = reposArray.length;

                // Filter out the repository
                const filteredRepos = reposArray.filter(repo => {
                    const repoPathValue = typeof repo === 'string' ? repo : repo.path;
                    return normalizePath(repoPathValue) !== normalizedPath;
                });

                const newCount = filteredRepos.length;

                if (newCount === 0) {
                    // No repositories left - delete the backup config entirely
                    await fs.remove(filePath);
                    result.deletedBackups.push(backupName);
                    console.log(`🗑️  Deleted backup config with no repositories: ${backupName}`);
                } else if (newCount < originalCount) {
                    // Update the appropriate field
                    if (usesNewFormat) {
                        parsed.repositories = filteredRepos;
                    } else {
                        parsed.location.repositories = filteredRepos;
                    }
                    // Still has some repositories - update the config
                    await fs.writeFile(filePath, yaml.dump(parsed, { indent: 2 }));
                    result.affectedBackups.push(backupName);
                    console.log(`✏️  Removed repository from backup config: ${backupName}`);
                }
            } catch (error) {
                result.errors.push(`${backupName}: ${error.message}`);
                console.error(`❌ Error updating backup config ${backupName}:`, error.message);
            }
        }

        // Refresh to update in-memory state
        if (result.affectedBackups.length > 0 || result.deletedBackups.length > 0) {
            await this.refresh();
        }

        return result;
    }
}

// Export singleton instance
module.exports = new ConfigParser();
