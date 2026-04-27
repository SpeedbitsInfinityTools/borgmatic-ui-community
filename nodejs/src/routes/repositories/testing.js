const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const configParser = require('../../services/config-parser');
const repositoryCredentials = require('../../services/repository-credentials');
const passwordManager = require('../../services/password-manager');
const fs = require('fs-extra');
const path = require('path');
const { execa } = require('execa');
const { constructSSHPath } = require('./helpers');

/**
 * Parse SSH error messages to provide user-friendly feedback
 * Filters out noise (warnings, info) and extracts the actual error
 */
function parseSSHError(stderr, stdout = '') {
    const lines = (stderr || '').split('\n');
    
    // Known patterns for actual errors (not warnings)
    const errorPatterns = [
        { pattern: /Permission denied/i, message: 'Authentication failed - wrong SSH key or password' },
        { pattern: /Authentication failed/i, message: 'Authentication failed - check your credentials' },
        { pattern: /No route to host/i, message: 'Cannot reach host - check hostname and network' },
        { pattern: /Connection refused/i, message: 'Connection refused - check port and firewall' },
        { pattern: /Connection timed out/i, message: 'Connection timed out - host unreachable' },
        { pattern: /Host key verification failed/i, message: 'Host key verification failed' },
        { pattern: /Could not resolve hostname/i, message: 'Cannot resolve hostname - check the address' },
        { pattern: /Network is unreachable/i, message: 'Network is unreachable' },
        { pattern: /sshpass.*ENOENT/i, message: 'sshpass not installed in container' },
    ];
    
    // Lines that are just informational/warnings to filter out
    const noisePatterns = [
        /^Warning: Permanently added/i,
        /WARNING.*post-quantum/i,
        /vulnerable to.*attacks/i,
        /server may need to be upgraded/i,
        /See https:\/\/openssh\.com/i,
        /^\s*$/,
    ];
    
    // Check for known error patterns first
    for (const { pattern, message } of errorPatterns) {
        if (pattern.test(stderr)) {
            return message;
        }
    }
    
    // Filter out noise and return remaining meaningful lines
    const meaningfulLines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        return !noisePatterns.some(p => p.test(trimmed));
    });
    
    if (meaningfulLines.length > 0) {
        return meaningfulLines.join(' ').trim();
    }
    
    // If stdout has error indication but stderr was just warnings
    if (stdout && stdout.includes('ERROR:')) {
        return stdout.split('ERROR:')[1]?.trim() || 'Cannot access path';
    }
    
    // Default fallback
    return 'SSH connection failed - check your credentials and connection settings';
}

/**
 * Build an actionable hint for an SSH/SFTP test failure, especially for
 * Hetzner Storage Boxes where exit code 255 / "connection failed" is very
 * unhelpful on its own. Returns null if there's nothing useful to add.
 */
function buildSSHFailureHint({ host, port, exitCode, stderr, isHetzner }) {
    const err = String(stderr || '');
    const lines = [];

    if (/Permission denied/i.test(err)) {
        lines.push(
            '• The server rejected the SSH key — make sure THIS exact public key is installed on the target.',
        );
        if (isHetzner) {
            lines.push(
                "  For Hetzner Storage Boxes the public key must be uploaded via the Robot UI (Storagebox → 'SSH-Keys') or via:",
                '    cat key.pub | ssh -p23 user@host install-ssh-key',
            );
        }
    }

    if (/Connection timed out/i.test(err) || /No route to host/i.test(err)) {
        lines.push(
            '• Could not reach the host — verify outbound TCP is open from this server',
            isHetzner
                ? `    (Hetzner Storage Boxes listen on ports 22 and 23; some hosting providers block 23 outbound).`
                : `    (default SSH port 22).`,
        );
    }

    if (/Could not resolve hostname/i.test(err)) {
        lines.push(`• DNS lookup for "${host}" failed from this server.`);
    }

    if (/Host key verification failed/i.test(err)) {
        lines.push('• Host key changed — remove the stale entry from your known_hosts and retry.');
    }

    if (/no matching .* found/i.test(err) || /no mutual signature algorithm/i.test(err)) {
        lines.push(
            '• Older host/key algorithm required by the server. Retry from a host with a more recent OpenSSH,',
            '  or add the legacy algorithm explicitly to /etc/ssh/ssh_config (HostKeyAlgorithms / KexAlgorithms).',
        );
    }

    // Fallback explanation when SSH/SFTP just returns 255 with no usable stderr.
    if (lines.length === 0 && Number(exitCode) === 255) {
        if (isHetzner) {
            lines.push(
                'Exit code 255 means the connection failed before login. For Hetzner Storage Boxes the usual causes are:',
                '  • The public key is not installed on this Storagebox (each box has its own authorized_keys)',
                '  • Outbound TCP to the chosen port is blocked from this server',
                '  • A required host or key algorithm is disabled in the local sshd/ssh_config',
                'Tip: from a shell on this server, try the same SSH connection with `-vvv` to see the precise failure.',
            );
        } else {
            lines.push(
                'Exit code 255 means SSH could not establish a session. Run with `-vvv` from this server to diagnose.',
            );
        }
    }

    return lines.length ? lines.join('\n') : null;
}

/**
 * Discover Borg repositories on remote SSH system
 * @param {Object} options - SSH connection options
 * @returns {Promise<Array>} Array of discovered repositories
 */
async function discoverSSHRepositories(options) {
    const { host, port, username, authMethod, sshKey, sshPassword, basePath, ssh_key_id } = options;
    const discoveredRepos = [];
    let tempKeyPath = null;

    try {
        // Build SSH command (similar to test-connection)
        const cmd = [
            'ssh',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10',
            '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'LogLevel=ERROR',
            '-o', 'BatchMode=yes',
            '-p', (port || 22).toString(),
            `${username}@${host}`
        ];

        const env = { ...process.env };

        if (authMethod === 'key' && sshKey) {
            tempKeyPath = path.join('/tmp', `ssh-discover-${Date.now()}`);
            await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

            if (sshKey.is_encrypted && sshKey.passphrase) {
                try {
                    await execa('which', ['sshpass'], { timeout: 2000 });
                    env.SSHPASS = sshKey.passphrase;
                    // Remove BatchMode=yes which conflicts with sshpass
                    const batchModeIndex = cmd.indexOf('BatchMode=yes');
                    if (batchModeIndex > 0) {
                        cmd.splice(batchModeIndex - 1, 2); // Remove -o and BatchMode=yes
                    }
                    cmd.unshift('-e');
                    cmd.unshift('sshpass');
                } catch {
                    await fs.remove(tempKeyPath).catch(() => { });
                    throw new Error('sshpass required for encrypted keys');
                }
            }

            const sshIndex = cmd.indexOf('ssh');
            cmd.splice(sshIndex + 1, 0, '-i', tempKeyPath);
        } else if (authMethod === 'password' && sshPassword) {
            try {
                await execa('which', ['sshpass'], { timeout: 2000 });
            } catch {
                throw new Error('sshpass required for password authentication');
            }
            env.SSHPASS = sshPassword;
            // Remove BatchMode=yes which conflicts with sshpass
            const batchModeIndex = cmd.indexOf('BatchMode=yes');
            if (batchModeIndex > 0) {
                cmd.splice(batchModeIndex - 1, 2); // Remove -o and BatchMode=yes
            }
            cmd.unshift('-e');
            cmd.unshift('sshpass');
        }

        // Use a smarter approach: look for directories that contain Borg repository markers
        // Borg repositories contain a 'config' file and 'data' directory
        const commonPaths = [
            basePath || '/var/backups',
            '/var/backups/borg',
            `/home/${username}/backups`,
            `/home/${username}/borg`,
            '/opt/backups',
            '/mnt/backups'
        ];

        // Try to find repositories by looking for Borg repository markers
        for (const searchPath of commonPaths) {
            try {
                // Find directories that contain both 'config' file and 'data' directory (Borg repo markers)
                const findCmd = [...cmd];
                findCmd.push(`find "${searchPath}" -maxdepth 4 -type d -exec test -f {}/config -a -d {}/data \\; -print 2>/dev/null | head -20`);

                const findResult = await execa(findCmd[0], findCmd.slice(1), {
                    env,
                    timeout: 15000
                });

                const potentialRepos = findResult.stdout
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);

                // Verify each potential repository with borg info
                for (const dir of potentialRepos) {
                    try {
                        // Test if it's a valid Borg repository using borg info
                        const testCmd = [...cmd];
                        testCmd.push(`borg info --json "${dir}" 2>&1`);

                        const testResult = await execa(testCmd[0], testCmd.slice(1), {
                            env,
                            timeout: 5000
                        });

                        // If borg info succeeds, it's a valid repository
                        if (testResult.exitCode === 0) {
                            try {
                                const repoInfo = JSON.parse(testResult.stdout);
                                if (repoInfo.repository) {
                                    const repoPath = constructSSHPath(username, host, port, dir);

                                    // Check if we already have this repository
                                    const allRepos = await configParser.getAllRepositoriesWithUsage();
                                    const exists = allRepos.some(r => {
                                        const normalizedExisting = path.normalize(r.path.replace(/^ssh:\/\//, ''));
                                        const normalizedNew = path.normalize(repoPath.replace(/^ssh:\/\//, ''));
                                        return normalizedExisting === normalizedNew;
                                    });

                                    if (!exists) {
                                        discoveredRepos.push({
                                            path: repoPath,
                                            local_path: dir,
                                            name: path.basename(dir) || 'Discovered Repository',
                                            repository_type: 'ssh',
                                            host,
                                            port: port || 22,
                                            username,
                                            ssh_auth_method: authMethod,
                                            ssh_key_id: authMethod === 'key' ? ssh_key_id : null,
                                            encryption: repoInfo.repository.encryption?.mode || 'unknown'
                                        });
                                    }
                                }
                            } catch {
                                // Not valid JSON, skip
                                continue;
                            }
                        }
                    } catch {
                        // Not a valid repository, skip
                        continue;
                    }
                }
            } catch (error) {
                // Path doesn't exist or permission denied, continue to next path
                continue;
            }
        }

        // Clean up temp key
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }

        return discoveredRepos;
    } catch (error) {
        // Clean up temp key on error
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }
        console.error('Error discovering SSH repositories:', error.message);
        throw error;
    }
}

router.post('/test-path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: testPath } = req.body;

        if (!testPath) {
            return res.status(400).json({ detail: 'Path is required' });
        }

        // Validate path to prevent path traversal
        if (testPath.includes('..')) {
            return res.status(400).json({ detail: 'Path traversal is not allowed' });
        }

        // Block sensitive system paths
        const sensitivePatterns = [
            /^\/etc\//, /^\/root\//, /^\/boot\//, /^\/sys\//, /^\/proc\//, /^\/dev\//,
            /\/\.ssh\//, /\/\.gnupg\//, /^\/usr\//, /^\/bin\//, /^\/sbin\//
        ];
        for (const pattern of sensitivePatterns) {
            if (pattern.test(testPath)) {
                return res.status(403).json({ detail: 'Cannot access system directories' });
            }
        }

        const fullPath = path.resolve(testPath);

        try {
            // Check if path exists
            const exists = await fs.pathExists(fullPath);

            if (exists) {
                // Test if we can write to it
                const testFile = path.join(fullPath, '.borgmatic-test-write');
                await fs.writeFile(testFile, 'test');
                await fs.remove(testFile);

                res.json({
                    success: true,
                    exists: true,
                    writable: true,
                    message: 'Path exists and is writable'
                });
            } else {
                res.json({
                    success: true,
                    exists: false,
                    writable: false,
                    message: 'Path does not exist'
                });
            }
        } catch (error) {
            res.json({
                success: false,
                exists: false,
                writable: false,
                message: `Path test failed: ${error.message}`
            });
        }
    } catch (error) {
        console.error('Failed to test path:', error.message);
        res.status(500).json({ detail: 'Failed to test path' });
    }
});

router.post('/create-path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: createPath } = req.body;

        if (!createPath) {
            return res.status(400).json({ detail: 'Path is required' });
        }

        // Validate path to prevent path traversal
        if (createPath.includes('..')) {
            return res.status(400).json({ detail: 'Path traversal is not allowed' });
        }

        // Block sensitive system paths
        const sensitivePatterns = [
            /^\/etc\//, /^\/root\//, /^\/boot\//, /^\/sys\//, /^\/proc\//, /^\/dev\//,
            /\/\.ssh\//, /\/\.gnupg\//, /^\/usr\//, /^\/bin\//, /^\/sbin\//
        ];
        for (const pattern of sensitivePatterns) {
            if (pattern.test(createPath)) {
                return res.status(403).json({ detail: 'Cannot create directories in system paths' });
            }
        }

        const fullPath = path.resolve(createPath);

        try {
            // Create the directory
            await fs.ensureDir(fullPath);

            // Test if we can write to it
            const testFile = path.join(fullPath, '.borgmatic-test-write');
            await fs.writeFile(testFile, 'test');
            await fs.remove(testFile);

            res.json({
                success: true,
                message: 'Path created successfully and is writable'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: `Failed to create path: ${error.message}`
            });
        }
    } catch (error) {
        console.error('Failed to create path:', error.message);
        res.status(500).json({ detail: 'Failed to create path' });
    }
});

router.post('/test-connection', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            repository_type,
            path: repoPath,
            host,
            port,
            username,
            ssh_key_id,
            ssh_auth_method,
            ssh_password,
            s3_endpoint,
            s3_bucket,
            s3_region,
            s3_access_key,
            s3_secret_key,
            rclone_remote,
            rclone_path
        } = req.body;

        if (!repository_type) {
            return res.status(400).json({
                success: false,
                detail: 'Repository type is required'
            });
        }

        switch (repository_type) {
            case 'local': {
                // Test local filesystem
                if (!repoPath) {
                    return res.status(400).json({ success: false, detail: 'Path is required' });
                }

                const fullPath = path.resolve(repoPath);
                const exists = await fs.pathExists(fullPath);

                if (!exists) {
                    return res.json({
                        success: true,
                        data: {
                            requires_creation: true,
                            message: 'Path does not exist. Would you like to create it?'
                        }
                    });
                }

                // Test write permissions
                try {
                    const testFile = path.join(fullPath, '.borgmatic-test-write');
                    await fs.writeFile(testFile, 'test');
                    await fs.remove(testFile);

                    return res.json({
                        success: true,
                        data: { message: 'Local path exists and is writable' }
                    });
                } catch (writeError) {
                    return res.status(403).json({
                        success: false,
                        detail: `Path exists but is not writable: ${writeError.message}`
                    });
                }
            }

            case 'ssh':
            case 'sftp':
            case 'hetzner': {
                // Test SSH/SFTP connection (Hetzner Storage Box uses SSH on port 23)
                if (!host || !username) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Host and username are required for SSH/SFTP/Hetzner'
                    });
                }

                const authMethod = ssh_auth_method || (ssh_key_id ? 'key' : 'password');

                if (authMethod === 'key' && !ssh_key_id) {
                    return res.status(400).json({
                        success: false,
                        detail: 'SSH key is required for key authentication'
                    });
                }

                if (authMethod === 'password') {
                    if (!ssh_password || ssh_password.trim().length === 0) {
                        return res.status(400).json({
                            success: false,
                            detail: 'SSH password is required for password authentication'
                        });
                    }
                }

                // Get SSH key from database if using key auth
                let sshKey = null;
                if (authMethod === 'key') {
                    try {
                        const sshKeysAPI = require('../../services/ssh-keys');
                        sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);

                        if (!sshKey) {
                            return res.status(404).json({
                                success: false,
                                detail: 'SSH key not found'
                            });
                        }

                        // getSSHKey already returns decrypted private_key, so we can use it directly
                        if (!sshKey.private_key) {
                            return res.status(500).json({
                                success: false,
                                detail: 'SSH key private key is missing'
                            });
                        }
                    } catch (keyError) {
                        console.error('Failed to retrieve SSH key:', keyError);
                        console.error('Key error stack:', keyError.stack);
                        return res.status(500).json({
                            success: false,
                            detail: `Failed to retrieve SSH key: ${keyError.message}`,
                            error: process.env.NODE_ENV === 'development' ? keyError.stack : undefined
                        });
                    }
                }

                // Test SSH/SFTP connection
                // Hetzner Storage Boxes only support SFTP, not SSH shell commands
                const isHetzner = repository_type === 'hetzner' || 
                                  host?.includes('.your-storagebox.de') || 
                                  host?.includes('storagebox');
                
                let tempKeyPath = null; // Declare outside try block so catch can access it
                try {
                    const { execa } = require('execa');
                    const path = require('path');

                    const env = { ...process.env };

                    // For Hetzner/SFTP-only servers, use SFTP to test connection
                    // For regular SSH servers, use SSH command
                    let cmd;
                    
                    if (isHetzner) {
                        // Use SFTP for Hetzner (they don't allow SSH shell access)
                        cmd = [
                            'sftp',
                            '-oStrictHostKeyChecking=accept-new',
                            '-oConnectTimeout=10',
                            '-oUserKnownHostsFile=/dev/null',
                            '-oBatchMode=no',
                            '-P', (port || 23).toString(),  // Hetzner uses port 23
                            `${username}@${host}`
                        ];
                    } else {
                        // Build SSH command array (same as SSH keys test)
                        cmd = [
                            'ssh',
                            '-o', 'StrictHostKeyChecking=accept-new',
                            '-o', 'ConnectTimeout=10',
                            '-o', 'UserKnownHostsFile=/dev/null',
                            '-o', 'LogLevel=ERROR',
                            '-o', 'BatchMode=yes',
                            '-p', (port || 22).toString(),
                            `${username}@${host}`,
                            'echo "SSH connection successful"'
                        ];
                    }

                    if (authMethod === 'key') {
                        // Write temp key file
                        tempKeyPath = path.join('/tmp', `ssh-test-${Date.now()}`);
                        await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

                        // Handle encrypted keys (same as SSH keys test)
                        if (sshKey.is_encrypted && sshKey.passphrase) {
                            // Check if sshpass is available for encrypted keys
                            try {
                                await execa('which', ['sshpass'], { timeout: 2000 });
                                env.SSHPASS = sshKey.passphrase;
                                // Remove BatchMode=yes which conflicts with sshpass
                                const batchModeIndex = cmd.indexOf('BatchMode=yes');
                                if (batchModeIndex > 0) {
                                    cmd.splice(batchModeIndex - 1, 2); // Remove -o and BatchMode=yes
                                }
                                // Prepend sshpass -e
                                cmd.unshift('-e');
                                cmd.unshift('sshpass');
                            } catch {
                                // sshpass not available, will fail for encrypted keys
                                await fs.remove(tempKeyPath).catch(() => { });
                                return res.status(400).json({
                                    success: false,
                                    detail: 'sshpass is required for encrypted SSH keys. Install it with: apt-get install sshpass (or brew install sshpass on macOS)'
                                });
                            }
                        } else {
                            // For non-encrypted keys, BatchMode=yes is fine
                        }

                        // Insert -i option after 'ssh' or 'sftp' (or after 'sshpass -e ssh/sftp')
                        const cmdIndex = isHetzner ? cmd.indexOf('sftp') : cmd.indexOf('ssh');
                        cmd.splice(cmdIndex + 1, 0, '-i', tempKeyPath);
                    } else {
                        // Test connection with password using sshpass
                        // Check if sshpass is available
                        try {
                            await execa('which', ['sshpass'], { timeout: 5000 });
                        } catch {
                            return res.status(400).json({
                                success: false,
                                detail: 'sshpass is required for password authentication. Install it with: apt-get install sshpass (or brew install sshpass on macOS)'
                            });
                        }

                        // Use SSHPASS environment variable instead of command line to avoid password exposure
                        env.SSHPASS = ssh_password;
                        // Remove BatchMode=yes which conflicts with sshpass
                        const batchModeIndex = cmd.indexOf('BatchMode=yes');
                        if (batchModeIndex > 0) {
                            cmd.splice(batchModeIndex - 1, 2); // Remove -o and BatchMode=yes
                        }
                        // Prepend sshpass -e
                        cmd.unshift('-e');
                        cmd.unshift('sshpass');
                    }

                    // Execute SSH/SFTP test
                    let result;
                    if (isHetzner) {
                        // For Hetzner, use SFTP with pwd command to test connection
                        const sftpCommands = 'pwd\nexit\n';
                        result = await execa(cmd[0], cmd.slice(1), {
                            input: sftpCommands,
                            env,
                            timeout: 15000,
                            reject: false
                        });
                    } else {
                        result = await execa(cmd[0], cmd.slice(1), {
                            env,
                            timeout: 15000
                        });
                    }

                    // Check if connection was successful
                    const exitCode = result.exitCode ?? 0;
                    if (exitCode === 0) {
                        // Test write capability on remote path if provided
                        let writeTestResult = { tested: false, writable: false, message: '' };
                        if (repoPath && !isHetzner) {
                            // For non-Hetzner, test write via SSH shell commands
                            try {
                                const testFileName = `.borgmatic-test-write-${Date.now()}`;
                                const remotePath = repoPath.startsWith('/') ? repoPath : `/${repoPath}`;
                                const testFilePath = `${remotePath.replace(/\/$/, '')}/${testFileName}`;

                                // Test write: create file, then delete it
                                const writeTestCmd = [...cmd.slice(0, -1)]; // Remove the echo command
                                writeTestCmd.push(
                                    `mkdir -p "${remotePath}" && ` +
                                    `touch "${testFilePath}" && ` +
                                    `rm -f "${testFilePath}" && ` +
                                    `echo "WRITE_OK"`
                                );

                                const writeResult = await execa(writeTestCmd[0], writeTestCmd.slice(1), {
                                    env,
                                    timeout: 15000
                                });

                                if (writeResult.stdout.includes('WRITE_OK')) {
                                    writeTestResult = {
                                        tested: true,
                                        writable: true,
                                        message: '✓ Path exists and is writable'
                                    };
                                } else {
                                    writeTestResult = {
                                        tested: true,
                                        writable: false,
                                        message: '✗ Write test did not confirm success'
                                    };
                                }
                            } catch (writeError) {
                                const errMsg = writeError.stderr || writeError.message || '';
                                writeTestResult = {
                                    tested: true,
                                    writable: false,
                                    message: `✗ Write test failed: ${errMsg.substring(0, 100)}`
                                };
                            }
                        } else if (repoPath && isHetzner) {
                            // For Hetzner, we can't test write via shell - just note it
                            writeTestResult = {
                                tested: false,
                                writable: true, // Assume writable - Borg will fail if not
                                message: '⚠ Write test skipped (Hetzner SFTP-only). Borg will verify on first backup.'
                            };
                        }

                        // For SSH mode, check if Borg is installed on remote system
                        // For Hetzner, Borg is pre-installed - skip shell command check
                        if (isHetzner) {
                            // Hetzner Storage Boxes have Borg pre-installed (1.1, 1.2, 1.4)
                            // We can't run shell commands to check, so return known versions
                            if (tempKeyPath) {
                                await fs.remove(tempKeyPath).catch(() => { });
                            }

                            return res.json({
                                success: true,
                                data: {
                                    borg_installed: true,
                                    borg_major_version: '1.x',
                                    borg_full_version: 'Hetzner pre-installed (1.1, 1.2, 1.4 available)',
                                    available_borg_versions: {
                                        default: { majorVersion: '1.x', fullVersion: '1.2 (default)' },
                                        has_1x: true,
                                        has_2x: false,
                                        hetzner_versions: ['borg-1.1', 'borg-1.2', 'borg-1.4']
                                    },
                                    message: '✓ Connected to Hetzner Storage Box. Borg is pre-installed.',
                                    write_test: writeTestResult
                                }
                            });
                        }
                        
                        if (repository_type === 'ssh') {
                            try {
                                // Helper function to parse Borg version from output
                                const parseBorgVersion = (output) => {
                                    // Output format: "borg 1.2.7" or "borg 2.0.0b11"
                                    const match = output.match(/borg\s+(\d+)\.(\d+)\.(\S+)/i);
                                    if (match) {
                                        const major = parseInt(match[1], 10);
                                        const minor = parseInt(match[2], 10);
                                        const patch = match[3];
                                        return {
                                            raw: output.trim(),
                                            major,
                                            minor,
                                            patch,
                                            majorVersion: major >= 2 ? '2.x' : '1.x',
                                            fullVersion: `${major}.${minor}.${patch}`
                                        };
                                    }
                                    return null;
                                };

                                // Helper to check a specific borg command
                                const checkBorgBinary = async (binaryName) => {
                                    try {
                                        const checkCmd = [...cmd.slice(0, -1)]; // Remove the echo command
                                        checkCmd.push(`${binaryName} --version`);
                                        const result = await execa(checkCmd[0], checkCmd.slice(1), {
                                            env,
                                            timeout: 10000
                                        });
                                        return parseBorgVersion(result.stdout);
                                    } catch (e) {
                                        return null;
                                    }
                                };

                                // Check for different Borg installations on remote
                                // Try: borg, borg1, borg2 to detect all available versions
                                const [defaultBorg, borg1, borg2] = await Promise.all([
                                    checkBorgBinary('borg'),
                                    checkBorgBinary('borg1'),
                                    checkBorgBinary('borg2')
                                ]);

                                // Build available versions info
                                const availableBorgVersions = {
                                    default: defaultBorg,
                                    borg1: borg1,
                                    borg2: borg2,
                                    has_1x: (defaultBorg?.majorVersion === '1.x') || borg1 !== null,
                                    has_2x: (defaultBorg?.majorVersion === '2.x') || borg2 !== null
                                };

                                // Determine the primary installed version (prefer 'borg' command)
                                const primaryVersion = defaultBorg || borg2 || borg1;

                                // Clean up temp key after successful checks
                                if (tempKeyPath) {
                                    await fs.remove(tempKeyPath).catch(() => { });
                                }

                                if (!primaryVersion) {
                                    // No Borg found at all
                                    return res.json({
                                        success: true,
                                        data: {
                                            message: `${repository_type.toUpperCase()} connection successful, but Borg is not installed on remote system. Borg must be installed on the remote system for SSH mode.`,
                                            borg_installed: false,
                                            available_borg_versions: availableBorgVersions,
                                            warning: 'Borg is not installed on the remote system. Please install Borg on the remote system or use SFTP mode instead.',
                                            install_hints: {
                                                debian_ubuntu: 'sudo apt-get install borgbackup',
                                                fedora_rhel: 'sudo dnf install borgbackup',
                                                arch: 'sudo pacman -S borg',
                                                pip: 'pip install borgbackup'
                                            },
                                            write_test: writeTestResult
                                        }
                                    });
                                }

                                // For SSH, optionally discover existing repositories
                                const discoverRepos = req.body.discover_repositories === true;
                                let discoveredRepos = [];

                                // Note: Hetzner has already returned above, so this is only for SSH
                                if (discoverRepos && repository_type === 'ssh') {
                                    try {
                                        discoveredRepos = await discoverSSHRepositories({
                                            host,
                                            port: port || 22,
                                            username,
                                            authMethod,
                                            sshKey: authMethod === 'key' ? sshKey : null,
                                            sshPassword: authMethod === 'password' ? ssh_password : null,
                                            basePath: repoPath || '/var/backups',
                                            ssh_key_id: authMethod === 'key' ? ssh_key_id : null
                                        });
                                    } catch (discoverError) {
                                        console.warn('Failed to discover repositories:', discoverError.message);
                                        // Don't fail the connection test if discovery fails
                                    }
                                }

                                return res.json({
                                    success: true,
                                    data: {
                                        message: `${repository_type.toUpperCase()} connection successful. Borg ${primaryVersion.fullVersion} is installed on remote system.`,
                                        borg_installed: true,
                                        borg_version: primaryVersion.raw,
                                        borg_major_version: primaryVersion.majorVersion,
                                        borg_full_version: primaryVersion.fullVersion,
                                        available_borg_versions: availableBorgVersions,
                                        discovered_repositories: discoveredRepos,
                                        write_test: writeTestResult
                                    }
                                });
                            } catch (borgError) {
                                // Clean up temp key
                                if (tempKeyPath) {
                                    await fs.remove(tempKeyPath).catch(() => { });
                                }

                                return res.json({
                                    success: true,
                                    data: {
                                        message: `${repository_type.toUpperCase()} connection successful, but Borg is not installed on remote system. Borg must be installed on the remote system for SSH mode.`,
                                        borg_installed: false,
                                        warning: 'Borg is not installed on the remote system. Please install Borg on the remote system or use SFTP mode instead.',
                                        install_hints: {
                                            debian_ubuntu: 'sudo apt-get install borgbackup',
                                            fedora_rhel: 'sudo dnf install borgbackup',
                                            arch: 'sudo pacman -S borg',
                                            pip: 'pip install borgbackup'
                                        },
                                        write_test: writeTestResult
                                    }
                                });
                            }
                        } else {
                            // SFTP mode doesn't require Borg on remote
                            // Clean up temp key
                            if (tempKeyPath) {
                                await fs.remove(tempKeyPath).catch(() => { });
                            }

                            return res.json({
                                success: true,
                                data: {
                                    message: `${repository_type.toUpperCase()} connection successful`,
                                    write_test: writeTestResult
                                }
                            });
                        }
                    } else {
                        // Clean up temp key on failure
                        if (tempKeyPath) {
                            await fs.remove(tempKeyPath).catch(() => { });
                        }

                        // For Hetzner the SFTP test runs with `reject: false`, so we land
                        // here with exit code 255 / 1 etc. and useful info in stderr —
                        // surface it to the user instead of just the bare exit code.
                        const rawError = (result.stderr || '').trim() || (result.stdout || '').trim();
                        const friendlyError = parseSSHError(rawError, result.stdout || '');
                        const hint = buildSSHFailureHint({
                            host,
                            port,
                            exitCode,
                            stderr: result.stderr || '',
                            isHetzner,
                        });
                        const detail = [
                            `${repository_type.toUpperCase()} connection failed`,
                            friendlyError && `(${friendlyError})`,
                            `exit code ${exitCode}`,
                        ].filter(Boolean).join(' ');
                        return res.status(500).json({
                            success: false,
                            detail: hint ? `${detail}\n\n${hint}` : detail,
                            stderr: rawError || undefined,
                        });
                    }
                } catch (sshError) {
                    // Clean up temp key on error
                    if (tempKeyPath) {
                        await fs.remove(tempKeyPath).catch(() => { });
                    }

                    console.error('SSH test connection error:', sshError);
                    console.error('SSH error details:', {
                        message: sshError.message,
                        stderr: sshError.stderr,
                        stdout: sshError.stdout,
                        exitCode: sshError.exitCode,
                        stack: sshError.stack
                    });
                    const rawError = sshError.stderr || sshError.stdout || sshError.message || sshError.toString();
                    const friendlyError = parseSSHError(rawError, sshError.stdout);
                    const hint = buildSSHFailureHint({
                        host,
                        port,
                        exitCode: sshError.exitCode,
                        stderr: sshError.stderr || '',
                        isHetzner,
                    });
                    const detail = `${repository_type.toUpperCase()} connection failed: ${friendlyError}`;
                    return res.status(500).json({
                        success: false,
                        detail: hint ? `${detail}\n\n${hint}` : detail,
                        stderr: rawError || undefined,
                        error: process.env.NODE_ENV === 'development' ? sshError.stack : undefined
                    });
                }
            }

            case 's3': {
                // Test S3 connection with connect, read, write tests
                if (!s3_bucket || !s3_access_key || !s3_secret_key) {
                    return res.status(400).json({
                        success: false,
                        detail: 'S3 bucket, access key, and secret key are required'
                    });
                }

                // Validate S3 bucket name (alphanumeric, dash, dot only)
                if (!/^[a-z0-9.-]+$/.test(s3_bucket)) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Invalid S3 bucket name'
                    });
                }

                try {
                    const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
                    const crypto = require('crypto');

                    // Configure S3 client
                    const s3Config = {
                        credentials: {
                            accessKeyId: s3_access_key,
                            secretAccessKey: s3_secret_key
                        },
                        region: s3_region || (s3_endpoint ? 'us-east-1' : 'us-east-1'),
                        forcePathStyle: true // Required for S3-compatible providers
                    };

                    if (s3_endpoint) {
                        // Validate endpoint URL format
                        try {
                            const endpointUrl = s3_endpoint.startsWith('http') ? s3_endpoint : `https://${s3_endpoint}`;
                            new URL(endpointUrl);
                            s3Config.endpoint = endpointUrl;
                        } catch {
                            return res.status(400).json({
                                success: false,
                                detail: 'Invalid S3 endpoint URL'
                            });
                        }
                    }

                    const s3Client = new S3Client(s3Config);

                    const testResults = {
                        connect: false,
                        read: false,
                        write: false,
                        messages: []
                    };

                    // Test 1: Connect and list bucket (read permission)
                    try {
                        const listCommand = new ListObjectsV2Command({
                            Bucket: s3_bucket,
                            MaxKeys: 1 // We only need to verify we can list, not get all objects
                        });
                        await s3Client.send(listCommand);
                        testResults.connect = true;
                        testResults.read = true;
                        testResults.messages.push('✓ Connection successful');
                        testResults.messages.push('✓ Read permission verified');
                    } catch (listError) {
                        const errorCode = listError.name || listError.Code || '';
                        const errorMessage = listError.message || '';

                        if (errorCode === 'NoSuchBucket' || errorMessage.includes('NoSuchBucket')) {
                            return res.status(404).json({
                                success: false,
                                detail: 'S3 bucket does not exist'
                            });
                        } else if (errorCode === 'InvalidAccessKeyId' || errorCode === 'SignatureDoesNotMatch' ||
                            errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
                            // IMPORTANT: this is NOT an auth failure of the UI user; it's bad S3 credentials.
                            // Do not return 401 here, otherwise the frontend may interpret it as a session expiry and log out.
                            return res.status(400).json({
                                success: false,
                                detail: 'S3 authentication failed. Check your access key and secret key.'
                            });
                        } else if (errorCode === 'AccessDenied' || errorMessage.includes('AccessDenied')) {
                            testResults.messages.push('✗ Read permission denied');
                            return res.status(403).json({
                                success: false,
                                detail: 'S3 access denied. Check your credentials and bucket permissions.'
                            });
                        } else {
                            throw listError;
                        }
                    }

                    // Test 2: Write permission (upload test file, then delete it)
                    try {
                        const testKey = `borgmatic-test-${crypto.randomBytes(8).toString('hex')}.txt`;
                        const testContent = 'borgmatic-connection-test';

                        // Write test file
                        const putCommand = new PutObjectCommand({
                            Bucket: s3_bucket,
                            Key: testKey,
                            Body: testContent
                        });
                        await s3Client.send(putCommand);

                        // Delete test file
                        const deleteCommand = new DeleteObjectCommand({
                            Bucket: s3_bucket,
                            Key: testKey
                        });
                        await s3Client.send(deleteCommand);

                        testResults.write = true;
                        testResults.messages.push('✓ Write permission verified');
                    } catch (writeError) {
                        const errorCode = writeError.name || writeError.Code || '';
                        const errorMessage = writeError.message || '';

                        if (errorCode === 'AccessDenied' || errorMessage.includes('AccessDenied')) {
                            testResults.messages.push('✗ Write permission denied');
                            return res.status(403).json({
                                success: false,
                                detail: 'S3 write permission denied. Bucket must allow write access for backups.',
                                testResults
                            });
                        } else {
                            testResults.messages.push('✗ Write test failed: ' + errorMessage);
                            return res.status(500).json({
                                success: false,
                                detail: 'S3 write test failed',
                                testResults
                            });
                        }
                    }

                    return res.json({
                        success: true,
                        data: {
                            message: 'S3 connection successful - all tests passed',
                            testResults
                        }
                    });
                } catch (s3Error) {
                    const errorCode = s3Error.name || s3Error.Code || '';
                    const errorMessage = s3Error.message || '';

                    // Handle networking errors
                    if (errorCode === 'NetworkingError' || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
                        return res.status(500).json({
                            success: false,
                            detail: `Cannot connect to S3 endpoint. Please check your endpoint URL: ${s3_endpoint || 'AWS S3'}`
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        detail: `S3 connection failed: ${errorMessage || errorCode || 'Unknown error'}`
                    });
                }
            }

            case 'rclone': {
                // Test Rclone connection via RCD API
                if (!rclone_remote || !rclone_path) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Rclone remote and path are required'
                    });
                }

                // Validate remote name
                if (!/^[a-zA-Z0-9_-]+$/.test(rclone_remote)) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Invalid rclone remote name'
                    });
                }

                // Validate and normalize rclone path
                const normalizedRclonePath = rclone_path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
                if (normalizedRclonePath.includes('..') || /[;&|`$()\\]/.test(normalizedRclonePath)) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Invalid rclone path'
                    });
                }

                try {
                    // Test rclone connection using CLI (no RCD required)
                    const rcloneCLI = require('../../services/rclone-cli');
                    const result = await rcloneCLI.testConnection(rclone_remote, normalizedRclonePath);

                    if (result.success) {
                        return res.json({
                            success: true,
                            data: { message: 'Rclone connection successful' }
                        });
                    } else {
                        return res.status(500).json({
                            success: false,
                            detail: result.error || 'Rclone connection failed'
                        });
                    }
                } catch (rcloneError) {
                    // Check if rclone is not installed
                    if (rcloneError.message.includes('not installed')) {
                        return res.status(503).json({
                            success: false,
                            detail: 'Rclone is not installed on the host system.'
                        });
                    }
                    return res.status(500).json({
                        success: false,
                        detail: 'Rclone connection failed. Check remote name and path.'
                    });
                }
            }

            default:
                return res.status(400).json({
                    success: false,
                    detail: `Unsupported repository type: ${repository_type}`
                });
        }
    } catch (error) {
        console.error('Test connection route error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            detail: `Test connection failed: ${error.message}`,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;
