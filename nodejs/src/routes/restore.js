const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const borgmaticCLI = require('../services/borgmatic-cli');
const borgmaticConfig = require('../services/borgmatic-config');
const passwordManager = require('../services/password-manager');
const { detectBorgVersion, getBorgCommand } = require('../services/borg-version-detector');
const restoreHistory = require('../services/restore-history');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execa } = require('execa');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// In-memory restore job storage (in production, use Redis or database)
const restoreJobs = new Map();

// ============================================================================
// Restore path safety: restrict browsing/restores to allowed roots
// ============================================================================
// In Docker, the host filesystem is bind-mounted at /host and we only want to
// expose a small set of known directories. When running the backend directly
// on a host (dev / non-Docker installs), the admin reasonably expects to see
// the full filesystem (e.g. /home, /mnt, /etc) just like a normal file manager.
const DOCKER_RESTORE_ALLOWED_ROOTS = ['/host', '/opt/speedbits-backup', '/opt/speedbits', '/backup-source', '/backup-destination', '/tmp'];
const HOST_RESTORE_ALLOWED_ROOTS = ['/'];

function isRunningInDocker() {
    try {
        return fs.existsSync('/.dockerenv');
    } catch (_) {
        return false;
    }
}

function getRestoreAllowedRoots() {
    const raw = process.env.RESTORE_ALLOWED_ROOTS;
    if (raw) {
        return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => path.resolve(p));
    }
    return isRunningInDocker() ? DOCKER_RESTORE_ALLOWED_ROOTS : HOST_RESTORE_ALLOWED_ROOTS;
}

function isUnderAllowedRoots(targetPath) {
    const resolved = path.resolve(targetPath);
    const roots = getRestoreAllowedRoots();

    return roots.some((root) => {
        const r = path.resolve(root);
        // Root "/" is a special case: any absolute path is under it.
        // Without this, r + path.sep becomes "//" and startsWith fails for
        // every real path (e.g. "/home".startsWith("//") === false).
        if (r === path.sep) return true;
        // exact match or within subtree
        return resolved === r || resolved.startsWith(r + path.sep);
    });
}

function validateArchiveItemPath(p) {
    if (typeof p !== 'string' || !p) return false;
    if (p.includes('\0') || p.includes('\n') || p.includes('\r')) return false;
    if (p.includes('..')) return false;
    return true;
}

/**
 * Preview a restore operation (dry run)
 * POST /api/restore/preview
 */
router.post('/preview', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            repository,
            archive,
            paths = [],
            destination,
            stripComponents,
            progress = false,
            verbosity = 1
        } = req.body;

        if (!repository) {
            return res.status(400).json({
                success: false,
                detail: 'Repository parameter is required'
            });
        }

        if (!archive || archive.trim() === '') {
            return res.status(400).json({
                success: false,
                detail: 'Archive parameter is required and cannot be empty'
            });
        }

        // Destination is optional - defaults to current directory

        // Get passphrase from config if needed
        let passphrase = null;
        try {
            const config = await borgmaticConfig.loadConfig();
            passphrase = config.storage?.encryption_passphrase || null;
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const options = {
            paths: paths && paths.length > 0 ? paths.filter(p => p && p.trim()) : undefined,
            stripComponents: stripComponents ? Math.max(0, parseInt(stripComponents, 10)) : undefined,
            progress: progress === true,
            verbosity: verbosity || 1,
            dryRun: true,
            passphrase
        };

        // Perform dry run extraction
        const result = await borgmaticCLI.extractArchive(repository, archive, destination, options);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                detail: `Failed to preview restore: ${result.error || result.stderr}`
            });
        }

        res.json({
            success: true,
            data: {
                preview: result.stdout,
                repository: repository,
                archive: archive,
                destination: destination,
                paths: paths,
                command: result.command
            }
        });
    } catch (error) {
        console.error('Failed to preview restore:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to preview restore'
        });
    }
});

/**
 * Download a single file from archive to browser
 * POST /api/restore/download
 */
router.post('/download', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repository, archive, filePath } = req.body;

        // Security: Validate filePath to prevent path traversal
        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({
                success: false,
                detail: 'Invalid file path'
            });
        }

        // Prevent path traversal attempts
        if (filePath.includes('..') || filePath.includes('~')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid file path: path traversal not allowed'
            });
        }

        // File path should be absolute (start with /)
        if (!filePath.startsWith('/')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid file path: must be an absolute path'
            });
        }

        if (!repository || !archive) {
            return res.status(400).json({
                success: false,
                detail: 'Repository and archive parameters are required'
            });
        }

        // Security: Prevent command injection via archive name
        const dangerousChars = /[;&|`$()<>]/;
        if (dangerousChars.test(archive)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid characters in archive name'
            });
        }

        console.log(`📥 Downloading file "${filePath}" from archive "${archive}"`);

        // Get passphrase for repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repository);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Detect Borg version for this repository
        let borgVersion = '1.x';
        try {
            borgVersion = await detectBorgVersion(repository);
            console.log(`📦 Detected Borg version: ${borgVersion}`);
        } catch (err) {
            console.warn('Could not detect borg version, defaulting to 1.x:', err.message);
        }

        // Set up SSH authentication if this is an SSH repository
        const isSSHRepo = repository.startsWith('ssh://');
        if (isSSHRepo) {
            try {
                const configParser = require('../services/config-parser');
                const allRepos = await configParser.getAllRepositoriesWithUsage();
                const repo = allRepos.find(r => r.path === repository);

                if (repo) {
                    const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');

                    if (authMethod === 'key' && repo.ssh_key_id) {
                        const sshKeysAPI = require('../services/ssh-keys');
                        const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);

                        if (sshKey && sshKey.private_key) {
                            const config = require('../config');
                            const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
                            await fs.ensureDir(sshKeyDir);

                            const keyFilename = `download_key_${repo.ssh_key_id}`;
                            const keyPath = path.join(sshKeyDir, keyFilename);
                            await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });

                            const sshMatch = repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';

                            if (sshKey.is_encrypted && sshKey.passphrase) {
                                const askpassScript = path.join(sshKeyDir, `askpass_download_${repo.ssh_key_id}.sh`);
                                const escapedPassphrase = sshKey.passphrase.replace(/'/g, "'\"'\"'");
                                await fs.writeFile(askpassScript, `#!/bin/sh\necho '${escapedPassphrase}'\n`, { mode: 0o700 });
                                env.SSH_ASKPASS = askpassScript;
                                env.SSH_ASKPASS_REQUIRE = 'force';
                                env.DISPLAY = ':0';
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${port}`;
                            } else {
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${port}`;
                            }
                            console.log(`🔑 [Download] Using SSH key authentication`);
                        }
                    } else if (authMethod === 'password') {
                        const repositoryCredentials = require('../services/repository-credentials');
                        const sshPassword = await repositoryCredentials.getSSHPassword(repository);
                        if (sshPassword) {
                            const sshMatch = repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';
                            env.SSHPASS = sshPassword;
                            env.BORG_RSH = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p ${port}`;
                            console.log(`🔐 [Download] Using SSH password authentication`);
                        }
                    }
                }
            } catch (sshError) {
                console.warn(`⚠️ [Download] Failed to set up SSH auth:`, sshError.message);
            }
        }

        // Create temporary directory
        const tmpDir = path.join('/tmp', `borgmatic-download-${uuidv4()}`);
        await fs.ensureDir(tmpDir);

        try {
            // Extract file using borg extract to temp directory, then read it
            const extractPath = path.join(tmpDir, 'extract');
            await fs.ensureDir(extractPath);

            // Borg expects relative paths. Our UI paths are absolute-style (start with '/').
            const borgPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
            if (!validateArchiveItemPath(borgPath)) {
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid file path'
                });
            }

            console.log(`📂 Extract path: ${extractPath}`);

            // Get the correct borg command based on version
            // For Hetzner Storage Boxes, include --remote-path
            const configParser = require('../services/config-parser');
            const allReposForExtract = await configParser.getAllRepositoriesWithUsage();
            const repoForExtract = allReposForExtract.find(r => r.path === repository);
            
            const { command: borgCmd, args: borgArgs } = getBorgCommand(borgVersion, 'extract', {
                repoPath: repository,
                archiveName: archive,
                extraArgs: [borgPath],
                remotePath: repoForExtract?.hetzner_borg_version, // For Hetzner Storage Boxes
            });

            console.log(`🔧 Running: ${borgCmd} ${borgArgs.join(' ')}`);

            // Execute borg safely
            const result = await execa(borgCmd, borgArgs, {
                env,
                cwd: extractPath,
                timeout: 300000
            });

            // Find the extracted file/directory
            // IMPORTANT: don't use filePath (leading slash would discard extractPath).
            const extractedFilePath = path.join(extractPath, borgPath);
            console.log(`📄 Looking for extracted path at: ${extractedFilePath}`);

            if (!await fs.pathExists(extractedFilePath)) {
                throw new Error(`Extracted path not found at: ${extractedFilePath}`);
            }

            // Check if it's a file or directory
            const stats = await fs.stat(extractedFilePath);
            const baseName = path.basename(filePath);

            if (stats.isDirectory()) {
                // It's a directory - zip it up
                console.log(`📁 Extracted path is a directory, creating zip archive...`);
                const archiver = require('archiver');

                const zipFilename = `${baseName}.zip`;
                res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
                res.setHeader('Content-Type', 'application/zip');

                const archive = archiver('zip', { zlib: { level: 6 } });

                archive.on('error', (err) => {
                    console.error('❌ Archiver error:', err.message);
                    throw err;
                });

                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('⚠️ Archiver warning:', err.message);
                    } else {
                        throw err;
                    }
                });

                // Pipe archive to response
                archive.pipe(res);

                // Add directory contents to archive
                archive.directory(extractedFilePath, baseName);

                // Finalize the archive
                await archive.finalize();
                console.log(`✅ Directory zipped and downloaded successfully (${archive.pointer()} bytes)`);
            } else {
                // It's a file - send it directly
                const fileBuffer = await fs.readFile(extractedFilePath);
                console.log(`📊 File size: ${fileBuffer.length} bytes`);

                res.setHeader('Content-Disposition', `attachment; filename="${baseName}"`);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', fileBuffer.length);

                res.send(fileBuffer);
                console.log(`✅ File downloaded successfully`);
            }
        } catch (extractError) {
            console.error('❌ Extract error:', extractError.message);
            if (extractError.stderr) console.error('❌ Borg stderr:', extractError.stderr);
            throw extractError;
        } finally {
            // Clean up temporary directory
            await fs.remove(tmpDir).catch(err => console.warn('Failed to clean up temp dir:', err.message));
        }
    } catch (error) {
        console.error('Failed to download file:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to download file'
        });
    }
});

/**
 * Start a restore operation
 * POST /api/restore/start
 */
router.post('/start', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            repository,
            archive,
            paths = [],
            destination,
            stripComponents,
            progress = true,
            verbosity = 1
        } = req.body;

        if (!repository) {
            return res.status(400).json({
                success: false,
                detail: 'Repository parameter is required'
            });
        }

        if (!archive) {
            return res.status(400).json({
                success: false,
                detail: 'Archive parameter is required'
            });
        }

        // Destination is optional - defaults to current directory

        // Generate unique job ID
        const jobId = uuidv4();

        // Create restore job record
        const restoreJob = {
            id: jobId,
            repository: repository,
            archive: archive,
            paths: paths,
            destination: destination,
            stripComponents: stripComponents,
            progress: progress,
            verbosity: verbosity,
            status: 'running',
            started_at: new Date().toISOString(),
            completed_at: null,
            progress_percent: 0,
            error_message: null,
            logs: '',
            user_id: req.user.username
        };

        // Store job in memory
        try {
            restoreJobs.set(jobId, restoreJob);
        } catch (error) {
            console.error('Failed to store restore job:', error.message);
            return res.status(500).json({
                success: false,
                detail: 'Failed to create restore job'
            });
        }

        // Execute restore asynchronously
        executeRestore(jobId, restoreJob);

        res.json({
            success: true,
            data: {
                job_id: jobId,
                status: 'running',
                message: 'Restore job started'
            }
        });
    } catch (error) {
        console.error('Failed to start restore:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to start restore'
        });
    }
});

/**
 * Execute restore operation asynchronously
 */
async function executeRestore(jobId, restoreJob) {
    const job = restoreJobs.get(jobId);
    if (!job) return;

    try {
        // Update job status
        job.status = 'running';
        job.progress_percent = 10;
        job.logs = 'Starting restore...\n';

        // Get passphrase for repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(restoreJob.repository);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Build borg extract command
        const destination = restoreJob.destination || '.';

        // Detect Borg version for this repository
        let borgVersion = '1.x';
        try {
            borgVersion = await detectBorgVersion(restoreJob.repository);
            console.log(`📦 Detected Borg version: ${borgVersion}`);
        } catch (err) {
            console.warn('Could not detect borg version, defaulting to 1.x:', err.message);
        }

        // Get repository info for Hetzner remote-path and SSH auth
        const configParser = require('../services/config-parser');
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === restoreJob.repository);
        
        // Set up SSH authentication if this is an SSH repository
        const isSSHRepo = restoreJob.repository.startsWith('ssh://');
        if (isSSHRepo) {
            try {
                if (repo) {
                    const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');

                    if (authMethod === 'key' && repo.ssh_key_id) {
                        const sshKeysAPI = require('../services/ssh-keys');
                        const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);

                        if (sshKey && sshKey.private_key) {
                            const config = require('../config');
                            const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
                            await fs.ensureDir(sshKeyDir);

                            const keyFilename = `restore_key_${repo.ssh_key_id}`;
                            const keyPath = path.join(sshKeyDir, keyFilename);
                            await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });

                            const sshMatch = restoreJob.repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';

                            if (sshKey.is_encrypted && sshKey.passphrase) {
                                const askpassScript = path.join(sshKeyDir, `askpass_restore_${repo.ssh_key_id}.sh`);
                                const escapedPassphrase = sshKey.passphrase.replace(/'/g, "'\"'\"'");
                                await fs.writeFile(askpassScript, `#!/bin/sh\necho '${escapedPassphrase}'\n`, { mode: 0o700 });
                                env.SSH_ASKPASS = askpassScript;
                                env.SSH_ASKPASS_REQUIRE = 'force';
                                env.DISPLAY = ':0';
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${port}`;
                            } else {
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${port}`;
                            }
                            console.log(`🔑 [Restore] Using SSH key authentication`);
                        }
                    } else if (authMethod === 'password') {
                        const repositoryCredentials = require('../services/repository-credentials');
                        const sshPassword = await repositoryCredentials.getSSHPassword(restoreJob.repository);
                        if (sshPassword) {
                            const sshMatch = restoreJob.repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';
                            env.SSHPASS = sshPassword;
                            env.BORG_RSH = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p ${port}`;
                            console.log(`🔐 [Restore] Using SSH password authentication`);
                        }
                    }
                }
            } catch (sshError) {
                console.warn(`⚠️ [Restore] Failed to set up SSH auth:`, sshError.message);
            }
        }

        // Get the correct borg command based on version
        // For Hetzner Storage Boxes, include --remote-path
        const { command: borgCmd, args: extractArgs } = getBorgCommand(borgVersion, 'extract', {
            repoPath: restoreJob.repository,
            archiveName: restoreJob.archive,
            extraArgs: restoreJob.paths && restoreJob.paths.length > 0 ? restoreJob.paths : [],
            remotePath: repo?.hetzner_borg_version, // For Hetzner Storage Boxes
        });

        console.log(`🔄 Executing restore: ${borgCmd} ${extractArgs.join(' ')}`);
        console.log(`📂 Destination: ${destination}`);

        // Execute borg extract command
        const { execa } = require('execa');
        const result = await execa(borgCmd, extractArgs, {
            env,
            cwd: destination,
            timeout: 1800000 // 30 minutes
        }).then(({ stdout, stderr }) => ({
            success: true,
            stdout,
            stderr
        })).catch((error) => ({
            success: false,
            error: error.message,
            stderr: error.stderr || error.stdout || ''
        }));

        if (result.success) {
            job.status = 'completed';
            job.progress_percent = 100;
            job.completed_at = new Date().toISOString();
            job.logs += result.stdout || '';

            console.log(`Restore completed successfully for job ${jobId}`);
        } else {
            job.status = 'failed';
            job.progress_percent = 0;
            job.completed_at = new Date().toISOString();
            job.error_message = result.error || 'Unknown error';
            job.logs += result.stderr || '';

            console.error(`Restore failed for job ${jobId}:`, result.error);
        }
    } catch (error) {
        job.status = 'failed';
        job.progress_percent = 0;
        job.completed_at = new Date().toISOString();
        job.error_message = error.message;
        job.logs += `Error: ${error.message}\n`;

        console.error(`Restore error for job ${jobId}:`, error.message);
    }

    // Update job in storage
    restoreJobs.set(jobId, job);

    // TODO: Send real-time update via WebSocket
}

/**
 * Get restore job status
 * GET /api/restore/status/:jobId
 */
router.get('/status/:jobId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = restoreJobs.get(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                detail: 'Restore job not found'
            });
        }

        // Check if user has access to this job
        if (job.user_id !== req.user.username && !req.user.is_admin) {
            return res.status(403).json({
                success: false,
                detail: 'Access denied to this restore job'
            });
        }

        res.json({
            success: true,
            data: {
                id: job.id,
                repository: job.repository,
                archive: job.archive,
                paths: job.paths,
                destination: job.destination,
                status: job.status,
                started_at: job.started_at,
                completed_at: job.completed_at,
                progress: job.progress_percent,
                error_message: job.error_message,
                logs: job.logs
            }
        });
    } catch (error) {
        console.error('Failed to get restore status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore status'
        });
    }
});

/**
 * Get restore job logs
 * GET /api/restore/logs/:jobId
 */
router.get('/logs/:jobId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = restoreJobs.get(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                detail: 'Restore job not found'
            });
        }

        // Check if user has access to this job
        if (job.user_id !== req.user.username && !req.user.is_admin) {
            return res.status(403).json({
                success: false,
                detail: 'Access denied to this restore job'
            });
        }

        res.json({
            success: true,
            data: {
                job_id: job.id,
                logs: job.logs || '',
                error_message: job.error_message || ''
            }
        });
    } catch (error) {
        console.error('Failed to get restore logs:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore logs'
        });
    }
});

/**
 * Cancel a running restore job
 * DELETE /api/restore/cancel/:jobId
 */
router.delete('/cancel/:jobId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = restoreJobs.get(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                detail: 'Restore job not found'
            });
        }

        // Check if user has access to this job
        if (job.user_id !== req.user.username && !req.user.is_admin) {
            return res.status(403).json({
                success: false,
                detail: 'Access denied to this restore job'
            });
        }

        if (job.status !== 'running') {
            return res.status(400).json({
                success: false,
                detail: 'Can only cancel running jobs'
            });
        }

        // Update job status
        job.status = 'cancelled';
        job.completed_at = new Date().toISOString();
        job.logs += 'Restore cancelled by user\n';

        // TODO: Implement actual process cancellation
        // This would require tracking the child process and killing it

        restoreJobs.set(jobId, job);

        console.log(`Restore cancelled for job ${jobId} by user ${req.user.username}`);

        res.json({
            success: true,
            data: {
                message: 'Restore cancelled successfully'
            }
        });
    } catch (error) {
        console.error('Failed to cancel restore:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to cancel restore'
        });
    }
});

/**
 * Get all restore jobs for the current user
 * GET /api/restore/jobs
 */
router.get('/jobs', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { limit = 50, status } = req.query;
        const userJobs = [];

        // Filter jobs by user and status
        for (const [jobId, job] of restoreJobs.entries()) {
            if (job.user_id === req.user.username) {
                if (!status || job.status === status) {
                    userJobs.push({
                        id: job.id,
                        repository: job.repository,
                        archive: job.archive,
                        destination: job.destination,
                        status: job.status,
                        started_at: job.started_at,
                        completed_at: job.completed_at,
                        progress: job.progress_percent
                    });
                }
            }
        }

        // Sort by started_at descending
        userJobs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

        // Apply limit
        const limitedJobs = userJobs.slice(0, parseInt(limit));

        res.json({
            success: true,
            data: {
                jobs: limitedJobs,
                total: userJobs.length
            }
        });
    } catch (error) {
        console.error('Failed to get restore jobs:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore jobs'
        });
    }
});

/**
 * Restore database dumps from archive
 * POST /api/restore/database
 */
router.post('/database', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            repository,
            archive,
            dataSource,
            schema,
            hostname,
            port,
            username,
            password,
            database,
            originalHostname,
            originalContainer,
            originalPort,
            hook
        } = req.body;

        if (!repository) {
            return res.status(400).json({
                success: false,
                detail: 'Repository parameter is required'
            });
        }

        if (!archive) {
            return res.status(400).json({
                success: false,
                detail: 'Archive parameter is required'
            });
        }

        // Get passphrase from config if needed
        let passphrase = null;
        try {
            const config = await borgmaticConfig.loadConfig();
            passphrase = config.storage?.encryption_passphrase || null;
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const options = {
            dataSource,
            schema,
            hostname,
            port,
            username,
            password,
            database,
            originalHostname,
            originalContainer,
            originalPort,
            hook,
            passphrase
        };

        const result = await borgmaticCLI.restoreData(repository, archive, options);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                detail: `Failed to restore database: ${result.error || result.stderr}`
            });
        }

        res.json({
            success: true,
            data: {
                message: 'Database restored successfully',
                repository: repository,
                archive: archive,
                command: result.command,
                output: result.stdout
            }
        });
    } catch (error) {
        console.error('Failed to restore database:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to restore database'
        });
    }
});

/**
 * Get restore statistics
 * GET /api/restore/stats
 */
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userJobs = [];

        // Get all jobs for the current user
        for (const [jobId, job] of restoreJobs.entries()) {
            if (job.user_id === req.user.username) {
                userJobs.push(job);
            }
        }

        // Calculate statistics
        const stats = {
            total_jobs: userJobs.length,
            completed_jobs: userJobs.filter(job => job.status === 'completed').length,
            failed_jobs: userJobs.filter(job => job.status === 'failed').length,
            running_jobs: userJobs.filter(job => job.status === 'running').length,
            cancelled_jobs: userJobs.filter(job => job.status === 'cancelled').length
        };

        // Calculate success rate
        const finishedJobs = stats.completed_jobs + stats.failed_jobs;
        stats.success_rate = finishedJobs > 0 ? (stats.completed_jobs / finishedJobs) * 100 : 0;

        // Get recent activity (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentJobs = userJobs.filter(job => new Date(job.started_at) > oneDayAgo);
        stats.recent_jobs = recentJobs.length;

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Failed to get restore stats:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore statistics'
        });
    }
});

/**
 * Clean up old completed restore jobs (maintenance endpoint)
 * POST /api/restore/cleanup
 */
router.post('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { olderThanDays = 30 } = req.body;
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
        let cleanedCount = 0;

        // Clean up old completed/failed/cancelled jobs
        for (const [jobId, job] of restoreJobs.entries()) {
            if (job.status !== 'running' && new Date(job.started_at) < cutoffDate) {
                restoreJobs.delete(jobId);
                cleanedCount++;
            }
        }

        res.json({
            success: true,
            data: {
                message: `Cleaned up ${cleanedCount} old restore jobs`,
                cleaned_count: cleanedCount
            }
        });
    } catch (error) {
        console.error('Failed to cleanup restore jobs:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to cleanup restore jobs'
        });
    }
});

/**
 * Restore files/directories to a specific destination path
 * POST /api/restore/to-path
 * 
 * This endpoint allows restoring specific files or entire directories
 * from an archive to a user-specified destination.
 */
router.post('/to-path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            repository,
            archive,
            sourcePaths = [],      // Paths within the archive to restore
            destinationPath,        // Where to restore to
            preserveStructure = true // Keep original directory structure
        } = req.body;

        // Validation
        if (!repository || !archive) {
            return res.status(400).json({
                success: false,
                detail: 'Repository and archive parameters are required'
            });
        }

        if (!destinationPath) {
            return res.status(400).json({
                success: false,
                detail: 'Destination path is required'
            });
        }

        // Security: Prevent path traversal
        if (destinationPath.includes('..') || destinationPath.includes('\0') || destinationPath.includes('\n') || destinationPath.includes('\r')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid destination path: path traversal not allowed'
            });
        }

        // Security: Validate archive name
        const dangerousChars = /[;&|`$()<>]/;
        if (dangerousChars.test(archive)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid characters in archive name'
            });
        }

        console.log(`📂 [Restore] Restoring from "${archive}" to "${destinationPath}"`);
        console.log(`📂 [Restore] Source paths: ${sourcePaths.length > 0 ? sourcePaths.join(', ') : 'entire archive'}`);

        // Enforce restore roots (avoid overwriting arbitrary filesystem paths)
        const resolvedDestination = path.resolve(destinationPath);
        if (!isUnderAllowedRoots(resolvedDestination)) {
            return res.status(403).json({
                success: false,
                detail: `Destination path not allowed. Allowed roots: ${getRestoreAllowedRoots().join(', ')}`
            });
        }

        // Check if destination exists and is writable
        try {
            await fs.ensureDir(resolvedDestination);
            await fs.access(resolvedDestination, fs.constants.W_OK);
        } catch (err) {
            return res.status(400).json({
                success: false,
                detail: `Destination path is not writable: ${err.message}`
            });
        }

        // Get passphrase for repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repository);
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }

        // Build borg extract command
        const cleanedSourcePaths = Array.isArray(sourcePaths) ? sourcePaths : [];
        for (const p of cleanedSourcePaths) {
            if (!validateArchiveItemPath(p)) {
                return res.status(400).json({ success: false, detail: 'Invalid source path' });
            }
        }

        const borgPaths = cleanedSourcePaths.map((p) => (p.startsWith('/') ? p.slice(1) : p));
        for (const p of borgPaths) {
            if (!validateArchiveItemPath(p)) {
                return res.status(400).json({ success: false, detail: 'Invalid source path' });
            }
        }

        // Detect Borg version for this repository
        let borgVersion = '1.x';
        try {
            borgVersion = await detectBorgVersion(repository);
            console.log(`📦 Detected Borg version: ${borgVersion}`);
        } catch (err) {
            console.warn('Could not detect borg version, defaulting to 1.x:', err.message);
        }

        // Get repository info for Hetzner remote-path and SSH auth
        const configParserV2 = require('../services/config-parser');
        const allReposV2 = await configParserV2.getAllRepositoriesWithUsage();
        const repoV2 = allReposV2.find(r => r.path === repository);
        
        // Set up SSH authentication if this is an SSH repository
        const isSSHRepo = repository.startsWith('ssh://');
        if (isSSHRepo) {
            try {
                if (repoV2) {
                    const authMethod = repoV2.ssh_auth_method || (repoV2.ssh_key_id ? 'key' : 'password');

                    if (authMethod === 'key' && repoV2.ssh_key_id) {
                        const sshKeysAPI = require('../services/ssh-keys');
                        const sshKey = await sshKeysAPI.getSSHKey(repoV2.ssh_key_id);

                        if (sshKey && sshKey.private_key) {
                            const config = require('../config');
                            const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
                            await fs.ensureDir(sshKeyDir);

                            const keyFilename = `restore_v2_key_${repoV2.ssh_key_id}`;
                            const keyPath = path.join(sshKeyDir, keyFilename);
                            await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });

                            const sshMatch = repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';

                            if (sshKey.is_encrypted && sshKey.passphrase) {
                                const askpassScript = path.join(sshKeyDir, `askpass_restore_v2_${repoV2.ssh_key_id}.sh`);
                                const escapedPassphrase = sshKey.passphrase.replace(/'/g, "'\"'\"'");
                                await fs.writeFile(askpassScript, `#!/bin/sh\necho '${escapedPassphrase}'\n`, { mode: 0o700 });
                                env.SSH_ASKPASS = askpassScript;
                                env.SSH_ASKPASS_REQUIRE = 'force';
                                env.DISPLAY = ':0';
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${port}`;
                            } else {
                                env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${port}`;
                            }
                            console.log(`🔑 [Restore V2] Using SSH key authentication`);
                        }
                    } else if (authMethod === 'password') {
                        const repositoryCredentials = require('../services/repository-credentials');
                        const sshPassword = await repositoryCredentials.getSSHPassword(repository);
                        if (sshPassword) {
                            const sshMatch = repository.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                            const port = sshMatch?.[3] || '22';
                            env.SSHPASS = sshPassword;
                            env.BORG_RSH = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p ${port}`;
                            console.log(`🔐 [Restore V2] Using SSH password authentication`);
                        }
                    }
                }
            } catch (sshError) {
                console.warn(`⚠️ [Restore V2] Failed to set up SSH auth:`, sshError.message);
            }
        }

        // Get the correct borg command based on version
        // For Hetzner Storage Boxes, include --remote-path
        const { command: borgCmd, args } = getBorgCommand(borgVersion, 'extract', {
            repoPath: repository,
            archiveName: archive,
            extraArgs: borgPaths,
            remotePath: repoV2?.hetzner_borg_version, // For Hetzner Storage Boxes
        });

        // Execute restore
        const startTime = Date.now();
        const result = await execa(borgCmd, args, {
            env,
            cwd: resolvedDestination,
            timeout: 1800000 // 30 minutes
        }).then(({ stdout, stderr }) => ({
            success: true,
            stdout,
            stderr
        })).catch((error) => ({
            success: false,
            error: error.message,
            stderr: error.stderr || error.stdout || ''
        }));

        const duration = Date.now() - startTime;

        if (result.success) {
            console.log(`✅ [Restore] Completed in ${duration}ms`);

            // List restored files (first 100)
            let restoredFiles = [];
            try {
                const listFiles = async (dir, baseDir = dir) => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    const files = [];
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        const relativePath = path.relative(baseDir, fullPath);
                        if (entry.isDirectory()) {
                            files.push({ path: relativePath, type: 'directory' });
                            if (files.length < 100) {
                                files.push(...(await listFiles(fullPath, baseDir)));
                            }
                        } else {
                            files.push({ path: relativePath, type: 'file' });
                        }
                        if (files.length >= 100) break;
                    }
                    return files;
                };
                restoredFiles = await listFiles(destinationPath);
            } catch (err) {
                console.warn('Could not list restored files:', err.message);
            }

            res.json({
                success: true,
                data: {
                    message: 'Restore completed successfully',
                    repository,
                    archive,
                    destination: resolvedDestination,
                    sourcePaths,
                    duration_ms: duration,
                    restored_files: restoredFiles.slice(0, 50),
                    total_restored: restoredFiles.length
                }
            });
        } else {
            console.error(`❌ [Restore] Failed: ${result.error}`);
            res.status(500).json({
                success: false,
                detail: result.error || 'Restore operation failed',
                stderr: result.stderr
            });
        }
    } catch (error) {
        console.error('Failed to restore to path:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to restore files'
        });
    }
});

/**
 * Browse filesystem for restore destination selection
 * GET /api/restore/browse-filesystem
 * Query params: path (default: /)
 */
router.get('/browse-filesystem', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const browsePath = req.query.path || '/';

        // Security: Prevent path traversal
        if (browsePath.includes('..') || browsePath.includes('\0') || browsePath.includes('\n') || browsePath.includes('\r')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid path: path traversal not allowed'
            });
        }

        // Resolve to absolute path
        const absolutePath = path.resolve(browsePath);

        const allowedRootsForBrowse = getRestoreAllowedRoots();
        const rootIsAllowed = allowedRootsForBrowse.some((r) => path.resolve(r) === '/');

        // Special case: browsing root "/" - show only allowed roots as virtual entries,
        // UNLESS "/" itself is an allowed root (non-Docker mode), in which case we fall
        // through to the normal directory listing below.
        if (absolutePath === '/' && !rootIsAllowed) {
            console.log(`📂 [Filesystem] Browsing root - showing allowed roots`);
            const allowedRoots = allowedRootsForBrowse;
            const items = [];

            for (const rootPath of allowedRoots) {
                try {
                    if (await fs.pathExists(rootPath)) {
                        const stats = await fs.stat(rootPath);
                        if (stats.isDirectory()) {
                            const isWritable = await fs.access(rootPath, fs.constants.W_OK).then(() => true).catch(() => false);
                            items.push({
                                name: rootPath.replace(/^\//, ''), // Remove leading slash for display
                                path: rootPath,
                                type: 'directory',
                                size: 0,
                                modified: stats.mtime,
                                writable: isWritable
                            });
                        }
                    }
                } catch (e) {
                    // Skip roots that don't exist or aren't accessible
                    continue;
                }
            }

            // Sort by name
            items.sort((a, b) => a.name.localeCompare(b.name));

            return res.json({
                success: true,
                data: {
                    current_path: '/',
                    parent_path: null,
                    is_writable: false,
                    items: items,
                    can_create: false,
                    in_docker: isRunningInDocker()
                }
            });
        }

        // Enforce allowed roots to avoid exposing arbitrary filesystem structure
        if (!isUnderAllowedRoots(absolutePath)) {
            return res.status(403).json({
                success: false,
                detail: `Path not allowed. Allowed roots: ${getRestoreAllowedRoots().join(', ')}`
            });
        }

        console.log(`📂 [Filesystem] Browsing: ${absolutePath}`);

        // Check if path exists
        if (!await fs.pathExists(absolutePath)) {
            return res.status(404).json({
                success: false,
                detail: 'Path does not exist'
            });
        }

        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
            return res.status(400).json({
                success: false,
                detail: 'Path is not a directory'
            });
        }

        // Check if writable
        let isWritable = false;
        try {
            await fs.access(absolutePath, fs.constants.W_OK);
            isWritable = true;
        } catch (e) {
            isWritable = false;
        }

        // List directory contents
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });
        const items = [];

        for (const entry of entries) {
            // Skip hidden files/directories
            if (entry.name.startsWith('.')) continue;

            const fullPath = path.join(absolutePath, entry.name);

            try {
                const entryStats = await fs.stat(fullPath);
                items.push({
                    name: entry.name,
                    path: fullPath,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size: entryStats.size,
                    modified: entryStats.mtime,
                    writable: entry.isDirectory() ? await fs.access(fullPath, fs.constants.W_OK).then(() => true).catch(() => false) : false
                });
            } catch (e) {
                // Skip entries we can't stat
                continue;
            }
        }

        // Sort: directories first, then by name
        items.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        // Calculate parent path
        const parentPath = absolutePath === '/' ? null : path.dirname(absolutePath);

        res.json({
            success: true,
            data: {
                current_path: absolutePath,
                parent_path: parentPath,
                is_writable: isWritable,
                items: items.filter(i => i.type === 'directory'), // Only show directories for destination selection
                can_create: isWritable,
                in_docker: isRunningInDocker()
            }
        });
    } catch (error) {
        console.error('Failed to browse filesystem:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to browse filesystem'
        });
    }
});

/**
 * Read file content from filesystem
 * GET /api/restore/read-file
 * Query params: path (required)
 * Returns the text content of a file (useful for SSH keys, config files, etc.)
 */
router.get('/read-file', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const filePath = req.query.path;

        if (!filePath) {
            return res.status(400).json({
                success: false,
                detail: 'Path is required'
            });
        }

        // Security: Prevent path traversal
        if (filePath.includes('..') || filePath.includes('\0') || filePath.includes('\n') || filePath.includes('\r')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid path: path traversal not allowed'
            });
        }

        // Resolve to absolute path
        const absolutePath = path.resolve(filePath);

        // Enforce allowed roots
        if (!isUnderAllowedRoots(absolutePath)) {
            return res.status(403).json({
                success: false,
                detail: `Path not allowed. Allowed roots: ${getRestoreAllowedRoots().join(', ')}`
            });
        }

        // Check if file exists and is a file (not directory)
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) {
            return res.status(400).json({
                success: false,
                detail: 'Path is not a file'
            });
        }

        // Limit file size to 1MB for safety
        const maxSize = 1024 * 1024; // 1MB
        if (stats.size > maxSize) {
            return res.status(400).json({
                success: false,
                detail: 'File too large (max 1MB)'
            });
        }

        console.log(`📄 [Filesystem] Reading file: ${absolutePath}`);
        const content = await fs.readFile(absolutePath, 'utf8');

        res.json({
            success: true,
            data: {
                path: absolutePath,
                content: content,
                size: stats.size
            }
        });
    } catch (error) {
        console.error('Failed to read file:', error.message);
        if (error.code === 'ENOENT') {
            return res.status(404).json({
                success: false,
                detail: 'File not found'
            });
        }
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to read file'
        });
    }
});

/**
 * Create a new directory (for restore destination)
 * POST /api/restore/create-directory
 */
router.post('/create-directory', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: dirPath, name } = req.body;

        if (!dirPath || !name) {
            return res.status(400).json({
                success: false,
                detail: 'Path and name are required'
            });
        }

        // Security: Prevent path traversal
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid directory name'
            });
        }

        const newDirPath = path.join(dirPath, name);
        const resolvedNewDirPath = path.resolve(newDirPath);

        // Enforce allowed roots
        if (!isUnderAllowedRoots(resolvedNewDirPath)) {
            return res.status(403).json({
                success: false,
                detail: `Destination not allowed. Allowed roots: ${getRestoreAllowedRoots().join(', ')}`
            });
        }

        // Check if parent exists and is writable
        if (!await fs.pathExists(dirPath)) {
            return res.status(400).json({
                success: false,
                detail: 'Parent directory does not exist'
            });
        }

        try {
            await fs.access(dirPath, fs.constants.W_OK);
        } catch (e) {
            return res.status(403).json({
                success: false,
                detail: 'Parent directory is not writable'
            });
        }

        // Create the directory
        await fs.mkdir(resolvedNewDirPath, { recursive: true });
        console.log(`📁 Created directory: ${resolvedNewDirPath}`);

        res.json({
            success: true,
            data: {
                path: resolvedNewDirPath,
                message: 'Directory created successfully'
            }
        });
    } catch (error) {
        console.error('Failed to create directory:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to create directory'
        });
    }
});

/**
 * Extract configuration files from archive
 * POST /api/restore/config-bootstrap
 */
router.post('/config-bootstrap', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repository, archive, destination } = req.body;

        if (!repository) {
            return res.status(400).json({
                success: false,
                detail: 'Repository parameter is required'
            });
        }

        // Get passphrase from config if needed
        let passphrase = null;
        try {
            const config = await borgmaticConfig.loadConfig();
            passphrase = config.storage?.encryption_passphrase || null;
        } catch (error) {
            console.warn('Could not retrieve passphrase:', error.message);
        }

        const options = {
            archive: archive || 'latest',
            destination,
            passphrase
        };

        const result = await borgmaticCLI.configBootstrap(repository, options);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                detail: `Failed to bootstrap config: ${result.error || result.stderr}`
            });
        }

        res.json({
            success: true,
            data: {
                message: 'Configuration files extracted successfully',
                repository: repository,
                archive: options.archive,
                destination: destination,
                command: result.command,
                output: result.stdout
            }
        });
    } catch (error) {
        console.error('Failed to bootstrap config:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to bootstrap configuration files'
        });
    }
});

// ============================================================================
// Restore History Endpoints
// ============================================================================

/**
 * GET /api/restore/history
 * Get all restore history or filter by repository
 */
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const { repository } = req.query;

        let history;
        if (repository) {
            history = await restoreHistory.getRepositoryHistory(repository);
        } else {
            history = await restoreHistory.getAllHistory();
        }

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Failed to get restore history:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore history'
        });
    }
});

/**
 * GET /api/restore/history/:archiveName
 * Get restore history for a specific archive
 */
router.get('/history/:archiveName', authenticateToken, async (req, res) => {
    try {
        const { archiveName } = req.params;
        const history = await restoreHistory.getArchiveHistory(archiveName);

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Failed to get archive restore history:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get restore history'
        });
    }
});

/**
 * POST /api/restore/history
 * Record a restore operation
 */
router.post('/history', authenticateToken, async (req, res) => {
    try {
        const { archiveName, repoPath, destination, destinationType, paths } = req.body;

        if (!archiveName) {
            return res.status(400).json({
                success: false,
                detail: 'archiveName is required'
            });
        }

        const record = await restoreHistory.recordRestore(archiveName, {
            repoPath,
            destination,
            destinationType,
            paths
        });

        res.json({
            success: true,
            data: record
        });
    } catch (error) {
        console.error('Failed to record restore history:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to record restore history'
        });
    }
});

module.exports = router;
