const yamlManager = require('./yaml-manager');
const path = require('path');
const config = require('../config');

/**
 * Borgmatic Configuration Service
 * Manages borgmatic YAML configurations with full feature support
 */
class BorgmaticConfigService {
    constructor() {
        this.configPath = config.borgmaticConfigPath;
        this.defaultConfig = this.getDefaultConfig();
    }

    /**
     * Get default borgmatic configuration template
     */
    getDefaultConfig() {
        return {
            location: {
                source_directories: [
                    '/home',
                    '/etc'
                ],
                repositories: [
                    {
                        path: './backups/borgmatic-repo',
                        encryption: 'repokey-blake2'
                    }
                ]
            },
            storage: {
                compression: 'zstd',
                encryption_passphrase: null, // Will be set during setup
                checkpoint_interval: 1800, // 30 minutes
                archive_name_format: '{hostname}-{now}',
                additional_borg_options: {
                    create: [],
                    prune: [],
                    compact: [],
                    check: []
                }
            },
            retention: {
                keep_daily: 7,
                keep_weekly: 4,
                keep_monthly: 6,
                keep_yearly: 1,
                keep_within: '2H', // Keep archives within last 2 hours
                prefix: '{hostname}-'
            },
            consistency: {
                checks: ['repository', 'archives'],
                check_last: 3,
                check_repositories: [],
                check_repo: true,
                check_archives: true,
                check_data: false,
                check_repodata: false
            },
            hooks: {
                before_backup: [],
                after_backup: [],
                on_error: [],
                before_prune: [],
                after_prune: [],
                before_check: [],
                after_check: [],
                before_compact: [],
                after_compact: []
            },
            monitoring: {
                apprise: {
                    urls: [],
                    send_logs: true,
                    log_bytes: 10000
                },
                healthchecks: {
                    ping_url: null,
                    send_logs: true,
                    log_bytes: 10000
                },
                cronitor: {
                    ping_url: null,
                    send_logs: true,
                    log_bytes: 10000
                },
                cronhub: {
                    ping_url: null,
                    send_logs: true,
                    log_bytes: 10000
                }
            },
            logs: {
                level: 'info',
                syslog: false,
                syslog_facility: 'LOG_USER',
                syslog_ident: 'borgmatic'
            },
            output: {
                verbosity: 1,
                progress: false,
                stats: false,
                json: false,
                list: false,
                files: false,
                show_rc: false
            },
            systemd: {
                systemd_creds_command: 'systemd-creds',
                encrypted_credentials_directory: '/etc/credstore.encrypted'
            },
            container: {
                secrets_directory: '/run/secrets'
            },
            keepassxc: {
                keepassxc_cli_command: 'keepassxc-cli'
            },
            postgresql_databases: [],
            mysql_databases: [],
            mongodb_databases: [],
            sqlite_databases: [],
            scheduled_jobs: []
        };
    }

    /**
     * Load borgmatic configuration
     */
    async loadConfig() {
        try {
            const config = await yamlManager.readYaml(this.configPath);
            return config || this.defaultConfig;
        } catch (error) {
            console.error('Failed to load borgmatic config:', error.message);
            return this.defaultConfig;
        }
    }

    /**
     * Save borgmatic configuration
     */
    async saveConfig(configData, createBackup = true) {
        try {
            // Validate configuration
            const validation = yamlManager.validateBorgmaticConfig(configData);
            if (!validation.isValid) {
                throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
            }

            // Save configuration
            await yamlManager.writeYaml(this.configPath, configData, createBackup);
            
            console.log('Borgmatic configuration saved successfully');
            return true;
        } catch (error) {
            console.error('Failed to save borgmatic config:', error.message);
            throw error;
        }
    }

    /**
     * Add repository to configuration
     */
    async addRepository(repositoryData) {
        try {
            console.log('📝 Adding repository:', repositoryData);
            const config = await this.loadConfig();
            console.log('📂 Current config loaded');
            
            if (!config.location) {
                config.location = {};
            }
            if (!config.location.repositories) {
                config.location.repositories = [];
            }

            // Validate repository data
            if (!repositoryData.path) {
                throw new Error('Repository path is required');
            }

            // Check for duplicate paths
            const existingRepo = config.location.repositories.find(repo => repo.path === repositoryData.path);
            if (existingRepo) {
                const existingLabel = existingRepo.label || 'Unnamed repository';
                throw new Error(`A repository named "${existingLabel}" already exists at this path. Please use a different path or delete the existing repository first.`);
            }

            // Add repository
            const newRepo = {
                path: repositoryData.path,
                label: repositoryData.label || null,
                append_only: repositoryData.append_only || false,
                storage_quota: repositoryData.storage_quota || null
            };

            // Set default encryption to repokey-blake2 if not specified
            if (repositoryData.encryption && repositoryData.encryption !== 'none') {
                newRepo.encryption = repositoryData.encryption;
            } else if (!repositoryData.encryption) {
                newRepo.encryption = 'repokey-blake2'; // Default to most secure option
            }

            console.log('✅ New repository object:', newRepo);
            config.location.repositories.push(newRepo);
            console.log('💾 Saving config...');

            await this.saveConfig(config);
            console.log('✅ Repository added successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to add repository:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    /**
     * Remove repository from configuration
     */
    async removeRepository(repositoryPath) {
        try {
            const config = await this.loadConfig();
            
            if (!config.location || !config.location.repositories) {
                return false;
            }

            const initialLength = config.location.repositories.length;
            config.location.repositories = config.location.repositories.filter(
                repo => repo.path !== repositoryPath
            );

            if (config.location.repositories.length === initialLength) {
                return false; // Repository not found
            }

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to remove repository:', error.message);
            throw error;
        }
    }

    /**
     * Get all repositories from configuration
     */
    async getRepositories() {
        try {
            const config = await this.loadConfig();
            
            if (!config.location || !config.location.repositories) {
                return [];
            }

            return config.location.repositories;
        } catch (error) {
            console.error('Failed to get repositories:', error.message);
            throw new Error('Failed to get repositories');
        }
    }

    /**
     * Toggle repository active status by commenting/uncommenting in YAML
     */
    async toggleRepositoryActive(repositoryPath, isActive) {
        try {
            const fs = require('fs-extra');
            const yamlText = await fs.readFile(this.configPath, 'utf8');
            const lines = yamlText.split('\n');
            
            // Find the repository block
            let repoStartIndex = -1;
            let repoEndIndex = -1;
            let inRepositories = false;
            let currentIndent = 0;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                // Check if we're in the repositories section
                if (trimmed === 'repositories:') {
                    inRepositories = true;
                    continue;
                }
                
                // Check for both commented and uncommented repository entries
                if (inRepositories && (trimmed.startsWith('- path:') || trimmed.startsWith('# - path:'))) {
                    // Extract path from this line (handle both commented and uncommented)
                    const pathMatch = line.match(/(?:#\s*)?-\s*path:\s*(.+)/);
                    const linePath = pathMatch ? pathMatch[1].trim() : '';
                    
                    if (linePath === repositoryPath) {
                        repoStartIndex = i;
                        currentIndent = line.match(/^\s*/)[0].length;
                        
                        // Find the end of this repository block
                        for (let j = i + 1; j < lines.length; j++) {
                            const nextLine = lines[j];
                            const nextTrimmed = nextLine.trim();
                            
                            // End of repository block if we hit another entry or lower indent
                            if (nextTrimmed.startsWith('- path:') || nextTrimmed.startsWith('# - path:')) {
                                repoEndIndex = j - 1;
                                break;
                            }
                            
                            // Check indent
                            const nextIndent = nextLine.match(/^\s*/)[0].length;
                            if (nextTrimmed && nextIndent <= currentIndent && !nextTrimmed.startsWith('#')) {
                                repoEndIndex = j - 1;
                                break;
                            }
                        }
                        
                        if (repoEndIndex === -1) {
                            repoEndIndex = lines.length - 1;
                        }
                        break;
                    }
                }
            }
            
            if (repoStartIndex === -1) {
                throw new Error('Repository not found in YAML');
            }
            
            // Comment or uncomment the repository block
            for (let i = repoStartIndex; i <= repoEndIndex; i++) {
                const line = lines[i];
                if (line.trim()) { // Only modify non-empty lines
                    if (isActive) {
                        // Uncomment: remove '# ' prefix (with space after #)
                        lines[i] = line.replace(/^(\s*)#\s/, '$1');
                    } else {
                        // Comment: add '# ' prefix if not already commented
                        if (!line.trim().startsWith('#')) {
                            lines[i] = line.replace(/^(\s*)/, '$1# ');
                        }
                    }
                }
            }
            
            // Write back
            await fs.writeFile(this.configPath, lines.join('\n'), 'utf8');
            return true;
        } catch (error) {
            console.error('Failed to toggle repository status:', error.message);
            throw error;
        }
    }

    /**
     * Get all repositories including their active status
     */
    async getRepositoriesWithStatus() {
        try {
            const fs = require('fs-extra');
            const yamlText = await fs.readFile(this.configPath, 'utf8');
            const lines = yamlText.split('\n');
            
            const repositories = [];
            let inRepositories = false;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                if (trimmed === 'repositories:') {
                    inRepositories = true;
                    continue;
                }
                
                if (inRepositories && (trimmed.startsWith('- path:') || trimmed.startsWith('#  - path:') || trimmed.startsWith('# - path:'))) {
                    const isActive = !trimmed.startsWith('#');
                    const pathMatch = trimmed.match(/(?:#\s*)?-\s*path:\s*(.+)/);
                    
                    if (pathMatch) {
                        const repoPath = pathMatch[1].trim();
                        
                        // Extract other properties from following lines
                        let label = null;
                        let encryption = null;
                        
                        for (let j = i + 1; j < lines.length; j++) {
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith('- path:') || nextLine.startsWith('#  - path:') || nextLine.startsWith('# - path:')) {
                                break;
                            }
                            
                            const labelMatch = nextLine.match(/(?:#\s*)?label:\s*(.+)/);
                            const encryptionMatch = nextLine.match(/(?:#\s*)?encryption:\s*(.+)/);
                            
                            if (labelMatch) label = labelMatch[1].trim();
                            if (encryptionMatch) encryption = encryptionMatch[1].trim();
                        }
                        
                        repositories.push({
                            path: repoPath,
                            label,
                            encryption: encryption || 'none',
                            is_active: isActive
                        });
                    }
                }
            }
            
            return repositories;
        } catch (error) {
            console.error('Failed to get repositories with status:', error.message);
            throw error;
        }
    }

    /**
     * Update repository configuration
     */
    async updateRepository(repositoryPath, updates) {
        try {
            const config = await this.loadConfig();
            
            if (!config.location || !config.location.repositories) {
                throw new Error('No repositories configured');
            }

            const repoIndex = config.location.repositories.findIndex(repo => repo.path === repositoryPath);
            if (repoIndex === -1) {
                throw new Error('Repository not found');
            }

            // Update repository
            config.location.repositories[repoIndex] = {
                ...config.location.repositories[repoIndex],
                ...updates
            };

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update repository:', error.message);
            throw error;
        }
    }

    /**
     * Add source directory
     */
    async addSourceDirectory(directory) {
        try {
            const config = await this.loadConfig();
            
            if (!config.location) {
                config.location = {};
            }
            if (!config.location.source_directories) {
                config.location.source_directories = [];
            }

            // Check for duplicates
            if (config.location.source_directories.includes(directory)) {
                throw new Error('Source directory already exists');
            }

            config.location.source_directories.push(directory);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add source directory:', error.message);
            throw error;
        }
    }

    /**
     * Remove source directory
     */
    async removeSourceDirectory(directory) {
        try {
            const config = await this.loadConfig();
            
            if (!config.location || !config.location.source_directories) {
                return false;
            }

            const initialLength = config.location.source_directories.length;
            config.location.source_directories = config.location.source_directories.filter(
                dir => dir !== directory
            );

            if (config.location.source_directories.length === initialLength) {
                return false; // Directory not found
            }

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to remove source directory:', error.message);
            throw error;
        }
    }

    /**
     * Update storage configuration
     */
    async updateStorage(storageConfig) {
        try {
            const config = await this.loadConfig();
            
            config.storage = {
                ...config.storage,
                ...storageConfig
            };

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update storage config:', error.message);
            throw error;
        }
    }

    /**
     * Update retention policy
     */
    async updateRetention(retentionConfig) {
        try {
            const config = await this.loadConfig();
            
            config.retention = {
                ...config.retention,
                ...retentionConfig
            };

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update retention config:', error.message);
            throw error;
        }
    }

    /**
     * Add Apprise notification
     */
    async addAppriseNotification(appriseConfig) {
        try {
            const config = await this.loadConfig();
            
            if (!config.hooks) {
                config.hooks = {};
            }

            // Add Apprise notification to appropriate hooks
            if (appriseConfig.on_success && appriseConfig.success_url) {
                if (!config.hooks.after_backup) {
                    config.hooks.after_backup = [];
                }
                config.hooks.after_backup.push(`apprise -vv -t "Backup Success" -b "Backup completed successfully" ${appriseConfig.success_url}`);
            }

            if (appriseConfig.on_failure && appriseConfig.failure_url) {
                if (!config.hooks.on_error) {
                    config.hooks.on_error = [];
                }
                config.hooks.on_error.push(`apprise -vv -t "Backup Failed" -b "Backup failed with error" ${appriseConfig.failure_url}`);
            }

            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add Apprise notification:', error.message);
            throw error;
        }
    }

    /**
     * Add custom hook
     */
    async addHook(hookType, command) {
        try {
            const config = await this.loadConfig();
            
            if (!config.hooks) {
                config.hooks = {};
            }
            if (!config.hooks[hookType]) {
                config.hooks[hookType] = [];
            }

            config.hooks[hookType].push(command);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add hook:', error.message);
            throw error;
        }
    }

    /**
     * Get configuration summary
     */
    async getConfigSummary() {
        try {
            const config = await this.loadConfig();
            
            return {
                source_directories: config.location?.source_directories || [],
                repositories: config.location?.repositories || [],
                storage: config.storage || {},
                retention: config.retention || {},
                hooks: config.hooks || {},
                consistency: config.consistency || {}
            };
        } catch (error) {
            console.error('Failed to get config summary:', error.message);
            return null;
        }
    }

    /**
     * Validate configuration
     */
    async validateConfig() {
        try {
            const config = await this.loadConfig();
            return yamlManager.validateBorgmaticConfig(config);
        } catch (error) {
            return {
                errors: [error.message],
                warnings: [],
                isValid: false
            };
        }
    }

    /**
     * Get backup history
     */
    async getBackupHistory() {
        try {
            return await yamlManager.getBackupInfo(this.configPath);
        } catch (error) {
            console.error('Failed to get backup history:', error.message);
            return [];
        }
    }

    /**
     * Restore from backup
     */
    async restoreFromBackup(backupName) {
        try {
            return await yamlManager.restoreFromBackup(this.configPath, backupName);
        } catch (error) {
            console.error('Failed to restore from backup:', error.message);
            throw error;
        }
    }

    /**
     * Update monitoring configuration
     */
    async updateMonitoring(monitoringConfig) {
        try {
            const config = await this.loadConfig();
            config.monitoring = { ...config.monitoring, ...monitoringConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update monitoring config:', error.message);
            throw error;
        }
    }

    /**
     * Update logs configuration
     */
    async updateLogs(logsConfig) {
        try {
            const config = await this.loadConfig();
            config.logs = { ...config.logs, ...logsConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update logs config:', error.message);
            throw error;
        }
    }

    /**
     * Update output configuration
     */
    async updateOutput(outputConfig) {
        try {
            const config = await this.loadConfig();
            config.output = { ...config.output, ...outputConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update output config:', error.message);
            throw error;
        }
    }

    /**
     * Add PostgreSQL database
     */
    async addPostgresqlDatabase(databaseConfig) {
        try {
            const config = await this.loadConfig();
            if (!config.postgresql_databases) {
                config.postgresql_databases = [];
            }
            config.postgresql_databases.push(databaseConfig);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add PostgreSQL database:', error.message);
            throw error;
        }
    }

    /**
     * Add MySQL database
     */
    async addMysqlDatabase(databaseConfig) {
        try {
            const config = await this.loadConfig();
            if (!config.mysql_databases) {
                config.mysql_databases = [];
            }
            config.mysql_databases.push(databaseConfig);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add MySQL database:', error.message);
            throw error;
        }
    }

    /**
     * Add MongoDB database
     */
    async addMongodbDatabase(databaseConfig) {
        try {
            const config = await this.loadConfig();
            if (!config.mongodb_databases) {
                config.mongodb_databases = [];
            }
            config.mongodb_databases.push(databaseConfig);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add MongoDB database:', error.message);
            throw error;
        }
    }

    /**
     * Add SQLite database
     */
    async addSqliteDatabase(databaseConfig) {
        try {
            const config = await this.loadConfig();
            if (!config.sqlite_databases) {
                config.sqlite_databases = [];
            }
            config.sqlite_databases.push(databaseConfig);
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to add SQLite database:', error.message);
            throw error;
        }
    }

    /**
     * Update systemd configuration
     */
    async updateSystemd(systemdConfig) {
        try {
            const config = await this.loadConfig();
            config.systemd = { ...config.systemd, ...systemdConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update systemd config:', error.message);
            throw error;
        }
    }

    /**
     * Update container configuration
     */
    async updateContainer(containerConfig) {
        try {
            const config = await this.loadConfig();
            config.container = { ...config.container, ...containerConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update container config:', error.message);
            throw error;
        }
    }

    /**
     * Update KeePassXC configuration
     */
    async updateKeepassxc(keepassxcConfig) {
        try {
            const config = await this.loadConfig();
            config.keepassxc = { ...config.keepassxc, ...keepassxcConfig };
            await this.saveConfig(config);
            return true;
        } catch (error) {
            console.error('Failed to update KeePassXC config:', error.message);
            throw error;
        }
    }

    /**
     * Get all scheduled jobs
     */
    async getScheduledJobs() {
        const config = await this.getConfig();
        return config.scheduled_jobs || [];
    }

    /**
     * Add a scheduled job
     */
    async addScheduledJob(jobData) {
        const config = await this.getConfig();
        if (!config.scheduled_jobs) {
            config.scheduled_jobs = [];
        }
        config.scheduled_jobs.push(jobData);
        await this.saveConfig(config);
        return jobData;
    }

    /**
     * Update a scheduled job
     */
    async updateScheduledJob(jobId, jobData) {
        const config = await this.getConfig();
        const jobs = config.scheduled_jobs || [];
        const jobIndex = jobs.findIndex(job => job.id === jobId);
        
        if (jobIndex === -1) {
            throw new Error('Scheduled job not found');
        }
        
        jobs[jobIndex] = { ...jobs[jobIndex], ...jobData };
        config.scheduled_jobs = jobs;
        await this.saveConfig(config);
        return jobs[jobIndex];
    }

    /**
     * Delete a scheduled job
     */
    async deleteScheduledJob(jobId) {
        const config = await this.getConfig();
        const jobs = config.scheduled_jobs || [];
        const jobIndex = jobs.findIndex(job => job.id === jobId);
        
        if (jobIndex === -1) {
            throw new Error('Scheduled job not found');
        }
        
        jobs.splice(jobIndex, 1);
        config.scheduled_jobs = jobs;
        await this.saveConfig(config);
        return true;
    }
}

module.exports = new BorgmaticConfigService();
