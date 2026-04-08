const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');
const backupManager = require('./backup-manager');
const { eventManager } = require('../routes/events');
const passwordManager = require('./password-manager');
const logManager = require('./log-manager');
const notificationRouter = require('./notification-router');
const fs = require('fs-extra');

/**
 * Backup Executor Service
 * Manages running backup jobs and tracks their status
 * Leverages borgmatic's built-in JSON output and monitoring features
 */
class BackupExecutor {
    constructor() {
        this.runningBackups = new Map(); // backupId => { startTime, process, status, output }
    }

    /**
     * Check if a backup is currently running
     */
    isBackupRunning(backupId) {
        return this.runningBackups.has(backupId);
    }

    /**
     * Get all currently running backups
     */
    getRunningBackups() {
        const running = [];
        for (const [backupId, info] of this.runningBackups.entries()) {
            running.push({
                backup_id: backupId,
                backup_name: info.backup.name,
                started_at: info.startTime,
                status: info.status,
                duration: Date.now() - new Date(info.startTime).getTime()
            });
        }
        return running;
    }

    /**
     * Execute a backup manually using borgmatic with JSON output
     */
    async executeBackup(backupId) {
        // Check if already running
        if (this.isBackupRunning(backupId)) {
            throw new Error('Backup is already running. Please wait for it to complete.');
        }

        let backup = null;
        try {
            // Get backup configuration
            backup = await backupManager.getBackup(backupId);
            const configPath = path.join(
                config.configDir,
                'borgmatic.d',
                backup.filename
            );

            const startTime = new Date().toISOString();

            // Mark as running
            this.runningBackups.set(backupId, {
                startTime,
                status: 'running',
                backup,
                output: [],
                process: null,
                tempFiles: [] // Track temp files for cleanup (e.g., askpass scripts)
            });

            // Extract repository paths from backup config (MOVED UP - needed for notifications)
            const repositories = backup.repositories_summary || backup.config?.location?.repositories || [];

            // Check if any repository is read-only (monitor only)
            const configParser = require('./config-parser');
            const allRepos = await configParser.getAllRepositoriesWithUsage();
            for (const repoConfig of repositories) {
                const repoPath = repoConfig.path || repoConfig;
                const repo = allRepos.find(r => r.path === repoPath);
                if (repo && repo.read_only) {
                    throw new Error(`Cannot run backup: Repository "${repo.name || repoPath}" is in read-only (monitor only) mode. Read-only repositories can only be used for viewing and restoring archives.`);
                }
            }

            // Broadcast start event via SSE
            eventManager.broadcastEvent('backup_started', {
                backup_id: backupId,
                backup_name: backup.name,
                started_at: startTime,
                repositories: backup.repository_count,
                sources: backup.source_count
            });

            // Send notification through router (handles both local and director)
            const repository = repositories.length > 0 ? (repositories[0].path || repositories[0]) : null;
            notificationRouter.notifyBackupStarted(backup.name, repository).catch(err => {
                console.warn('Failed to send backup started notification:', err.message);
            });

            console.log(`🚀 Starting backup: ${backup.name} (${backupId})`);

            // Get repository passphrases and SSH credentials
            const env = { ...process.env };
            const repositoryCredentials = require('./repository-credentials');
            // NOTE: configParser already required above (used for read-only validation)
            
            // For each repository, get its passphrase and SSH credentials
            // If multiple repos use different passphrases, borgmatic will prompt
            // For now, use the first repository's passphrase as the default
            if (repositories.length > 0) {
                const repoPath = repositories[0].path || repositories[0];
                try {
                    const passphrase = await passwordManager.getRepositoryPassphrase(repoPath);
                    if (passphrase) {
                        env.BORG_PASSPHRASE = passphrase;
                        console.log(`🔑 Using stored passphrase for repository: ${repoPath}`);
                    } else {
                        console.warn(`⚠️  No passphrase found for repository: ${repoPath}`);
                    }
                } catch (error) {
                    console.warn(`⚠️  Error retrieving passphrase for ${repoPath}:`, error.message);
                }
                
                // Check if repository uses SSH authentication (key or password)
                try {
                    const allRepos = await configParser.getAllRepositoriesWithUsage();
                    console.log(`🔍 Looking for repo with path: ${repoPath}`);
                    console.log(`🔍 Available repos:`, allRepos.map(r => ({ path: r.path, type: r.repository_type, ssh_key_id: r.ssh_key_id })));
                    const repo = allRepos.find(r => r.path === repoPath);
                    
                    if (repo) {
                        console.log(`🔍 Found repo:`, { 
                            path: repo.path, 
                            type: repo.repository_type, 
                            ssh_key_id: repo.ssh_key_id,
                            ssh_auth_method: repo.ssh_auth_method
                        });
                    } else {
                        console.log(`⚠️ No repo found with exact path match. Trying normalized path...`);
                    }
                    
                    if (repo && (repo.repository_type === 'ssh' || repo.repository_type === 'sftp' || repo.repository_type === 'hetzner')) {
                        const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');
                        
                        // Extract port from repo path
                        const sshMatch = repoPath.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        const port = sshMatch?.[3] || '22';
                        
                        if (authMethod === 'key' && repo.ssh_key_id) {
                            // SSH key authentication
                            const sshKeysAPI = require('./ssh-keys');
                            const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
                            
                            if (sshKey && sshKey.private_key) {
                                // Write key to data directory for borgmatic to use
                                const config = require('../config');
                                const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
                                await fs.ensureDir(sshKeyDir);
                                
                                // Use consistent filename based on key ID
                                const keyFilename = `borgmatic_key_${repo.ssh_key_id}`;
                                const keyPath = path.join(sshKeyDir, keyFilename);
                                await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });
                                
                                // Handle encrypted keys with passphrase
                                // sshpass only works for SSH password auth, NOT for SSH key passphrases
                                // For encrypted keys, we need to use SSH_ASKPASS mechanism
                                if (sshKey.is_encrypted && sshKey.passphrase) {
                                    // Create an askpass script that echoes the passphrase
                                    // This is the standard way to provide passphrases to SSH non-interactively
                                    const askpassScript = path.join(sshKeyDir, `askpass_${repo.ssh_key_id}.sh`);
                                    // Escape the passphrase for shell (handle single quotes)
                                    const escapedPassphrase = sshKey.passphrase.replace(/'/g, "'\"'\"'");
                                    await fs.writeFile(askpassScript, `#!/bin/sh\necho '${escapedPassphrase}'\n`, { mode: 0o700 });
                                    
                                    env.SSH_ASKPASS = askpassScript;
                                    env.SSH_ASKPASS_REQUIRE = 'force'; // Force use of SSH_ASKPASS even without TTY
                                    env.DISPLAY = ':0'; // Required for SSH_ASKPASS (even if no display exists)
                                    
                                    // Note: Don't use BatchMode=yes - it prevents SSH_ASKPASS from being used
                                    env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${port}`;
                                    console.log(`🔐 Using SSH key authentication (encrypted key with SSH_ASKPASS) for repository: ${repoPath}`);
                                } else {
                                    // Non-encrypted key - BatchMode=yes is safe
                                    env.BORG_RSH = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${port}`;
                                    console.log(`🔑 Using SSH key authentication for repository: ${repoPath}`);
                                }
                            } else {
                                console.warn(`⚠️  SSH key ${repo.ssh_key_id} not found for repository: ${repoPath}`);
                            }
                        } else if (authMethod === 'password') {
                            const sshPassword = await repositoryCredentials.getSSHPassword(repoPath);
                            if (sshPassword) {
                                // Set ssh_command to use sshpass for password authentication
                                // Use SSHPASS environment variable instead of command line to avoid password exposure in process list
                                env.SSHPASS = sshPassword;
                                env.BORG_RSH = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p ${port}`;
                                console.log(`🔐 Using SSH password authentication for repository: ${repoPath}`);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️  Error retrieving SSH credentials for ${repoPath}:`, error.message);
                }
            }

            // Pre-backup lock check with auto-break option.
            // Use direct Borg probing instead of config-parser fields, since config-parser
            // doesn't compute transient lock state.
            const autoBreakLock = backup.auto_break_lock === true;
            const { getBorgCommand } = require('./borg-version-detector');
            const { execa } = require('execa');
            const borgmaticCLI = require('./borgmatic-cli');
            const isLockError = (stderr, exitCode) => {
                if (exitCode === 105) return true;
                if (!stderr) return false;
                const lower = String(stderr).toLowerCase();
                // Don't misclassify permission errors as lock errors.
                if (lower.includes('permission denied') || lower.includes('errno 13') || lower.includes('eacces')) {
                    return false;
                }
                const lockPatterns = [
                    'failed to create/acquire the lock',
                    'lock held by',
                    'repository is already locked',
                    'lockerror',
                    'locktimeout',
                    'lockfailed',
                    'lock.exclusive',
                    'another instance is already running',
                    'lock timed out',
                    'waiting for lock',
                    'could not acquire lock'
                ];
                return lockPatterns.some((p) => lower.includes(p));
            };

            for (const repoConfig of repositories) {
                const repoPathForCheck = repoConfig.path || repoConfig;
                const repo = allRepos.find(r => r.path === repoPathForCheck);
                const repoLabel = repo?.label || repo?.name || repoPathForCheck;

                try {
                    const borgVersion = repo?.borg_version || '1.x';
                    const { command, args } = getBorgCommand(borgVersion, 'info', {
                        repoPath: repoPathForCheck,
                        extraArgs: ['--lock-wait=1'],
                        remotePath: repo?.hetzner_borg_version,
                    });
                    const isRemoteRepo = repoPathForCheck.includes('ssh://') || repoPathForCheck.includes('@');
                    const probeResult = await execa(command, args, {
                        env,
                        timeout: isRemoteRepo ? 30000 : 10000,
                        reject: false,
                    });

                    if (isLockError(probeResult.stderr, probeResult.exitCode)) {
                        console.warn(`⚠️ Repository "${repoLabel}" is locked`);
                        console.warn(`   Lock error: ${probeResult.stderr || `Exit code ${probeResult.exitCode}`}`);

                        notificationRouter.notifyBackupWarning(
                            backup.name,
                            repoPathForCheck,
                            `Repository "${repoLabel}" is locked`
                        ).catch(err => {
                            console.warn('Failed to send lock warning notification:', err.message);
                        });

                        if (autoBreakLock) {
                            console.log(`🔓 Auto-break lock enabled - attempting to break lock on "${repoLabel}"...`);
                            try {
                                const breakResult = await borgmaticCLI.breakLock(repoPathForCheck, {
                                    timeout: 30000,
                                    env
                                });

                                if (breakResult.success) {
                                    console.log(`✅ Successfully broke lock on "${repoLabel}"`);
                                    notificationRouter.notifyBackupWarning(
                                        backup.name,
                                        repoPathForCheck,
                                        `Auto-broke stale lock on "${repoLabel}"`
                                    ).catch(() => {});
                                } else {
                                    console.error(`❌ Failed to break lock on "${repoLabel}": ${breakResult.error || breakResult.stderr}`);
                                    notificationRouter.notifyBackupWarning(
                                        backup.name,
                                        repoPathForCheck,
                                        `Failed to auto-break lock on "${repoLabel}": ${breakResult.error || 'Unknown error'}`
                                    ).catch(() => {});
                                }
                            } catch (breakError) {
                                console.error(`❌ Error breaking lock on "${repoLabel}":`, breakError.message);
                            }
                        } else {
                            console.warn('   Auto-break not enabled. Enable "Auto-break stale locks" in backup settings to automatically resolve.');
                            console.warn('   Or use the "Break Lock" button in the Repositories page.');
                        }
                    }
                } catch (lockProbeError) {
                    // Non-fatal: lock probing is best-effort and should not block backup start.
                    console.warn(`⚠️ Could not probe lock status for "${repoLabel}":`, lockProbeError.message);
                }
            }

            // Inject DB passwords from password-manager (encrypted at rest) for configs that reference them via env vars.
            // We scan the YAML for placeholders like ${BORGMATIC_UI_DB_PASS_*} and populate those env vars.
            try {
                const yamlText = await fs.readFile(configPath, 'utf8');
                const matches = Array.from(yamlText.matchAll(/\$\{(BORGMATIC_UI_DB_PASS_[A-Za-z0-9_]+)\}/g)).map(m => m[1]);
                const uniqueEnvVars = Array.from(new Set(matches));
                
                if (uniqueEnvVars.length > 0) {
                    const passwordManager = require('./password-manager');
                    let loadedCount = 0;
                    
                    for (const varName of uniqueEnvVars) {
                        try {
                            const creds = await passwordManager.getDatabaseCredentials(varName);
                            
                            if (creds) {
                                const pw = creds?.credentials?.password;
                                if (pw) {
                                    env[varName] = pw;
                                    loadedCount++;
                                } else {
                                    console.warn(`⚠️  DB credentials found but no password property for ${varName}. Keys: ${Object.keys(creds?.credentials || {}).join(', ')}`);
                                }
                            } else {
                                console.warn(`⚠️  No DB credentials found in vault for ${varName}`);
                            }
                        } catch (e) {
                            console.warn(`⚠️  Could not load DB password for ${varName}:`, e.message);
                        }
                    }
                    console.log(`🔐 Loaded ${loadedCount}/${uniqueEnvVars.length} DB password entries from vault`);
                }
            } catch (e) {
                console.warn('⚠️  Could not scan config for DB password placeholders:', e.message);
            }

            // Get log settings
            const logSettings = await logManager.getSettings();
            
            // Detect if this backup has database sources (non-local).
            // borgmatic's --json and --stats flags trigger internal JSON parsing
            // that is incompatible with database hooks, causing
            // "Expecting value: line 1 column 1" crashes during prune/compact.
            const hasDatabaseSources = (backup.sources_summary || []).some(
                s => s.type && s.type !== 'local'
            );

            const args = [
                '--config', configPath,
            ];

            if (hasDatabaseSources) {
                // Database backups: text output only (--verbosity 1).
                // --json and --stats both trigger internal JSON parsing in borgmatic
                // that crashes with "Expecting value" during prune/compact when
                // database hooks are active.
                args.push('--verbosity', '1');
            } else {
                // File-only backups: safe to use --stats and --json for richer output.
                args.push('--verbosity', '1', '--stats', '--json');
            }
            
            // Add logging options if enabled
            if (logSettings.enabled && logSettings.log_to_file) {
                const logPath = logManager.getBorgmaticLogPath();
                args.push('--log-file', logPath);
                args.push('--log-file-verbosity', logSettings.log_level === 'debug' ? '2' : '1');
                
                // Rotate log if needed before starting backup
                await logManager.rotateLogIfNeeded(logPath);
            }
            
            // Add actions
            args.push('create', 'prune', 'compact');

            return new Promise((resolve, reject) => {
                const childProcess = spawn('borgmatic', args, {
                    env,
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                // Store process reference
                const runningInfo = this.runningBackups.get(backupId);
                if (runningInfo) {
                    runningInfo.process = childProcess;
                }

                let stdoutData = '';
                let stderrData = '';

                // Capture stdout (includes JSON output)
                childProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    stdoutData += output;
                    
                    // Send progress updates via SSE
                    eventManager.broadcastEvent('backup_progress', {
                        backup_id: backupId,
                        backup_name: backup.name,
                        output: output.trim(),
                        timestamp: new Date().toISOString()
                    });

                    if (runningInfo) {
                        runningInfo.output.push(output.trim());
                    }
                });

                // Capture stderr (error messages)
                childProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                });

                // Handle process completion
                childProcess.on('close', async (code) => {
                    const duration = Date.now() - new Date(startTime).getTime();
                    
                    try {
                        if (code === 0) {
                            // Success
                            console.log(`✅ Backup completed: ${backup.name} (${Math.round(duration / 1000)}s)`);
                            
                            // Parse JSON output if available
                            let jsonOutput = null;
                            try {
                                const jsonMatch = stdoutData.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    jsonOutput = JSON.parse(jsonMatch[0]);
                                }
                            } catch (parseError) {
                                console.warn('Could not parse borgmatic JSON output:', parseError.message);
                            }

                            // Update metadata
                            try {
                                await backupManager.updateBackupMetadata(backupId, {
                                    last_run: new Date().toISOString(),
                                    last_run_status: 'success'
                                });
                            } catch (metaError) {
                                console.error('Failed to update backup metadata:', metaError.message);
                            }

                            // Broadcast completion event via SSE
                            console.log(`📡 Broadcasting backup_completed event for: ${backup.name}`);
                            eventManager.broadcastEvent('backup_completed', {
                                backup_id: backupId,
                                backup_name: backup.name,
                                completed_at: new Date().toISOString(),
                                status: 'success',
                                duration,
                                output: jsonOutput || stdoutData,
                                stats: jsonOutput?.statistics || null
                            });
                            console.log(`✅ backup_completed event broadcasted for: ${backup.name}`);

                            // Send notification through router (handles both local and director)
                            notificationRouter.notifyBackupCompleted(backup.name, repository, { 
                                duration, 
                                stats: jsonOutput?.statistics || null 
                            }).catch(err => {
                                console.warn('Failed to send backup completed notification:', err.message);
                            });

                            // Remove from running
                            this.runningBackups.delete(backupId);

                            resolve({
                                success: true,
                                output: stdoutData,
                                jsonOutput,
                                duration
                            });
                        } else {
                            // Failure
                            console.error(`❌ Backup failed: ${backup.name} (exit code: ${code})`);

                            // Update metadata with error
                            await backupManager.updateBackupMetadata(backupId, {
                                last_run: new Date().toISOString(),
                                last_run_status: 'failed'
                            });

                            // Broadcast failure event via SSE
                            console.log(`📡 Broadcasting backup_failed event for: ${backup.name}`);
                            eventManager.broadcastEvent('backup_failed', {
                                backup_id: backupId,
                                backup_name: backup.name,
                                completed_at: new Date().toISOString(),
                                status: 'failed',
                                error: stderrData || `Process exited with code ${code}`,
                                duration
                            });

                            // Send notification through router (handles both local and director)
                            notificationRouter.notifyBackupFailed(
                                backup.name, 
                                repository, 
                                stderrData || `Process exited with code ${code}`
                            ).catch(err => {
                                console.warn('Failed to send backup failed notification:', err.message);
                            });

                            // Remove from running
                            this.runningBackups.delete(backupId);

                            reject(new Error(`Backup failed with exit code ${code}: ${stderrData}`));
                        }
                    } catch (handlerError) {
                        console.error(`❌ Error in backup completion handler: ${backup.name}`, handlerError);
                        this.runningBackups.delete(backupId);
                        reject(handlerError);
                    }
                });

                // Handle process errors
                childProcess.on('error', async (error) => {
                    console.error(`❌ Backup process error: ${backup.name}`, error);

                    await backupManager.updateBackupMetadata(backupId, {
                        last_run: new Date().toISOString(),
                        last_run_status: 'failed'
                    });

                    eventManager.broadcastEvent('backup_failed', {
                        backup_id: backupId,
                        backup_name: backup.name,
                        completed_at: new Date().toISOString(),
                        status: 'failed',
                        error: error.message,
                        duration: Date.now() - new Date(startTime).getTime()
                    });

                    // Send notification through router (handles both local and director)
                    notificationRouter.notifyBackupFailed(
                        backup.name, 
                        repository, 
                        error.message
                    ).catch(err => {
                        console.warn('Failed to send backup failed notification:', err.message);
                    });

                    this.runningBackups.delete(backupId);

                    reject(error);
                });
            });

        } catch (error) {
            console.error(`❌ Failed to start backup: ${backupId}`, error.message);
            
            // Broadcast failure event via SSE (so UI stops loading)
            eventManager.broadcastEvent('backup_failed', {
                backup_id: backupId,
                backup_name: backup?.name || backupId,
                completed_at: new Date().toISOString(),
                status: 'failed',
                error: error.message,
                duration: 0
            });

            // Update metadata if we have backup info
            if (backup) {
                try {
                    await backupManager.updateBackupMetadata(backupId, {
                        last_run: new Date().toISOString(),
                        last_run_status: 'failed'
                    });
                } catch (metaError) {
                    console.error('Failed to update metadata:', metaError.message);
                }
            }

            this.runningBackups.delete(backupId);
            throw error;
        }
    }

    /**
     * Stop a running backup (send SIGTERM, then SIGKILL if needed)
     */
    async stopBackup(backupId) {
        if (!this.isBackupRunning(backupId)) {
            throw new Error('Backup is not running');
        }

        const info = this.runningBackups.get(backupId);
        
        if (info.process) {
            console.log(`🛑 Stopping backup: ${backupId}`);
            
            // Try graceful termination first
            info.process.kill('SIGTERM');
            
            // Force kill after 10 seconds if still running
            setTimeout(() => {
                if (this.isBackupRunning(backupId)) {
                    console.log(`💥 Force killing backup: ${backupId}`);
                    info.process.kill('SIGKILL');
                }
            }, 10000);
        }

        this.runningBackups.delete(backupId);

        eventManager.broadcastEvent('backup_stopped', {
            backup_id: backupId,
            backup_name: info.backup.name,
            stopped_at: new Date().toISOString()
        });
    }

    /**
     * Get backup status (for API endpoint)
     */
    getBackupStatus(backupId) {
        if (this.isBackupRunning(backupId)) {
            const info = this.runningBackups.get(backupId);
            return {
                running: true,
                started_at: info.startTime,
                duration: Date.now() - new Date(info.startTime).getTime(),
                status: info.status,
                backup_name: info.backup.name
            };
        }

        return {
            running: false
        };
    }
}

module.exports = new BackupExecutor();
