const express = require('express');
const router = express.Router();
const borgmaticCLI = require('../../services/borgmatic-cli');
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const configParser = require('../../services/config-parser');
const repositoryCredentials = require('../../services/repository-credentials');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { constructSSHPath, constructS3Path, constructNativeRclonePath, writeSSHKeyToFilesystem } = require('./helpers');
const {
    getDefaultEncryption,
    getEncryptionOptions,
    getBorgPath
} = require('../../services/borg-version-detector');
const { shellSingleQuote, isSafeRemotePath, testLogFileWrite } = require('./crud-helpers');

/**
 * Create a new repository
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        console.log('📝 Creating new repository...');
        const {
            name,
            path: repoPath,
            mount_path,
            local_path,
            storage_mode,
            encryption,
            compression,
            log_file_path,
            passphrase,
            repository_type,
            host,
            port,
            username,
            ssh_key_id,
            ssh_auth_method,
            ssh_password,
            rclone_remote,
            rclone_path,
            // S3 fields
            s3_endpoint,
            s3_bucket,
            s3_path,
            s3_region,
            s3_access_key,
            s3_secret_key,
            // Borg version (1.x or 2.x)
            borg_version,
            // Hetzner Storage Box: remote Borg version (borg-1.1, borg-1.2, borg-1.4)
            hetzner_borg_version
        } = req.body;

        if (!name) {
            return res.status(400).json({ detail: 'Repository name is required' });
        }

        // Test log file write before proceeding
        if (log_file_path) {
            const logTest = await testLogFileWrite(log_file_path);
            if (!logTest.success) {
                return res.status(400).json({
                    detail: logTest.error,
                    success: false
                });
            }
        }

        // Determine the actual repository path based on storage mode
        let actualRepoPath = repoPath;
        const isRclone = repository_type === 'rclone';
        const isS3 = repository_type === 's3';
        const isSync = storage_mode === 'sync';
        const isDirect = storage_mode === 'direct';
        const isNative = storage_mode === 'native';

        // For native Rclone mode (Borg 2.x only), construct rclone:remote:path
        if (isRclone && isNative) {
            if (!rclone_remote || !rclone_path) {
                return res.status(400).json({
                    detail: 'Rclone remote and path are required for native mode'
                });
            }
            // Native mode requires Borg 2.x
            if (borg_version !== '2.x') {
                return res.status(400).json({
                    detail: 'Native Rclone mode requires Borg 2.x. Please select Borg 2.x or use Sync/Direct mode.'
                });
            }
            actualRepoPath = constructNativeRclonePath(rclone_remote, rclone_path);
            console.log(`📦 Using native Rclone path (Borg 2.x): ${actualRepoPath}`);
        }
        // For S3 direct/native mode, construct S3 path with embedded credentials (works with Borg 2.x)
        else if (isS3 && (isDirect || isNative)) {
            if (!s3_access_key || !s3_secret_key || !s3_bucket) {
                return res.status(400).json({
                    detail: 'S3 access key, secret key, and bucket are required for direct/native mode'
                });
            }
            // S3 direct/native mode requires Borg 2.x (s3:key:secret@bucket format is Borg 2.x only)
            if (borg_version !== '2.x') {
                return res.status(400).json({
                    detail: 'S3 direct/native mode requires Borg 2.x. Please select Borg 2.x or use Sync mode with Rclone for Borg 1.x.'
                });
            }
            actualRepoPath = constructS3Path(
                s3_access_key,
                s3_secret_key,
                s3_bucket,
                s3_path || '/backups',
                s3_endpoint
            );
        }
        // For rclone/s3 in sync mode, use local_path as the repo path
        else if ((isRclone || isS3) && isSync) {
            actualRepoPath = local_path;
            if (!actualRepoPath) {
                return res.status(400).json({ detail: 'Local repository path is required for sync mode' });
            }
        }
        // For SSH/SFTP/Hetzner, construct SSH path (version-aware for Borg 1.x vs 2.x path syntax)
        else if ((repository_type === 'ssh' || repository_type === 'sftp' || repository_type === 'hetzner') && host && username) {
            const repoPathPart = repoPath || '/backups/repo';
            actualRepoPath = constructSSHPath(username, host, port || 22, repoPathPart, borg_version || '1.x');
        }

        if (!actualRepoPath) {
            return res.status(400).json({ detail: 'Repository path is required' });
        }

        // Check if repository with this path already exists
        try {
            const allRepositories = await configParser.getAllRepositoriesWithUsage();
            console.log(`🔍 Checking for duplicate repository at path: ${actualRepoPath}`);
            const existingRepo = allRepositories.find(repo => {
                if (!repo.path) return false;
                try {
                    // For SSH/SFTP/Hetzner/Rclone/S3, compare URLs directly (don't use path.normalize which mangles URLs)
                    // path.normalize would collapse // in ssh://host//path (Borg 2.x) and break the comparison
                    if (repository_type === 'ssh' || repository_type === 'sftp' || repository_type === 'hetzner' ||
                        repository_type === 'rclone' || repository_type === 's3') {
                        return repo.path === actualRepoPath;
                    }
                    // For local paths, normalize for consistent comparison
                    const normalizedExisting = path.normalize(repo.path);
                    const normalizedNew = path.normalize(actualRepoPath);
                    return normalizedExisting === normalizedNew;
                } catch (normalizeError) {
                    console.error('Error normalizing path:', normalizeError);
                    // Fallback to direct comparison
                    return repo.path === actualRepoPath;
                }
            });

            if (existingRepo) {
                console.log(`⚠️  Duplicate repository found: ${existingRepo.name} at ${existingRepo.path}`);
                return res.status(409).json({
                    detail: `A repository already exists at this location: ${actualRepoPath}. Please choose a different path or edit the existing repository "${existingRepo.name}".`,
                    success: false,
                    existingRepository: {
                        name: existingRepo.name,
                        path: existingRepo.path
                    }
                });
            }
            console.log(`✅ No duplicate repository found, proceeding with creation...`);
        } catch (duplicateCheckError) {
            console.error('❌ Error checking for duplicate repository:', duplicateCheckError);
            // Don't fail creation if duplicate check fails, but log it
            console.warn('⚠️  Continuing with repository creation despite duplicate check error');
        }

        // For SSH/SFTP/Hetzner repositories, don't resolve the path (it's a remote URL)
        // For local repositories, resolve to absolute path and check if it exists
        let resolvedPath;
        if (repository_type === 'ssh' || repository_type === 'sftp' || repository_type === 'hetzner') {
            // SSH paths are URLs, not local paths - don't resolve them
            resolvedPath = actualRepoPath;
        } else if (repository_type === 'local') {
            // Resolve to absolute path for local repositories
            resolvedPath = path.resolve(actualRepoPath);

            // Check if path exists, if not, try to create it
            const pathExists = await fs.pathExists(resolvedPath);
            if (!pathExists) {
                try {
                    console.log(`📁 Creating repository path: ${resolvedPath}`);
                    await fs.ensureDir(resolvedPath);

                    // Test write permissions
                    const testFile = path.join(resolvedPath, '.borgmatic-test-write');
                    await fs.writeFile(testFile, 'test');
                    await fs.remove(testFile);

                    console.log(`✅ Path created successfully: ${resolvedPath}`);
                } catch (createError) {
                    console.error('❌ Failed to create repository path:', createError.message);
                    return res.status(500).json({
                        detail: `Failed to create repository path: ${createError.message}. Please ensure you have permission to create directories at this location.`,
                        success: false
                    });
                }
            } else {
                // Path exists, verify write permissions
                try {
                    const testFile = path.join(resolvedPath, '.borgmatic-test-write');
                    await fs.writeFile(testFile, 'test');
                    await fs.remove(testFile);
                } catch (writeError) {
                    return res.status(403).json({
                        detail: `Repository path exists but is not writable: ${writeError.message}`,
                        success: false
                    });
                }
            }
        } else {
            // For other types (rclone, s3), use as-is
            resolvedPath = actualRepoPath;
        }

        // Block path traversal attempts (only for local paths)
        if (repository_type !== 'ssh' && repository_type !== 'sftp' && repository_type !== 'hetzner' && actualRepoPath.includes('..')) {
            return res.status(400).json({
                detail: 'Path traversal is not allowed in repository paths'
            });
        }

        // Block sensitive system paths (only for local repositories)
        if (repository_type !== 'ssh' && repository_type !== 'sftp' && repository_type !== 'hetzner') {
            const sensitivePatterns = [
                /^\/etc\//,
                /^\/root\//,
                /^\/boot\//,
                /^\/sys\//,
                /^\/proc\//,
                /^\/dev\//,
                /\/\.ssh\//,
                /\/\.gnupg\//
            ];

            for (const pattern of sensitivePatterns) {
                if (pattern.test(resolvedPath)) {
                    return res.status(403).json({
                        detail: 'Cannot create repository in system directories'
                    });
                }
            }

            // Update actualRepoPath to use resolved path (only for local repos)
            actualRepoPath = resolvedPath;
        }

        // Validate rclone inputs if provided
        if (isRclone) {
            // Validate remote name
            if (rclone_remote && !/^[a-zA-Z0-9_-]+$/.test(rclone_remote)) {
                return res.status(400).json({
                    detail: 'Invalid rclone remote name. Only alphanumeric characters, dashes, and underscores are allowed.'
                });
            }

            // Validate rclone path
            if (rclone_path) {
                const normalizedRclonePath = rclone_path.trim().replace(/^\/+/, '').replace(/\/+$/, '');

                if (normalizedRclonePath.includes('..')) {
                    return res.status(400).json({
                        detail: 'Path traversal is not allowed in rclone paths'
                    });
                }

                if (/[;&|`$()\\]/.test(normalizedRclonePath)) {
                    return res.status(400).json({
                        detail: 'Invalid characters in rclone path'
                    });
                }
            }
        }

        // Determine Borg version (default to 1.x for safety / backwards compatibility)
        const selectedBorgVersion = borg_version || '1.x';
        const borgPath = getBorgPath(selectedBorgVersion);

        // Validate encryption is provided for encrypted repositories
        // Use version-appropriate default encryption
        const encryptionMode = encryption || getDefaultEncryption(selectedBorgVersion);
        // Validate encryption mode against an allow-list for the selected Borg version
        const allowedEncryptions = new Set(getEncryptionOptions(selectedBorgVersion).map(o => o.value));
        if (!allowedEncryptions.has(encryptionMode)) {
            return res.status(400).json({
                detail: `Invalid encryption mode for Borg ${selectedBorgVersion}: ${encryptionMode}`
            });
        }
        if (encryptionMode !== 'none' && !passphrase) {
            return res.status(400).json({
                detail: 'Passphrase is required for encrypted repositories'
            });
        }

        console.log(`📦 Using Borg ${selectedBorgVersion} (${borgPath}) with encryption: ${encryptionMode}`);

        // Initialize the borg repository using borgmatic CLI
        const isDirectRclone = isRclone && storage_mode === 'direct';
        const isDirectS3 = isS3 && storage_mode === 'direct';
        const isHetzner = repository_type === 'hetzner';
        const isSSH = repository_type === 'ssh' || isHetzner;
        const isSFTP = repository_type === 'sftp';

        // Skip initialization for:
        // - Direct mode Rclone (requires mount)
        // - SSH repositories (must be initialized on remote system where Borg is installed)
        // SFTP repositories don't need Borg on remote, but initialization happens locally via SFTP mount
        if (!isDirectRclone && !isSSH) {
            console.log(`🔧 Initializing borg repository at: ${actualRepoPath}`);

            try {
                // For S3, set AWS environment variables
                const env = passphrase ? { BORG_PASSPHRASE: passphrase } : {};

                if (isDirectS3) {
                    env.AWS_ACCESS_KEY_ID = s3_access_key;
                    env.AWS_SECRET_ACCESS_KEY = s3_secret_key;
                    env.AWS_DEFAULT_REGION = s3_region || 'us-east-1';
                    if (s3_endpoint) {
                        const endpointUrl = s3_endpoint.startsWith('http') ? s3_endpoint : `https://${s3_endpoint}`;
                        env.AWS_ENDPOINT_URL = endpointUrl;
                    }
                }

                const initResult = await borgmaticCLI.createRepository(actualRepoPath, encryptionMode, {
                    makeParentDirs: true,
                    env: env,
                    borgVersion: selectedBorgVersion,
                    passphrase: passphrase
                });

                if (!initResult.success) {
                    console.error('❌ Repository initialization failed:', initResult.stderr);
                    return res.status(500).json({
                        detail: `Failed to initialize repository: ${initResult.stderr || initResult.error}`,
                        success: false
                    });
                }

                console.log('✅ Repository initialized successfully');
            } catch (initError) {
                console.error('❌ Repository initialization error:', initError.message);
                return res.status(500).json({
                    detail: `Failed to initialize repository: ${initError.message}`,
                    success: false
                });
            }
        } else if (isSSH) {
            console.log(`🔧 Initializing SSH repository on remote system: ${actualRepoPath}`);
            console.log(`🔍 Debug - actualRepoPath type: ${typeof actualRepoPath}, value:`, actualRepoPath);

            // For SSH repositories, we need to:
            // 1. Create the directory path on remote if it doesn't exist
            // 2. Initialize the repository on the remote system

            try {
                // Ensure actualRepoPath is a string and starts with ssh://
                if (typeof actualRepoPath !== 'string' || !actualRepoPath.startsWith('ssh://')) {
                    console.error('Invalid actualRepoPath:', actualRepoPath);
                    return res.status(400).json({
                        detail: `Invalid SSH repository path: ${actualRepoPath}. Path must start with ssh://`,
                        success: false
                    });
                }

                // Parse SSH path to get connection details
                // Format: ssh://user@host:port/path or ssh://user@host/path
                // More flexible regex that handles paths starting with /
                const sshMatch = actualRepoPath.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                if (!sshMatch) {
                    console.error('Failed to parse SSH path:', actualRepoPath);
                    console.error('Path components:', {
                        full: actualRepoPath,
                        startsWithSsh: actualRepoPath.startsWith('ssh://'),
                        hasAt: actualRepoPath.includes('@'),
                        length: actualRepoPath.length
                    });
                    return res.status(400).json({
                        detail: `Invalid SSH repository path format: ${actualRepoPath}. Expected format: ssh://user@host:port/path`,
                        success: false
                    });
                }

                const remoteUsername = sshMatch[1];
                const remoteHost = sshMatch[2];
                const remotePort = sshMatch[3] ? parseInt(sshMatch[3]) : 22;
                // Path might be empty or start with / - ensure it starts with /
                let remotePath = sshMatch[4] || '';
                if (!remotePath.startsWith('/')) {
                    remotePath = '/' + remotePath;
                }
                if (!remotePath || remotePath === '/') {
                    remotePath = '/backups/repo';
                }
                if (!isSafeRemotePath(remotePath)) {
                    return res.status(400).json({
                        detail: `Invalid remote path. Use an absolute path with only letters, numbers, '.', '_', '-', and '/'.`,
                        success: false
                    });
                }

                console.log(`Parsed SSH path - User: ${remoteUsername}, Host: ${remoteHost}, Port: ${remotePort}, Path: ${remotePath}`);

                // Get SSH credentials
                let sshKey = null;
                const authMethod = ssh_auth_method || (ssh_key_id ? 'key' : 'password');

                if (authMethod === 'key' && ssh_key_id) {
                    const sshKeysAPI = require('../../services/ssh-keys');
                    sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);

                    if (!sshKey) {
                        return res.status(404).json({
                            detail: 'SSH key not found',
                            success: false
                        });
                    }
                }

                if (authMethod === 'password' && (!ssh_password || ssh_password.trim().length === 0)) {
                    return res.status(400).json({
                        detail: 'SSH password is required for password authentication',
                        success: false
                    });
                }

                // Initialize repository using LOCAL Borg with SSH URL
                // Borg connects to remote via SSH and uses --remote-path for Hetzner
                const { execa } = require('execa');
                const fs = require('fs-extra');
                const path = require('path');

                let tempKeyPath = null;
                const env = { ...process.env };

                // Set passphrase in environment
                if (passphrase) {
                    env.BORG_PASSPHRASE = passphrase;
                }

                // Handle SSH key authentication
                if (authMethod === 'key') {
                    if (!sshKey || !sshKey.private_key) {
                        return res.status(500).json({
                            detail: 'SSH key private key is missing or invalid',
                            success: false
                        });
                    }

                    tempKeyPath = path.join('/tmp', `ssh-init-${Date.now()}`);
                    await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

                    // Set BORG_RSH to use the SSH key with correct port
                    if (sshKey.is_encrypted && sshKey.passphrase) {
                        // For encrypted keys, use SSH_ASKPASS
                        const askpassScript = path.join('/tmp', `askpass-init-${Date.now()}.sh`);
                        const escapedPassphrase = sshKey.passphrase.replace(/'/g, "'\"'\"'");
                        await fs.writeFile(askpassScript, `#!/bin/sh\necho '${escapedPassphrase}'\n`, { mode: 0o700 });
                        env.SSH_ASKPASS = askpassScript;
                        env.SSH_ASKPASS_REQUIRE = 'force';
                        env.DISPLAY = ':0';
                        env.BORG_RSH = `ssh -i ${tempKeyPath} -o StrictHostKeyChecking=accept-new -p ${remotePort}`;
                    } else {
                        env.BORG_RSH = `ssh -i ${tempKeyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${remotePort}`;
                    }
                } else {
                    // Password authentication - use sshpass
                    env.SSHPASS = ssh_password;
                    env.BORG_RSH = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p ${remotePort}`;
                }

                // For Hetzner, create directory via SFTP first (they don't allow SSH shell commands)
                if (isHetzner) {
                    console.log(`📁 Creating directory on Hetzner via SFTP: ${remotePath}`);
                    try {
                        // Build SFTP command
                        let sftpArgs = [];
                        if (authMethod === 'key') {
                            if (sshKey.is_encrypted && sshKey.passphrase) {
                                env.SSHPASS = sshKey.passphrase;
                                sftpArgs = ['sshpass', '-e', 'sftp', '-i', tempKeyPath];
                            } else {
                                sftpArgs = ['sftp', '-i', tempKeyPath];
                            }
                        } else {
                            sftpArgs = ['sshpass', '-e', 'sftp'];
                        }

                        sftpArgs.push(
                            '-oStrictHostKeyChecking=accept-new',
                            '-oUserKnownHostsFile=/dev/null',
                            '-oBatchMode=no',
                            '-P', remotePort.toString(),
                            `${remoteUsername}@${remoteHost}`
                        );

                        // SFTP mkdir command (will fail silently if exists)
                        const sftpCommands = `mkdir ${remotePath}\nexit\n`;
                        await execa(sftpArgs[0], sftpArgs.slice(1), {
                            input: sftpCommands,
                            env,
                            timeout: 15000,
                            reject: false  // Don't throw on error (dir may already exist)
                        });
                        console.log(`✅ Directory created/verified on Hetzner: ${remotePath}`);
                    } catch (dirError) {
                        console.warn(`⚠️ SFTP mkdir warning (may be OK if dir exists): ${dirError.message}`);
                        // Continue anyway - the directory might already exist
                    }
                } else {
                    // For regular SSH, create directory via SSH shell command
                    console.log(`📁 Creating directory on remote via SSH: ${remotePath}`);
                    try {
                        let sshCmd;
                        if (authMethod === 'key') {
                            if (sshKey.is_encrypted && sshKey.passphrase) {
                                sshCmd = ['sshpass', '-e', 'ssh', '-i', tempKeyPath];
                            } else {
                                sshCmd = ['ssh', '-i', tempKeyPath];
                            }
                        } else {
                            sshCmd = ['sshpass', '-e', 'ssh'];
                        }

                        sshCmd.push(
                            '-o', 'StrictHostKeyChecking=accept-new',
                            '-o', 'UserKnownHostsFile=/dev/null',
                            '-o', 'ConnectTimeout=10',
                            '-p', remotePort.toString(),
                            `${remoteUsername}@${remoteHost}`,
                            `mkdir -p ${shellSingleQuote(remotePath)}`
                        );

                        await execa(sshCmd[0], sshCmd.slice(1), { env, timeout: 15000 });
                        console.log(`✅ Directory created/verified on remote: ${remotePath}`);
                    } catch (dirError) {
                        if (tempKeyPath) {
                            await fs.remove(tempKeyPath).catch(() => { });
                        }
                        return res.status(500).json({
                            detail: `Failed to create directory on remote system: ${dirError.stderr || dirError.message}`,
                            success: false
                        });
                    }
                }

                // Initialize repository using LOCAL Borg with the SSH URL
                // Borg will connect to remote via SSH using BORG_RSH environment variable
                console.log(`🔧 Initializing repository with local Borg ${selectedBorgVersion}`);

                const useBorg2 = selectedBorgVersion === '2.x';
                const localBorgPath = getBorgPath(selectedBorgVersion);

                // Build borg init command arguments
                let borgInitArgs = [];

                // For Hetzner, add --remote-path to specify which Borg version to use on remote
                if (isHetzner) {
                    const remoteBorgVersion = hetzner_borg_version || 'borg-1.4';
                    borgInitArgs.push('--remote-path', remoteBorgVersion);
                    console.log(`🔧 Using Hetzner remote Borg: ${remoteBorgVersion}`);
                }

                // Build the full SSH URL for the repository
                // Format: ssh://user@host:port/path
                const sshRepoUrl = `ssh://${remoteUsername}@${remoteHost}:${remotePort}${remotePath.startsWith('/') ? '' : '/'}${remotePath}`;
                console.log(`🔧 Repository URL: ${sshRepoUrl}`);

                // Build borg init command based on version
                if (useBorg2) {
                    // Borg 2.x syntax: borg -r PATH repo-create --encryption MODE
                    borgInitArgs.push('-r', sshRepoUrl, 'repo-create', '--encryption', encryptionMode);
                } else {
                    // Borg 1.x syntax: borg init --encryption=MODE PATH
                    borgInitArgs.push('init', `--encryption=${encryptionMode}`, sshRepoUrl);
                }

                console.log(`🔧 Running: ${localBorgPath} ${borgInitArgs.join(' ')}`);

                try {
                    await execa(localBorgPath, borgInitArgs, {
                        env,
                        timeout: 120000 // 2 minutes for remote initialization
                    });

                    // Clean up temp key
                    if (tempKeyPath) {
                        await fs.remove(tempKeyPath).catch(() => { });
                    }

                    console.log(`✅ Repository initialized successfully: ${sshRepoUrl}`);
                } catch (initError) {
                    // Clean up temp key
                    if (tempKeyPath) {
                        await fs.remove(tempKeyPath).catch(() => { });
                    }

                    console.error('❌ Borg init error:', {
                        message: initError.message,
                        stderr: initError.stderr,
                        stdout: initError.stdout,
                        exitCode: initError.exitCode
                    });

                    // Check if repository already exists
                    if (initError.stderr && (initError.stderr.includes('already exists') || initError.stderr.includes('already initialized'))) {
                        console.log(`ℹ️ Repository already exists, continuing...`);
                        // This is OK, continue
                    } else {
                        return res.status(500).json({
                            detail: `Failed to initialize repository: ${initError.stderr || initError.message || 'Unknown error'}`,
                            success: false
                        });
                    }
                }
            } catch (sshInitError) {
                console.error('❌ SSH repository initialization error:', sshInitError.message);
                return res.status(500).json({
                    detail: `Failed to initialize SSH repository: ${sshInitError.message || 'Unknown error'}`,
                    success: false
                });
            }
        } else {
            console.log(`⚠️  Skipping local repository initialization for Direct mode Rclone repository`);
            console.log(`💡 Repository will be initialized on remote when first backup runs (remote must be mounted)`);
        }

        // Add repository to borgmatic configuration
        // Generate unique ID for repository
        const repoId = `repo-${uuidv4().split('-')[0]}-${Date.now().toString(36)}`;

        const repositoryData = {
            id: repoId,
            name,
            path: actualRepoPath,
            encryption: encryptionMode,
            compression: compression || 'lz4',
            repository_type: repository_type || 'local',
            label: name,
            // Borg version
            borg_version: selectedBorgVersion,
            // Optional: per-repository borgmatic log file path (used by backups if configured)
            log_file_path: log_file_path || undefined,
            // Store sync information for later use
            storage_mode: isRclone || isS3 ? storage_mode : undefined,
            rclone_remote: isRclone ? rclone_remote : undefined,
            rclone_path: isRclone ? rclone_path : undefined,
            local_path: isSync ? local_path : undefined,
            mount_path: (isRclone && storage_mode === 'direct') ? mount_path : undefined,
            // S3 fields
            s3_endpoint: isS3 ? s3_endpoint : undefined,
            s3_bucket: isS3 ? s3_bucket : undefined,
            s3_path: isS3 ? (s3_path || '/backups') : undefined,
            s3_region: isS3 ? s3_region : undefined,
            // SSH/SFTP/Hetzner fields - all need SSH connection details
            host: (isSSH || isSFTP || isHetzner) ? host : undefined,
            port: (isSSH || isSFTP || isHetzner) ? (port || (isHetzner ? 23 : 22)) : undefined,
            username: (isSSH || isSFTP || isHetzner) ? username : undefined,
            ssh_key_id: (isSSH || isSFTP || isHetzner) ? ssh_key_id : undefined,
            ssh_auth_method: (isSSH || isSFTP || isHetzner) ? (ssh_auth_method || (ssh_key_id ? 'key' : 'password')) : undefined,
            // Hetzner Storage Box: remote Borg version for --remote-path (borg-1.1, borg-1.2, borg-1.4)
            // Default is borg-1.2 on Hetzner, but we recommend borg-1.4 for latest features
            hetzner_borg_version: isHetzner ? (hetzner_borg_version || 'borg-1.4') : undefined
        };

        // Store encrypted S3 credentials if provided
        if (isS3 && isDirect && s3_access_key && s3_secret_key) {
            await repositoryCredentials.storeS3Credentials(actualRepoPath, {
                access_key: s3_access_key,
                secret_key: s3_secret_key,
                endpoint: s3_endpoint,
                region: s3_region,
                bucket: s3_bucket,
                path: s3_path || '/backups'
            });
        }

        // Store SSH credentials if provided
        if (repository_type === 'ssh' || repository_type === 'sftp' || repository_type === 'hetzner') {
            try {
                const authMethod = ssh_auth_method || (ssh_key_id ? 'key' : 'password');

                // Validate credentials based on auth method
                if (authMethod === 'key') {
                    if (!ssh_key_id) {
                        return res.status(400).json({
                            detail: 'SSH key is required when using key authentication'
                        });
                    }
                    const sshKeysAPI = require('../../services/ssh-keys');
                    const sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);
                    if (!sshKey || !sshKey.private_key) {
                        return res.status(400).json({
                            detail: 'SSH key not found or invalid'
                        });
                    }
                    await repositoryCredentials.storeSSHKey(actualRepoPath, ssh_key_id, sshKey.private_key);
                    // Write to filesystem for borgmatic to use
                    // Pass passphrase if key is encrypted
                    const passphrase = sshKey.is_encrypted && sshKey.passphrase ? sshKey.passphrase : null;
                    await writeSSHKeyToFilesystem(ssh_key_id, sshKey.private_key, passphrase);
                } else if (authMethod === 'password') {
                    if (!ssh_password || ssh_password.trim().length === 0) {
                        return res.status(400).json({
                            detail: 'SSH password is required when using password authentication'
                        });
                    }
                    await repositoryCredentials.storeSSHPassword(actualRepoPath, ssh_password);
                }
            } catch (credError) {
                console.error('❌ Failed to store SSH credentials:', credError.message);
                console.error('Error stack:', credError.stack);
                return res.status(500).json({
                    detail: `Failed to store SSH credentials: ${credError.message}`,
                    success: false
                });
            }
        }

        // Add to unused repositories list (not to any active backup config yet)
        try {
            await configParser.addUnusedRepository(repositoryData);
            console.log(`✅ Repository added to unused list: ${repositoryData.name}`);
        } catch (addError) {
            console.error('❌ Failed to add repository to unused list:', addError.message);
            console.error('❌ Error stack:', addError.stack);
            // Check if it's a duplicate error
            if (addError.message && addError.message.includes('already exists')) {
                return res.status(409).json({
                    detail: `A repository already exists at this location: ${actualRepoPath}. Please choose a different path or edit the existing repository.`,
                    success: false
                });
            }
            return res.status(500).json({
                detail: `Failed to save repository configuration: ${addError.message}`,
                success: false
            });
        }

        // Store passphrase securely if provided
        if (encryptionMode !== 'none' && passphrase) {
            await passwordManager.storeRepositoryPassphrase(actualRepoPath, passphrase);
        }

        const isDirectMode = isDirectRclone || isDirectS3;
        res.status(201).json({
            success: true,
            message: isDirectMode
                ? 'Repository configuration saved. Repository will be initialized on remote when first backup runs (ensure remote is mounted).'
                : isSync
                    ? 'Repository initialized successfully. Cloud sync will be configured when used in a backup.'
                    : 'Repository initialized and created successfully',
            data: {
                id: repoId,
                name,
                path: actualRepoPath,
                encryption: encryptionMode,
                compression,
                repository_type,
                borg_version: selectedBorgVersion,
                storage_mode: repositoryData.storage_mode,
                rclone_remote: repositoryData.rclone_remote,
                rclone_path: repositoryData.rclone_path,
                is_active: false,
                isUsed: false,
                usedInBackups: [],
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to create repository:', error.message);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error details:', {
            message: error.message,
            name: error.name,
            code: error.code,
            stderr: error.stderr,
            stdout: error.stdout
        });

        // Check if it's a duplicate repository error
        if (error.message && error.message.includes('already exists')) {
            return res.status(409).json({
                detail: `Repository already exists: ${error.message}`,
                success: false
            });
        }

        // Sanitize error message to prevent path disclosure
        let sanitizedError = 'Failed to create repository';
        if (error.message && error.message.includes('permission denied')) {
            sanitizedError = 'Permission denied. Check directory permissions.';
        } else if (error.message.includes('not found')) {
            sanitizedError = 'Directory not found or not accessible.';
        }

        res.status(500).json({
            detail: sanitizedError
        });
    }
});

module.exports = router;
