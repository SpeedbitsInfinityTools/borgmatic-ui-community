const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const borgmaticCLI = require('../services/borgmatic-cli');
const borgmaticConfig = require('../services/borgmatic-config');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const config = require('../config');
const multer = require('multer');
const { execa } = require('execa');
const yaml = require('js-yaml');
const configParser = require('../services/config-parser');
const backupManager = require('../services/backup-manager');

// Configure multer for file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

/**
 * Get system metrics
 */
async function getSystemMetrics() {
    try {
        // CPU usage (simplified - in production, use a proper CPU monitoring library)
        const cpus = os.cpus();
        const cpuUsage = cpus.reduce((acc, cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const idle = cpu.times.idle;
            return acc + (1 - idle / total);
        }, 0) / cpus.length * 100;

        // Memory usage
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memoryUsage = (usedMem / totalMem) * 100;

        // Disk usage - use execa to get disk info
        let diskUsage = 0;
        let diskTotal = 0;
        let diskFree = 0;
        try {
            const { execa } = require('execa');
            const result = await execa('df', ['-h', '/'], { timeout: 5000 });
            const lines = result.stdout.split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                if (parts.length >= 4) {
                    diskTotal = parseFloat(parts[1]) || 0;
                    diskFree = parseFloat(parts[3]) || 0;
                    diskUsage = ((diskTotal - diskFree) / diskTotal) * 100;
                }
            }
        } catch (error) {
            console.warn('Could not get disk usage:', error.message);
            // Fallback to basic calculation
            diskUsage = 0;
            diskTotal = 0;
            diskFree = 0;
        }

        // System uptime
        const uptime = Math.floor(os.uptime());

        return {
            cpu_usage: Math.round(cpuUsage * 100) / 100,
            memory_usage: Math.round(memoryUsage * 100) / 100,
            memory_total: totalMem,
            memory_available: freeMem,
            disk_usage: diskUsage,
            disk_total: diskTotal,
            disk_free: diskFree,
            uptime: uptime
        };
    } catch (error) {
        console.error('Failed to get system metrics:', error.message);
        throw new Error('Failed to get system metrics');
    }
}

/**
 * Get backup status for all repositories
 */
async function getBackupStatus() {
    try {
        const repositories = await borgmaticConfig.getRepositories();
        const statusList = [];

        for (const repo of repositories) {
            try {
                // Get repository info
                const repoInfo = await borgmaticCLI.getRepositoryInfo(repo.path);

                statusList.push({
                    repository: repo.label || repo.path,
                    status: repoInfo.success ? 'healthy' : 'error',
                    last_backup: 'Unknown', // Would need to parse from borg list
                    archive_count: 0, // Would need to parse from borg list
                    total_size: 'Unknown', // Would need to parse from borg info
                    health: repoInfo.success ? 'healthy' : 'error'
                });
            } catch (error) {
                console.warn(`Failed to get status for repository ${repo.path}:`, error.message);
                statusList.push({
                    repository: repo.label || repo.path,
                    status: 'error',
                    last_backup: 'Never',
                    archive_count: 0,
                    total_size: '0',
                    health: 'error'
                });
            }
        }

        return statusList;
    } catch (error) {
        console.error('Failed to get backup status:', error.message);
        return [];
    }
}

/**
 * Get scheduled jobs information
 */
async function getScheduledJobs() {
    try {
        // TODO: Implement when cron job management is added
        // For now, return empty array
        return [];
    } catch (error) {
        console.error('Failed to get scheduled jobs:', error.message);
        return [];
    }
}

/**
 * Get recent backup jobs
 */
async function getRecentJobs(limit = 10) {
    try {
        // TODO: Implement when job tracking is added
        // For now, return empty array
        return [];
    } catch (error) {
        console.error('Failed to get recent jobs:', error.message);
        return [];
    }
}

/**
 * Get system alerts
 */
async function getAlerts(hours = 24) {
    try {
        // TODO: Implement when alert system is added
        // For now, return empty array
        return [];
    } catch (error) {
        console.error('Failed to get alerts:', error.message);
        return [];
    }
}

/**
 * Get comprehensive dashboard status
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        // Get backup status
        const backupStatus = await getBackupStatus();

        // Get system metrics
        const systemMetrics = await getSystemMetrics();

        // Get scheduled jobs
        const scheduledJobs = await getScheduledJobs();

        // Get recent jobs
        const recentJobs = await getRecentJobs();

        // Get alerts
        const alerts = await getAlerts();

        res.json({
            success: true,
            data: {
                backup_status: backupStatus,
                system_metrics: systemMetrics,
                scheduled_jobs: scheduledJobs,
                recent_jobs: recentJobs,
                alerts: alerts,
                last_updated: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error getting dashboard status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get dashboard status'
        });
    }
});

/**
 * Get system metrics for dashboard
 */
router.get('/metrics', authenticateToken, async (req, res) => {
    try {
        const metrics = await getSystemMetrics();

        // Get network I/O (simplified)
        const networkIO = {
            bytes_sent: 0, // Would need proper network monitoring
            bytes_recv: 0,
            packets_sent: 0,
            packets_recv: 0
        };

        // Get load average
        const loadAverage = os.loadavg();

        res.json({
            success: true,
            data: {
                cpu_usage: metrics.cpu_usage,
                memory_usage: metrics.memory_usage,
                disk_usage: metrics.disk_usage,
                network_io: networkIO,
                load_average: loadAverage
            }
        });
    } catch (error) {
        console.error('Error getting metrics:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get metrics'
        });
    }
});

/**
 * Get scheduled jobs information
 */
router.get('/schedule', authenticateToken, async (req, res) => {
    try {
        const jobs = await getScheduledJobs();

        // Find next execution time
        let nextExecution = null;
        if (jobs.length > 0) {
            // This is a simplified approach - in a real implementation,
            // you'd use a proper cron parser to calculate next execution
            nextExecution = new Date().toISOString();
        }

        res.json({
            success: true,
            data: {
                jobs: jobs,
                next_execution: nextExecution
            }
        });
    } catch (error) {
        console.error('Error getting schedule:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get schedule'
        });
    }
});

/**
 * Get SECRET_KEY for display (used for backup/restore)
 */
router.get('/secret-key', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Deprecated: prefer downloading the persisted .secret_key file instead of showing the key in JSON.
        // Kept for backwards compatibility with older UI versions.
        const secretKey = config.secretKey;
        if (!secretKey) {
            return res.status(500).json({
                success: false,
                detail: 'SECRET_KEY is not configured'
            });
        }

        res.json({
            success: true,
            data: {
                secret_key: secretKey,
                warning: 'Keep this key safe! It is required to decrypt the vault. Prefer downloading /api/dashboard/vault-master-key.'
            }
        });
    } catch (error) {
        console.error('Error getting secret key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get secret key'
        });
    }
});

/**
 * Download the persisted vault master key file (.secret_key)
 * GET /api/dashboard/vault-master-key
 *
 * This is the master key that encrypts/decrypts passphrases.json.
 */
router.get('/vault-master-key', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const confirm = String(req.query.confirm || '');
        if (confirm !== 'DOWNLOAD_MASTER_KEY') {
            return res.status(400).json({
                success: false,
                detail: 'Confirmation required. Pass confirm=DOWNLOAD_MASTER_KEY to download the vault master key.'
            });
        }

        const fs = require('fs-extra');
        const path = require('path');
        const secretKeyFile = path.join(config.dataDir, '.secret_key');

        if (await fs.pathExists(secretKeyFile)) {
            const keyText = (await fs.readFile(secretKeyFile, 'utf8')).trim() + '\n';
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Disposition', 'attachment; filename=".secret_key"');
            return res.status(200).send(keyText);
        }

        // Fallback if the instance is configured via env only (no persisted file).
        if (config.secretKey) {
            const keyText = String(config.secretKey).trim() + '\n';
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Disposition', 'attachment; filename="secret_key.txt"');
            return res.status(200).send(keyText);
        }

        return res.status(404).json({
            success: false,
            detail: 'No persisted .secret_key found and no SECRET_KEY configured'
        });
    } catch (error) {
        console.error('Error downloading vault master key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to download vault master key'
        });
    }
});

/**
 * Download ZIP of entire Borgmatic-UI configuration
 * Includes config and data directories (excludes logs)
 */
router.get('/download-config-zip', authenticateToken, requireAdmin, async (req, res) => {
    try {
        console.log('📦 Creating configuration backup ZIP...');

        const configDir = path.join(config.dataDir, '../config');
        const dataDir = config.dataDir;

        // Ensure directories exist
        if (!await fs.pathExists(configDir)) {
            throw new Error('Config directory not found');
        }
        if (!await fs.pathExists(dataDir)) {
            throw new Error('Data directory not found');
        }

        // Set response headers for ZIP download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipFilename = `borgmatic-director-ui-backup-${timestamp}.bac.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

        // Create ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        // Handle archive errors
        archive.on('error', (err) => {
            console.error('❌ Archive error:', err);
            throw err;
        });

        // Log progress
        archive.on('progress', (progress) => {
            console.log(`📦 Archived ${progress.entries.processed} files (${(progress.fs.processedBytes / 1024 / 1024).toFixed(2)} MB)`);
        });

        // Pipe archive to response
        archive.pipe(res);

        // Add config directory (excluding node_modules if any)
        console.log(`📁 Adding config directory: ${configDir}`);
        archive.directory(configDir, 'config', {
            ignore: ['node_modules/**', '*.log', '.git/**']
        });

        // Add data directory (excluding logs)
        console.log(`📁 Adding data directory: ${dataDir}`);
        archive.directory(dataDir, 'data', {
            ignore: ['logs/**', '*.log', 'node_modules/**', '.git/**']
        });

        // Add a README with instructions
        const readme = `Borgmatic-UI Configuration Backup
=====================================

Created: ${new Date().toISOString()}

This backup contains:
- config/: All Borgmatic configuration files
- data/: Encrypted credentials and metadata

To restore:
1. Extract this ZIP to your borgmatic-ui-data directory
2. Ensure the SECRET_KEY environment variable matches the one used during backup
3. Restart Borgmatic-UI

IMPORTANT: You MUST use the same SECRET_KEY to decrypt the credentials!

You can download the persisted master key file from the UI:
  Dashboard → Passphrase Vault → Download Vault Master Key
`;

        archive.append(readme, { name: 'README.txt' });

        // Finalize the archive
        await archive.finalize();

        console.log('✅ Configuration backup ZIP created successfully');
    } catch (error) {
        console.error('Error creating config ZIP:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                detail: 'Failed to create configuration backup'
            });
        }
    }
});

/**
 * Import configuration backup ZIP
 * POST /api/dashboard/import-config-zip
 */
router.post('/import-config-zip', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    let tempDir = null;
    let extractedDir = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded'
            });
        }

        // Security: Validate file type (must be .bac.zip)
        const filename = req.file.originalname.toLowerCase();
        if (!filename.endsWith('.bac.zip')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid file type. Please select a Borgmatic Director UI backup file (.bac.zip).'
            });
        }

        // Security: Validate file size (already limited by multer, but double-check)
        if (req.file.size > 100 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                detail: 'File too large. Maximum size is 100MB.'
            });
        }

        console.log('📥 Starting configuration import...');

        // Security: Create temporary directory with random name to prevent collisions
        const randomId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        tempDir = path.join(os.tmpdir(), `borgmatic-import-${randomId}`);
        extractedDir = path.join(tempDir, 'extracted');
        await fs.ensureDir(extractedDir);

        // Security: Ensure temp directory is actually in tmpdir (prevent path traversal)
        const resolvedTempDir = path.resolve(tempDir);
        const resolvedTmpDir = path.resolve(os.tmpdir());
        if (!resolvedTempDir.startsWith(resolvedTmpDir)) {
            throw new Error('Invalid temporary directory path');
        }

        // Write uploaded file to temp location
        const zipPath = path.join(tempDir, 'backup.zip');
        await fs.writeFile(zipPath, req.file.buffer);

        // Security: Extract ZIP file with path validation
        // Use unzip with -j (junk paths) and manual path validation, or use a safer method
        console.log('📦 Extracting ZIP file...');
        try {
            // Extract to temp directory first
            await execa('unzip', ['-q', zipPath, '-d', extractedDir], { timeout: 30000 });

            // Security: Validate all extracted paths are within extractedDir (prevent ZIP path traversal)
            const validateExtractedPaths = async (dir) => {
                const resolvedDir = path.resolve(dir);
                const resolvedExtractedDir = path.resolve(extractedDir);

                if (!resolvedDir.startsWith(resolvedExtractedDir)) {
                    throw new Error('Invalid extracted path detected (path traversal attempt)');
                }

                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const entryPath = path.join(dir, entry.name);
                    const resolvedEntryPath = path.resolve(entryPath);

                    if (!resolvedEntryPath.startsWith(resolvedExtractedDir)) {
                        throw new Error('Invalid extracted path detected (path traversal attempt)');
                    }

                    if (entry.isDirectory()) {
                        await validateExtractedPaths(entryPath);
                    }
                }
            };

            await validateExtractedPaths(extractedDir);
        } catch (unzipError) {
            console.error('ZIP extraction error:', unzipError.message);
            throw new Error('Failed to extract ZIP file. Please ensure unzip is installed on the server and the file is not corrupted.');
        }

        // Security: Validate backup structure with path resolution
        const configBackupDir = path.resolve(path.join(extractedDir, 'config'));
        const dataBackupDir = path.resolve(path.join(extractedDir, 'data'));
        const resolvedExtractedDir = path.resolve(extractedDir);

        // Ensure paths are within extracted directory (prevent path traversal)
        if (!configBackupDir.startsWith(resolvedExtractedDir) || !dataBackupDir.startsWith(resolvedExtractedDir)) {
            throw new Error('Invalid backup structure detected');
        }

        if (!await fs.pathExists(configBackupDir)) {
            throw new Error('Invalid backup: config directory not found');
        }
        if (!await fs.pathExists(dataBackupDir)) {
            throw new Error('Invalid backup: data directory not found');
        }

        console.log('✅ Backup structure validated');

        // Parse backup files
        const importResults = {
            repositories: { imported: 0, skipped: 0, errors: [] },
            backups: { imported: 0, skipped: 0, errors: [] },
            schedules: { imported: 0, skipped: 0, errors: [] },
            credentials: { imported: 0, skipped: 0, errors: [] }
        };

        // Import repositories
        const reposUnusedPath = path.join(configBackupDir, 'repositories-unused.yaml');
        if (await fs.pathExists(reposUnusedPath)) {
            try {
                const reposContent = await fs.readFile(reposUnusedPath, 'utf8');
                const reposData = yaml.load(reposContent) || {};
                const reposList = reposData.repositories || [];

                const allExistingRepos = await configParser.getAllRepositoriesWithUsage();

                for (const repo of reposList) {
                    try {
                        // Security: Validate repository data
                        if (!repo || typeof repo !== 'object') {
                            importResults.repositories.errors.push('Invalid repository data');
                            continue;
                        }

                        // Security: Validate repository path
                        if (!repo.path || typeof repo.path !== 'string' || repo.path.length > 2048) {
                            importResults.repositories.errors.push(`Invalid repository path: "${repo.name || 'unknown'}"`);
                            continue;
                        }

                        // Check for duplicate by path
                        const existingRepo = allExistingRepos.find(r => {
                            if (!r.path || !repo.path) return false;
                            return path.normalize(r.path) === path.normalize(repo.path);
                        });

                        if (existingRepo) {
                            importResults.repositories.skipped++;
                            importResults.repositories.errors.push(`Repository "${repo.name || repo.path}" already exists at ${repo.path}`);
                            continue;
                        }

                        // Import repository (add to unused repositories)
                        await configParser.addUnusedRepository(repo);
                        importResults.repositories.imported++;
                    } catch (repoError) {
                        importResults.repositories.errors.push(`Failed to import repository "${repo.name || repo.path}": ${repoError.message}`);
                    }
                }
            } catch (error) {
                importResults.repositories.errors.push(`Failed to parse repositories: ${error.message}`);
            }
        }

        // Import backup configurations
        const borgmaticDPath = path.join(configBackupDir, 'borgmatic.d');
        if (await fs.pathExists(borgmaticDPath)) {
            try {
                const backupFiles = await fs.readdir(borgmaticDPath);
                const yamlFiles = backupFiles.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

                const existingBackups = await backupManager.getAllBackups();
                const existingBackupNames = new Set(existingBackups.map(b => b.name));

                for (const file of yamlFiles) {
                    try {
                        // Security: Validate filename (prevent path traversal)
                        if (file.includes('..') || file.includes('/') || file.includes('\\')) {
                            importResults.backups.errors.push(`Invalid filename detected: "${file}"`);
                            continue;
                        }

                        const sourcePath = path.join(borgmaticDPath, file);
                        const resolvedSourcePath = path.resolve(sourcePath);
                        const resolvedBorgmaticDPath = path.resolve(borgmaticDPath);

                        // Security: Ensure source path is within expected directory
                        if (!resolvedSourcePath.startsWith(resolvedBorgmaticDPath)) {
                            importResults.backups.errors.push(`Invalid path detected for file: "${file}"`);
                            continue;
                        }

                        const backupContent = await fs.readFile(sourcePath, 'utf8');

                        // Security: Use safeLoad to prevent code execution (js-yaml safeLoad is deprecated, but load is safe by default)
                        // However, we'll add schema validation
                        const backupData = yaml.load(backupContent, { schema: yaml.DEFAULT_SAFE_SCHEMA });

                        // Extract backup name from metadata or filename
                        const backupName = backupData?.metadata?.name || file.replace(/\.(yaml|yml)$/, '');

                        // Security: Validate backup name
                        if (!backupName || typeof backupName !== 'string' || backupName.length > 255) {
                            importResults.backups.errors.push(`Invalid backup name for file: "${file}"`);
                            continue;
                        }

                        if (existingBackupNames.has(backupName)) {
                            importResults.backups.skipped++;
                            importResults.backups.errors.push(`Backup "${backupName}" already exists`);
                            continue;
                        }

                        // Security: Validate target path
                        const targetPath = path.join(config.configDir, 'borgmatic.d', file);
                        const resolvedTargetPath = path.resolve(targetPath);
                        const resolvedConfigDir = path.resolve(config.configDir, 'borgmatic.d');

                        if (!resolvedTargetPath.startsWith(resolvedConfigDir)) {
                            importResults.backups.errors.push(`Invalid target path for file: "${file}"`);
                            continue;
                        }

                        // Copy backup file to current config
                        await fs.copy(sourcePath, targetPath);
                        importResults.backups.imported++;
                    } catch (backupError) {
                        importResults.backups.errors.push(`Failed to import backup "${file}": ${backupError.message}`);
                    }
                }
            } catch (error) {
                importResults.backups.errors.push(`Failed to read backup directory: ${error.message}`);
            }
        }

        // Import credentials (repository-credentials.json)
        const credentialsPath = path.join(dataBackupDir, 'repository-credentials.json');
        if (await fs.pathExists(credentialsPath)) {
            try {
                const backupCredentials = await fs.readJson(credentialsPath);
                const currentCredentialsPath = path.join(config.dataDir, 'repository-credentials.json');
                let currentCredentials = {};

                if (await fs.pathExists(currentCredentialsPath)) {
                    currentCredentials = await fs.readJson(currentCredentialsPath);
                }

                // Merge credentials (backup takes precedence for same paths)
                let mergedCount = 0;
                for (const [repoPath, creds] of Object.entries(backupCredentials)) {
                    if (!currentCredentials[repoPath]) {
                        currentCredentials[repoPath] = creds;
                        mergedCount++;
                    } else {
                        importResults.credentials.skipped++;
                    }
                }

                if (mergedCount > 0) {
                    await fs.writeJson(currentCredentialsPath, currentCredentials, { spaces: 2 });
                    await fs.chmod(currentCredentialsPath, 0o600);
                    importResults.credentials.imported = mergedCount;
                }
            } catch (error) {
                importResults.credentials.errors.push(`Failed to import credentials: ${error.message}`);
            }
        }

        // Copy other config files (schedules, retention profiles, etc.)
        const schedulesPath = path.join(configBackupDir, 'saved_schedules.yaml');
        if (await fs.pathExists(schedulesPath)) {
            try {
                // Security: Validate paths
                const resolvedSchedulesPath = path.resolve(schedulesPath);
                if (!resolvedSchedulesPath.startsWith(resolvedExtractedDir)) {
                    throw new Error('Invalid schedules path');
                }

                const targetSchedulesPath = path.join(config.configDir, 'saved_schedules.yaml');
                const resolvedTargetSchedulesPath = path.resolve(targetSchedulesPath);
                const resolvedConfigDir = path.resolve(config.configDir);

                if (!resolvedTargetSchedulesPath.startsWith(resolvedConfigDir)) {
                    throw new Error('Invalid target schedules path');
                }

                await fs.copy(schedulesPath, targetSchedulesPath);
                importResults.schedules.imported++;
            } catch (error) {
                importResults.schedules.errors.push(`Failed to import schedules: ${error.message}`);
            }
        }

        // Note: Repositories are already imported via addUnusedRepository above
        // No need to copy the file as it's managed by the service

        console.log('✅ Configuration import completed');

        res.json({
            success: true,
            message: 'Configuration imported successfully',
            data: {
                summary: {
                    repositories: `${importResults.repositories.imported} imported, ${importResults.repositories.skipped} skipped`,
                    backups: `${importResults.backups.imported} imported, ${importResults.backups.skipped} skipped`,
                    schedules: `${importResults.schedules.imported} imported`,
                    credentials: `${importResults.credentials.imported} imported, ${importResults.credentials.skipped} skipped`
                },
                details: importResults
            }
        });

    } catch (error) {
        console.error('❌ Failed to import configuration:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to import configuration backup'
        });
    } finally {
        // Cleanup temp directory
        if (tempDir && await fs.pathExists(tempDir)) {
            try {
                await fs.remove(tempDir);
            } catch (cleanupError) {
                console.warn('Failed to cleanup temp directory:', cleanupError.message);
            }
        }
    }
});

/**
 * Check binary availability and get version
 */
async function checkBinaryHealth(binary) {
    try {
        const { stdout } = await execa(binary, ['--version'], { timeout: 10000 });
        const version = stdout.split('\n')[0].trim();
        return {
            available: true,
            version: version,
            status: 'healthy'
        };
    } catch (error) {
        return {
            available: false,
            version: null,
            status: 'error',
            error: error.code === 'ENOENT'
                ? `${binary} not found. Please install it.`
                : error.message
        };
    }
}

/**
 * Check Rclone CLI availability (on host system via /host mount)
 */
async function checkRcloneCLIHealth() {
    try {
        const rcloneCLI = require('../services/rclone-cli');

        const checkResult = await rcloneCLI.checkInstallation();
        
        if (!checkResult.installed) {
            return {
                available: false,
                version: null,
                remotes_count: 0,
                status: 'not_installed',
                error: checkResult.error || 'Rclone not found on host system'
            };
        }

        // Try to get remotes count
        let remotesCount = 0;
        try {
            const remotesResult = await rcloneCLI.listRemotes();
            if (remotesResult.success) {
                remotesCount = remotesResult.remotes?.length || 0;
            }
        } catch {
            remotesCount = 0;
        }

        return {
            available: true,
            version: checkResult.version || 'unknown',
            path: checkResult.path,
            remotes_count: remotesCount,
            status: 'healthy',
            mode: 'cli'
        };
    } catch (error) {
        return {
            available: false,
            version: null,
            remotes_count: 0,
            status: 'error',
            error: error?.message || String(error)
        };
    }
}

// NOTE: RCD health check removed - we now use CLI only for Rclone detection
// The rclone-rcd.js service is still available for mount operations (Direct Repository mode)

/**
 * Get system health status
 */
router.get('/health', authenticateToken, async (req, res) => {
    try {
        const checks = {};

        // Check system resources
        try {
            const metrics = await getSystemMetrics();

            checks.system = {
                status: (metrics.cpu_usage < 90 && metrics.memory_usage < 90 && metrics.disk_usage < 90) ? 'healthy' : 'warning',
                cpu_usage: metrics.cpu_usage,
                memory_usage: metrics.memory_usage,
                disk_usage: metrics.disk_usage
            };
        } catch (error) {
            checks.system = {
                status: 'error',
                error: error.message
            };
        }

        // Check borg availability
        checks.borg = await checkBinaryHealth('borg');

        // Check borgmatic availability
        checks.borgmatic = await checkBinaryHealth('borgmatic');

        // Check backup repositories
        try {
            const backupStatus = await getBackupStatus();
            const healthyRepos = backupStatus.filter(repo => repo.status === 'healthy').length;
            const totalRepos = backupStatus.length;

            if (totalRepos === 0) {
                checks.repositories = {
                    status: 'healthy',
                    healthy_count: 0,
                    total_count: 0,
                    message: 'No repositories configured'
                };
            } else {
                checks.repositories = {
                    status: healthyRepos === totalRepos ? 'healthy' : 'warning',
                    healthy_count: healthyRepos,
                    total_count: totalRepos
                };
            }
        } catch (error) {
            checks.repositories = {
                status: 'error',
                error: error.message
            };
        }

        // Overall status
        let overallStatus = 'healthy';
        if (Object.values(checks).some(check => check.status === 'error')) {
            overallStatus = 'error';
        } else if (Object.values(checks).some(check => check.status === 'warning')) {
            overallStatus = 'warning';
        }

        res.json({
            success: true,
            data: {
                status: overallStatus,
                checks: checks,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error getting health status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get health status'
        });
    }
});

/**
 * Check Borgmatic/Borg installation health
 * GET /api/dashboard/tools-health
 */
router.get('/tools-health', authenticateToken, async (req, res) => {
    try {
        // Check both Borg versions (borg1 = 1.x, borg2 = 2.x, borg = default/symlink)
        const borgDefault = await checkBinaryHealth('borg');
        const borg1 = await checkBinaryHealth('borg1');
        const borg2 = await checkBinaryHealth('borg2');
        
        // Build Borg info with both versions
        const borgInfo = {
            available: borgDefault.available || borg1.available || borg2.available,
            version: borgDefault.version,
            status: borgDefault.status,
            versions: {}
        };
        
        if (borg1.available) {
            borgInfo.versions['1.x'] = borg1.version;
        }
        if (borg2.available) {
            borgInfo.versions['2.x'] = borg2.version;
        }

        // Check Rclone CLI (on host via /host mount)
        const rcloneHealth = await checkRcloneCLIHealth();

        const checks = {
            borg: borgInfo,
            borgmatic: await checkBinaryHealth('borgmatic'),
            rclone: rcloneHealth
        };

        // Determine overall status
        const allHealthy = checks.borg.available && checks.borgmatic.available;
        const anyAvailable = checks.borg.available || checks.borgmatic.available;

        let overallStatus = 'healthy';
        let message = 'All backup tools are installed and working';

        if (!anyAvailable) {
            overallStatus = 'error';
            message = 'No backup tools found. Please install borg and borgmatic.';
        } else if (!allHealthy) {
            overallStatus = 'warning';
            const missing = [];
            if (!checks.borg.available) missing.push('borg');
            if (!checks.borgmatic.available) missing.push('borgmatic');
            message = `Missing: ${missing.join(', ')}. Some features may not work.`;
        }

        // Rclone is optional; keep overallStatus based on borg/borgmatic
        if (!checks.rclone?.available && overallStatus === 'healthy') {
            message = 'Core tools working. Rclone not installed (optional for cloud sync).';
        }

        res.json({
            success: true,
            data: {
                status: overallStatus,
                message: message,
                tools: checks,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error checking tools health:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to check backup tools health'
        });
    }
});

/**
 * Check passphrase vault health
 * GET /api/dashboard/vault-health
 * 
 * Checks if the encrypted passphrases.json can be decrypted with current SECRET_KEY
 */
router.get('/vault-health', authenticateToken, async (req, res) => {
    try {
        const passwordManager = require('../services/password-manager');
        const configParser = require('../services/config-parser');
        const config = require('../config');
        const fs = require('fs-extra');
        const path = require('path');

        const credentialsFile = path.join(config.dataDir, 'passphrases.json');

        let status = 'healthy';
        let message = 'Passphrase vault is healthy';
        let details = {
            vault_exists: false,
            can_decrypt: false,
            stored_passphrases: 0,
            repos_needing_passphrase: []
        };

        // Check if vault file exists
        if (await fs.pathExists(credentialsFile)) {
            details.vault_exists = true;

            // Try to decrypt
            try {
                const credentials = await passwordManager.getRepositoryPassphrase('__test__');
                // If we get here without throwing, decryption works
                // (null return is fine - just means no passphrase for __test__)
                details.can_decrypt = true;

                // Count stored passphrases
                const allCredentials = await passwordManager._readCredentials();
                details.stored_passphrases = Object.keys(allCredentials.repositories || {}).length;
            } catch (decryptError) {
                details.can_decrypt = false;
                status = 'error';
                message = 'Cannot decrypt passphrase vault. The SECRET_KEY may have changed.';
                console.error('Vault decryption failed:', decryptError.message);
            }
        } else {
            // No vault file yet - this is OK, just means no passphrases stored
            details.vault_exists = false;
            details.can_decrypt = true; // Will work once created
        }

        // Check which repos need passphrases
        if (details.can_decrypt) {
            try {
                const repositories = await configParser.getAllRepositoriesWithUsage();
                for (const repo of repositories) {
                    // If repo has encryption but no stored passphrase
                    if (repo.encryption && repo.encryption !== 'none') {
                        const passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
                        if (!passphrase) {
                            details.repos_needing_passphrase.push({
                                id: repo.id,
                                name: repo.name || repo.label,
                                path: repo.path,
                                encryption: repo.encryption
                            });
                        }
                    }
                }

                if (details.repos_needing_passphrase.length > 0) {
                    status = 'warning';
                    message = `${details.repos_needing_passphrase.length} encrypted repository/ies need passphrase entry`;
                }
            } catch (repoError) {
                console.warn('Could not check repos for passphrases:', repoError.message);
            }
        }

        res.json({
            success: true,
            data: {
                status: status,
                message: message,
                details: details,
                recovery_info: status === 'error' ? {
                    explanation: 'The passphrase vault is encrypted with your SECRET_KEY. When the SECRET_KEY changes (e.g., reinstalling the container without preserving the .secret_key file), the old passphrases cannot be decrypted.',
                    solutions: [
                        'If you have the old .secret_key file, restore it to /app/data/.secret_key',
                        'If you remember your repository passphrases, you can reset the vault and re-enter them',
                        'Repository configurations are NOT affected - only the stored passphrases are lost'
                    ]
                } : null,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error checking vault health:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to check passphrase vault health'
        });
    }
});

/**
 * Reset passphrase vault (for recovery when SECRET_KEY changed)
 * POST /api/dashboard/vault-reset
 */
router.post('/vault-reset', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'RESET_VAULT') {
            return res.status(400).json({
                success: false,
                detail: 'You must confirm vault reset by sending confirm: "RESET_VAULT"'
            });
        }

        const config = require('../config');
        const fs = require('fs-extra');
        const path = require('path');

        const credentialsFile = path.join(config.dataDir, 'passphrases.json');

        // Backup old file if it exists
        if (await fs.pathExists(credentialsFile)) {
            const backupFile = path.join(config.dataDir, `passphrases.json.backup.${Date.now()}`);
            await fs.copy(credentialsFile, backupFile);
            console.log(`📦 Backed up old vault to: ${backupFile}`);
        }

        // Remove the old vault
        await fs.remove(credentialsFile);

        console.log('🔓 Passphrase vault has been reset');

        res.json({
            success: true,
            message: 'Passphrase vault has been reset. You will need to re-enter passphrases for your encrypted repositories.'
        });
    } catch (error) {
        console.error('Error resetting vault:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to reset passphrase vault'
        });
    }
});

module.exports = router;
