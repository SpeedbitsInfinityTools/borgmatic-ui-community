const { execa } = require('execa');
const path = require('path');
const config = require('../config');
const { getBorgPath, getBorgCommand, getDefaultEncryption, BORG1_PATH, BORG2_PATH } = require('./borg-version-detector');

/**
 * Borgmatic CLI Service
 * Executes borgmatic commands with proper error handling and JSON output
 * Based on: https://torsion.org/borgmatic/docs/reference/command-line/
 * 
 * Supports both Borg 1.x and Borg 2.x via version-specific binaries.
 */
class BorgmaticCLI {
    constructor() {
        // Timeout in milliseconds (config is in seconds, default 1 hour)
        this.timeout = (config.backupTimeout || 3600) * 1000;
        this.borgmaticPath = 'borgmatic';
        
        // Borg binary paths for version-specific operations
        this.borg1Path = BORG1_PATH;
        this.borg2Path = BORG2_PATH;
    }

    /**
     * Get the Borg binary path for a specific version
     * @param {string} version - '1.x' or '2.x'
     * @returns {string}
     */
    getBorgBinary(version) {
        return getBorgPath(version);
    }

    /**
     * Add logging options to command arguments
     */
    addLoggingOptions(args, options = {}) {
        // Add verbosity level (-2, -1, 0, 1, 2)
        if (options.verbosity !== undefined) {
            args.push('--verbosity', options.verbosity.toString());
        }

        // Add syslog verbosity
        if (options.syslog_verbosity !== undefined) {
            args.push('--syslog-verbosity', options.syslog_verbosity.toString());
        }

        // Add log file options
        if (options.log_file) {
            args.push('--log-file', options.log_file);
        }

        if (options.log_file_verbosity !== undefined) {
            args.push('--log-file-verbosity', options.log_file_verbosity.toString());
        }

        if (options.log_file_format) {
            args.push('--log-file-format', options.log_file_format);
        }
    }

    /**
     * Execute borgmatic command with proper error handling
     */
    async executeCommand(args, options = {}) {
        try {
            const commandArgs = [this.borgmaticPath, ...args];
            
            const execOptions = {
                timeout: options.timeout || this.timeout,
                cwd: options.cwd || process.cwd(),
                env: {
                    ...process.env,
                    ...options.env
                }
            };

            // Only log non-silent commands (version checks are too noisy for health checks)
            if (!options.silent) {
                console.log(`Executing: ${commandArgs.join(' ')}`);
            }
            
            const { stdout, stderr } = await execa(commandArgs[0], commandArgs.slice(1), execOptions);
            
            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command: commandArgs.join(' ')
            };
        } catch (error) {
            console.error('Borgmatic command failed:', error.message);
            return {
                success: false,
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || '',
                command: `${this.borgmaticPath} ${args.join(' ')}`
            };
        }
    }

    /**
     * Backup Operations
     */

    /**
     * Create a backup (borgmatic create)
     * borgmatic create --verbosity 1 --stats --progress
     */
    async createBackup(options = {}) {
        const args = ['create'];

        // Add logging options
        this.addLoggingOptions(args, options);

        // Add stats flag (default to true for backup summary)
        if (options.stats !== false) {
            args.push('--stats');
        }

        // Add progress flag (default to true for file progress)
        if (options.progress !== false) {
            args.push('--progress');
        }

        // Add list/files flag for detailed output
        if (options.list) {
            args.push('--list');
        }

        // Add JSON output
        if (options.json) {
            args.push('--json');
        }

        // Add repository filter
        if (options.repository) {
            args.push('--repository', options.repository);
        }

        // Add comment
        if (options.comment) {
            args.push('--comment', options.comment);
        }

        // Add dry run
        if (options.dry_run) {
            args.push('--dry-run');
        }

        // Set up environment for passphrase
        const envOptions = {
            env: {
                ...process.env
            }
        };

        if (options.passphrase) {
            envOptions.env.BORG_PASSPHRASE = options.passphrase;
        }

        return await this.executeCommand(args, envOptions);
    }

    /**
     * Repository Management Commands
     */

    /**
     * Create a new, empty Borg repository
     * Uses borg repo-create (Borg 2.0+) or borg init (Borg 1.x) based on version
     * 
     * @param {string} repositoryPath - Path to the repository
     * @param {string} encryption - Encryption mode
     * @param {Object} options - Additional options
     * @param {string} options.borgVersion - '1.x' or '2.x' (default: '2.x')
     */
    async createRepository(repositoryPath, encryption, options = {}) {
        try {
            const borgVersion = options.borgVersion || '2.x';
            const borgPath = this.getBorgBinary(borgVersion);
            
            // Use version-appropriate default encryption if not specified
            const finalEncryption = encryption || getDefaultEncryption(borgVersion);
            
            // Get version-appropriate command
            const extraArgs = ['--encryption', finalEncryption];
            
            if (options.sourceRepository) {
                // If this is an upgrade from 1.2 to 2.0, we need the source repository
                // to reuse key material and ensure deduplication works.
                extraArgs.push('--source-repository', options.sourceRepository);
            }

            const { command, args } = getBorgCommand(borgVersion, 'init', {
                repoPath: repositoryPath,
                extraArgs: extraArgs,
            });

            // Add make-parent-dirs if requested (Borg 1.x only - not supported in Borg 2.x)
            if (options.makeParentDirs && borgVersion === '1.x') {
                args.push('--make-parent-dirs');
            }
            
            console.log(`Executing: ${command} ${args.join(' ')}`);
            
            const execOptions = {
                timeout: options.timeout || 30000, // 30 seconds
                cwd: options.cwd || process.cwd(),
                env: {
                    ...process.env,
                    BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: 'yes',
                    BORG_RELOCATED_REPO_ACCESS_IS_OK: 'yes',
                    ...options.env
                }
            };

            // Add passphrase if provided
            if (options.passphrase) {
                execOptions.env.BORG_PASSPHRASE = options.passphrase;
            }

            const { stdout, stderr } = await execa(command, args, execOptions);
            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command: `${command} ${args.join(' ')}`,
                borgVersion: borgVersion,
            };
        } catch (error) {
            console.error('Borg repo-create/init failed:', error.message);
            return {
                success: false,
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || '',
                command: `borg create repository at ${repositoryPath}`,
            };
        }
    }

    /**
     * Delete an entire repository
     * borgmatic repo-delete --repository /path/to/repo
     */
    async deleteRepository(repositoryPath, options = {}) {
        const args = [
            'repo-delete',
            '--repository', repositoryPath
        ];

        if (options.force) {
            args.push('--force');
        }

        if (options.cacheOnly) {
            args.push('--cache-only');
        }

        if (options.keepSecurityInfo) {
            args.push('--keep-security-info');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * List repository contents
     * borgmatic repo-list --repository /path/to/repo
     */
    async listRepository(repositoryPath, options = {}) {
        const args = [
            'repo-list',
            '--repository', repositoryPath
        ];

        if (options.json) {
            args.push('--json');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Show repository summary information
     * borgmatic repo-info --repository /path/to/repo
     */
    async getRepositoryInfo(repositoryPath, options = {}) {
        // Use 'repo-info' for repository-level info (modern borgmatic syntax)
        const args = [
            'repo-info',
            '--repository', repositoryPath
        ];

        if (options.json) {
            args.push('--json');
        }

        // Set up environment with passphrase if provided
        const envOptions = { ...options };
        if (options.passphrase) {
            envOptions.env = {
                ...(options.env || {}),
                BORG_PASSPHRASE: options.passphrase
            };
        }

        return await this.executeCommand(args, envOptions);
    }

    /**
     * Check repository for consistency
     * Uses borg check directly with version-appropriate syntax
     * 
     * @param {string} repositoryPath - Path to the repository
     * @param {Object} options - Additional options
     * @param {string} options.borgVersion - '1.x' or '2.x' (default: '2.x')
     */
    async checkRepository(repositoryPath, options = {}) {
        try {
            const borgVersion = options.borgVersion || '2.x';
            const extraArgs = [];
            
            if (options.repair) {
                extraArgs.push('--repair');
            }
            
            if (options.verifyData) {
                extraArgs.push('--verify-data');
            }
            
            if (options.maxDuration) {
                extraArgs.push('--max-duration', options.maxDuration.toString());
            }
            
            if (options.only) {
                extraArgs.push('--only', options.only);
            }
            
            if (options.force) {
                extraArgs.push('--force');
            }
            
            const { command, args } = getBorgCommand(borgVersion, 'check', {
                repoPath: repositoryPath,
                extraArgs,
                remotePath: options.remotePath, // For Hetzner Storage Boxes
            });

            const execOptions = {
                timeout: options.timeout || this.timeout,
                cwd: options.cwd || process.cwd(),
                env: {
                    ...process.env,
                    BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: 'yes',
                    BORG_RELOCATED_REPO_ACCESS_IS_OK: 'yes',
                    ...options.env
                }
            };

            if (options.passphrase) {
                execOptions.env.BORG_PASSPHRASE = options.passphrase;
            }

            console.log(`Executing: ${command} ${args.join(' ')}`);
            
            const { stdout, stderr } = await execa(command, args, execOptions);
            
            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command: `${command} ${args.join(' ')}`,
                borgVersion,
            };
        } catch (error) {
            console.error('Borg check command failed:', error.message);
            return {
                success: false,
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || '',
            };
        }
    }

    /**
     * Archive Management Commands
     */

    /**
     * Create an archive (perform backup)
     * borgmatic create --repository /path/to/repo
     */
    async createArchive(repositoryPath, options = {}) {
        const args = [
            'create',
            '--repository', repositoryPath
        ];

        if (options.progress) {
            args.push('--progress');
        }

        if (options.stats) {
            args.push('--stats');
        }

        if (options.list) {
            args.push('--list');
        }

        if (options.json) {
            args.push('--json');
        }

        if (options.comment) {
            args.push('--comment', options.comment);
        }

        return await this.executeCommand(args, options);
    }

    /**
     * List archives in repository
     * borgmatic list --repository /path/to/repo
     */
    async listArchives(repositoryPath, options = {}) {
        const args = [
            'list',
            '--repository', repositoryPath
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        }

        if (options.path) {
            args.push('--path', options.path);
        }

        if (options.find) {
            args.push('--find', options.find);
        }

        if (options.short) {
            args.push('--short');
        }

        if (options.format) {
            args.push('--format', options.format);
        }

        if (options.json) {
            args.push('--json');
        }

        if (options.prefix) {
            args.push('-P', options.prefix);
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.sortBy) {
            args.push('--sort-by', options.sortBy);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        if (options.exclude) {
            args.push('-e', options.exclude);
        }

        return await this.executeCommand(args, options);
    }

    /**
     * List contents of a specific archive
     * borgmatic list --repository /path/to/repo --archive archive-name --path /subpath
     */
    async listArchiveContents(repositoryPath, archiveName, path = '', options = {}) {
        const args = [
            'list',
            '--repository', repositoryPath,
            '--archive', archiveName
        ];

        if (path) {
            args.push('--path', path);
        }

        if (options.find) {
            args.push('--find', options.find);
        }

        if (options.short) {
            args.push('--short');
        }

        if (options.format) {
            args.push('--format', options.format);
        }

        if (options.json) {
            args.push('--json');
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.sortBy) {
            args.push('--sort-by', options.sortBy);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        if (options.exclude) {
            args.push('-e', options.exclude);
        }

        if (options.excludeFrom) {
            args.push('--exclude-from', options.excludeFrom);
        }

        if (options.patterns) {
            args.push('--pattern', options.patterns);
        }

        if (options.patternsFrom) {
            args.push('--patterns-from', options.patternsFrom);
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Show archive information
     * borgmatic info --repository /path/to/repo --archive archive_name
     */
    async getArchiveInfo(repositoryPath, archiveName, options = {}) {
        const args = [
            'info',
            '--repository', repositoryPath,
            '--archive', archiveName
        ];

        if (options.json) {
            args.push('--json');
        }

        if (options.prefix) {
            args.push('-P', options.prefix);
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.sortBy) {
            args.push('--sort-by', options.sortBy);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Delete archive from repository
     * borgmatic delete --repository /path/to/repo --archive archive_name
     */
    async deleteArchive(repositoryPath, archiveName, options = {}) {
        const args = [
            'delete',
            '--repository', repositoryPath,
            '--archive', archiveName
        ];

        if (options.list) {
            args.push('--list');
        }

        if (options.stats) {
            args.push('--stats');
        }

        if (options.cacheOnly) {
            args.push('--cache-only');
        }

        if (options.force) {
            args.push('--force');
        }

        if (options.keepSecurityInfo) {
            args.push('--keep-security-info');
        }

        if (options.saveSpace) {
            args.push('--save-space');
        }

        if (options.checkpointInterval) {
            args.push('--checkpoint-interval', options.checkpointInterval.toString());
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Extract files from archive
     * borgmatic extract --repository /path/to/repo --archive archive_name --destination /path/to/dest
     */
    async extractArchive(repositoryPath, archiveName, destinationPath, options = {}) {
        const args = ['extract'];

        // Add repository if provided
        if (repositoryPath) {
            args.push('--repository', repositoryPath);
        }

        // Add archive (required)
        args.push('--archive', archiveName);

        // Add destination if provided
        if (destinationPath) {
            args.push('--destination', destinationPath);
        }

        // Add multiple paths if provided
        if (options.paths && Array.isArray(options.paths)) {
            for (const path of options.paths) {
                args.push('--path', path);
            }
        } else if (options.path) {
            args.push('--path', options.path);
        }

        if (options.stripComponents) {
            args.push('--strip-components', options.stripComponents.toString());
        }

        if (options.progress) {
            args.push('--progress');
        }

        if (options.dryRun) {
            args.push('--dry-run');
        }

        if (options.verbosity !== undefined) {
            args.push('--verbosity', options.verbosity.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Mount archive as FUSE filesystem
     * borgmatic mount --repository /path/to/repo --mount-point /path/to/mount
     */
    async mountArchive(repositoryPath, mountPoint, options = {}) {
        const args = [
            'mount',
            '--repository', repositoryPath,
            '--mount-point', mountPoint
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        }

        if (options.path) {
            args.push('--path', options.path);
        }

        if (options.foreground) {
            args.push('--foreground');
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Unmount FUSE filesystem
     * borgmatic umount --mount-point /path/to/mount
     */
    async unmountArchive(mountPoint, options = {}) {
        const args = [
            'umount',
            '--mount-point', mountPoint
        ];

        return await this.executeCommand(args, options);
    }

    /**
     * Key Management Commands
     */

    /**
     * Export repository key
     * borgmatic key export --repository /path/to/repo --path /path/to/key
     */
    async exportKey(repositoryPath, keyPath, options = {}) {
        const args = [
            'key', 'export',
            '--repository', repositoryPath,
            '--path', keyPath
        ];

        if (options.paper) {
            args.push('--paper');
        }

        if (options.qrHtml) {
            args.push('--qr-html');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Import repository key
     * borgmatic key import --repository /path/to/repo --path /path/to/key
     */
    async importKey(repositoryPath, keyPath, options = {}) {
        const args = [
            'key', 'import',
            '--repository', repositoryPath,
            '--path', keyPath
        ];

        if (options.paper) {
            args.push('--paper');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Change repository key passphrase
     * borgmatic key change-passphrase --repository /path/to/repo
     */
    async changeKeyPassphrase(repositoryPath, options = {}) {
        const args = [
            'key', 'change-passphrase',
            '--repository', repositoryPath
        ];

        return await this.executeCommand(args, options);
    }

    /**
     * Utility Commands
     */

    /**
     * Break repository locks
     * borgmatic break-lock --repository /path/to/repo
     */
    async breakLock(repositoryPath, options = {}) {
        const args = [
            'break-lock',
            '--repository', repositoryPath
        ];

        return await this.executeCommand(args, options);
    }

    /**
     * Check archives for consistency
     * borgmatic check --repository /path/to/repo
     */
    async checkArchives(repositoryPath, options = {}) {
        const args = [
            'check',
            '--repository', repositoryPath
        ];

        // Add logging options
        this.addLoggingOptions(args, options);

        if (options.progress) {
            args.push('--progress');
        }

        if (options.repair) {
            args.push('--repair');
        }

        if (options.maxDuration) {
            args.push('--max-duration', options.maxDuration.toString());
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.only) {
            args.push('--only', options.only);
        }

        if (options.force) {
            args.push('--force');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Prune archives according to retention policy
     * borgmatic prune --repository /path/to/repo
     */
    async pruneArchives(repositoryPath, options = {}) {
        const args = [
            'prune',
            '--repository', repositoryPath
        ];

        // Add logging options
        this.addLoggingOptions(args, options);

        if (options.stats) {
            args.push('--stats');
        }

        if (options.list) {
            args.push('--list');
        }

        if (options.json) {
            args.push('--json');
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.oldest) {
            args.push('--oldest', options.oldest);
        }

        if (options.newest) {
            args.push('--newest', options.newest);
        }

        if (options.older) {
            args.push('--older', options.older);
        }

        if (options.newer) {
            args.push('--newer', options.newer);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        // Retention flags (borg/borgmatic prune)
        // We accept snake_case from frontend to keep payloads consistent.
        if (options.keep_daily !== undefined) {
            args.push('--keep-daily', options.keep_daily.toString());
        }
        if (options.keep_weekly !== undefined) {
            args.push('--keep-weekly', options.keep_weekly.toString());
        }
        if (options.keep_monthly !== undefined) {
            args.push('--keep-monthly', options.keep_monthly.toString());
        }
        if (options.keep_yearly !== undefined) {
            args.push('--keep-yearly', options.keep_yearly.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Compact repository to free space
     * Uses direct borg compact command for version-specific handling
     * 
     * @param {string} repositoryPath - Path to the repository
     * @param {Object} options - Additional options
     * @param {string} options.borgVersion - '1.x' or '2.x' (default: '2.x')
     * @param {string} options.remotePath - Remote borg binary path (for Hetzner)
     */
    async compactRepository(repositoryPath, options = {}) {
        try {
            const borgVersion = options.borgVersion || '2.x';
            const extraArgs = [];
            
            if (options.progress) {
                extraArgs.push('--progress');
            }
            
            if (options.threshold) {
                extraArgs.push('--threshold', options.threshold.toString());
            }
            
            const { command, args } = getBorgCommand(borgVersion, 'compact', {
                repoPath: repositoryPath,
                extraArgs,
                remotePath: options.remotePath, // For Hetzner Storage Boxes
            });

            const execOptions = {
                timeout: options.timeout || this.timeout,
                cwd: options.cwd || process.cwd(),
                env: {
                    ...process.env,
                    BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: 'yes',
                    BORG_RELOCATED_REPO_ACCESS_IS_OK: 'yes',
                    ...options.env
                }
            };

            if (options.passphrase) {
                execOptions.env.BORG_PASSPHRASE = options.passphrase;
            }

            console.log(`Executing: ${command} ${args.join(' ')}`);
            
            const { stdout, stderr } = await execa(command, args, execOptions);
            
            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command: `${command} ${args.join(' ')}`,
                borgVersion,
            };
        } catch (error) {
            console.error('Borg compact failed:', error.message);
            return {
                success: false,
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || '',
                command: `borg compact ${repositoryPath}`,
            };
        }
    }

    /**
     * Transfer archives between repositories
     * borgmatic transfer --source-repository /path/to/source --repository /path/to/dest
     */
    async transferArchives(sourceRepository, destinationRepository, options = {}) {
        const args = [
            'transfer',
            '--source-repository', sourceRepository,
            '--repository', destinationRepository
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        }

        if (options.upgrader) {
            args.push('--upgrader', options.upgrader);
        }

        if (options.progress) {
            args.push('--progress');
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.sortBy) {
            args.push('--sort-by', options.sortBy);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Extract configuration files from archive
     * borgmatic config bootstrap --repository /path/to/repo --archive archive_name --destination /path/to/dest
     */
    async configBootstrap(repositoryPath, options = {}) {
        const args = [
            'config',
            'bootstrap',
            '--repository', repositoryPath
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        }

        if (options.destination) {
            args.push('--destination', options.destination);
        }

        if (options.verbosity !== undefined) {
            args.push('--verbosity', options.verbosity.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Export archive as tar file
     * borgmatic export-tar --repository /path/to/repo --archive archive_name --destination /path/to/tar
     */
    async exportTar(repositoryPath, archiveName, destinationPath, options = {}) {
        const args = [
            'export-tar',
            '--repository', repositoryPath,
            '--archive', archiveName,
            '--destination', destinationPath
        ];

        if (options.path) {
            args.push('--path', options.path);
        }

        if (options.tarFilter) {
            args.push('--tar-filter', options.tarFilter);
        }

        if (options.list) {
            args.push('--list');
        }

        if (options.stripComponents) {
            args.push('--strip-components', options.stripComponents.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Get borgmatic version
     */
    async getVersion() {
        return await this.executeCommand(['--version']);
    }

    /**
     * Restore data source dumps from archive
     * borgmatic restore --repository /path/to/repo --archive archive_name
     */
    async restoreData(repositoryPath, archiveName, options = {}) {
        const args = [
            'restore',
            '--repository', repositoryPath,
            '--archive', archiveName
        ];

        if (options.progress) {
            args.push('--progress');
        }

        if (options.stats) {
            args.push('--stats');
        }

        if (options.list) {
            args.push('--list');
        }

        if (options.json) {
            args.push('--json');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Recreate archive
     * borgmatic recreate --repository /path/to/repo --archive archive_name
     */
    async recreateArchive(repositoryPath, archiveName, options = {}) {
        const args = [
            'recreate',
            '--repository', repositoryPath,
            '--archive', archiveName
        ];

        if (options.progress) {
            args.push('--progress');
        }

        if (options.stats) {
            args.push('--stats');
        }

        if (options.list) {
            args.push('--list');
        }

        if (options.json) {
            args.push('--json');
        }

        if (options.pattern) {
            args.push('-a', options.pattern);
        }

        if (options.sortBy) {
            args.push('--sort-by', options.sortBy);
        }

        if (options.first) {
            args.push('--first', options.first.toString());
        }

        if (options.last) {
            args.push('--last', options.last.toString());
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Run arbitrary Borg commands
     * borgmatic borg --repository /path/to/repo --archive archive_name -- borg_command
     */
    async runBorgCommand(repositoryPath, borgCommand, options = {}) {
        const args = [
            'borg',
            '--repository', repositoryPath
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        }

        // Add the borg command after --
        args.push('--', ...borgCommand.split(' '));

        return await this.executeCommand(args, options);
    }

    /**
     * Configuration management
     * borgmatic config bootstrap/generate/validate
     */
    async configCommand(action, options = {}) {
        const args = ['config', action];

        if (action === 'bootstrap' && options.repository) {
            args.push('--repository', options.repository);
        }

        if (action === 'generate' && options.source) {
            args.push('-s', options.source);
        }

        if (action === 'validate' && options.skip) {
            args.push('-s');
        }

        return await this.executeCommand(args, options);
    }

    /**
     * Serve repository via SSH
     * borgmatic serve --repository /path/to/repo
     */
    async serveRepository(repositoryPath, options = {}) {
        const args = ['serve', '--repository', repositoryPath];
        
        if (options.append_only) {
            args.push('--append-only');
        }
        
        if (options.restrict_to_path) {
            args.push('--restrict-to-path', options.restrict_to_path);
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Upgrade repository format
     * borgmatic upgrade --repository /path/to/repo
     */
    async upgradeRepository(repositoryPath, options = {}) {
        const args = ['upgrade', '--repository', repositoryPath];
        
        if (options.dry_run) {
            args.push('--dry-run');
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Debug repository
     * borgmatic debug --repository /path/to/repo
     */
    async debugRepository(repositoryPath, options = {}) {
        const args = ['debug', '--repository', repositoryPath];
        
        if (options.dump_debug_info) {
            args.push('--dump-debug-info');
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Get repository info
     * borgmatic info --repository /path/to/repo
     */
    async getRepositoryInfo(repositoryPath, options = {}) {
        const args = ['info', '--repository', repositoryPath];
        
        if (options.json) {
            args.push('--json');
        }
        
        if (options.archive) {
            args.push('--archive', options.archive);
        }
        
        // Set up environment with passphrase if provided
        const envOptions = { ...options };
        if (options.passphrase) {
            envOptions.env = {
                ...(options.env || {}),
                BORG_PASSPHRASE: options.passphrase
            };
        }
        
        return await this.executeCommand(args, envOptions);
    }

    /**
     * List database dumps in an archive
     * borgmatic list --archive latest --find *borgmatic/*_databases
     */
    async listDatabaseDumps(repositoryPath, options = {}) {
        const args = [
            'list',
            '--repository', repositoryPath
        ];

        if (options.archive) {
            args.push('--archive', options.archive);
        } else {
            args.push('--archive', 'latest');
        }

        // Find database dump files
        args.push('--find', '*borgmatic/*_databases');

        if (options.json) {
            args.push('--json');
        }

        if (options.format) {
            args.push('--format', options.format);
        }

        return await this.executeCommand(args, options);
    }

    /**
     * List repository contents
     * borgmatic list --repository /path/to/repo
     */
    async listRepositoryContents(repositoryPath, options = {}) {
        const args = ['list', '--repository', repositoryPath];
        
        if (options.archive) {
            args.push('--archive', options.archive);
        }
        
        if (options.path) {
            args.push('--path', options.path);
        }
        
        if (options.find) {
            args.push('--find', options.find);
        }
        
        if (options.short) {
            args.push('--short');
        }
        
        if (options.format) {
            args.push('--format', options.format);
        }
        
        if (options.json) {
            args.push('--json');
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Mount repository
     * borgmatic mount --repository /path/to/repo --mount-point /mount/point
     */
    async mountRepository(repositoryPath, mountPoint, options = {}) {
        const args = [
            'mount',
            '--repository', repositoryPath,
            '--mount-point', mountPoint
        ];
        
        if (options.archive) {
            args.push('--archive', options.archive);
        }
        
        if (options.path) {
            args.push('--path', options.path);
        }
        
        if (options.foreground) {
            args.push('--foreground');
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Unmount repository
     * borgmatic umount --mount-point /mount/point
     */
    async unmountRepository(mountPoint, options = {}) {
        const args = ['umount', '--mount-point', mountPoint];
        return await this.executeCommand(args, options);
    }

    /**
     * Export repository key
     * borgmatic key export --repository /path/to/repo
     */
    async exportRepositoryKey(repositoryPath, options = {}) {
        const args = ['key', 'export', '--repository', repositoryPath];
        
        if (options.paper) {
            args.push('--paper');
        }
        
        if (options.qr_html) {
            args.push('--qr-html');
        }
        
        if (options.path) {
            args.push('--path', options.path);
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Import repository key
     * borgmatic key import --repository /path/to/repo
     */
    async importRepositoryKey(repositoryPath, options = {}) {
        const args = ['key', 'import', '--repository', repositoryPath];
        
        if (options.paper) {
            args.push('--paper');
        }
        
        if (options.path) {
            args.push('--path', options.path);
        }
        
        return await this.executeCommand(args, options);
    }

    /**
     * Change repository key passphrase
     * borgmatic key change-passphrase --repository /path/to/repo
     */
    async changeRepositoryKeyPassphrase(repositoryPath, options = {}) {
        const args = ['key', 'change-passphrase', '--repository', repositoryPath];
        return await this.executeCommand(args, options);
    }

    /**
     * Break repository lock
     * borgmatic break-lock --repository /path/to/repo
     */
    async breakRepositoryLock(repositoryPath, options = {}) {
        const args = ['break-lock', '--repository', repositoryPath];
        return await this.executeCommand(args, options);
    }


    /**
     * Get borgmatic help
     */
    async getHelp(command = null) {
        const args = command ? [command, '--help'] : ['--help'];
        return await this.executeCommand(args);
    }
}

module.exports = new BorgmaticCLI();
