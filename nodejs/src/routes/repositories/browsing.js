const express = require('express');
const router = express.Router();

// Default to OFF; enable by setting DEBUG_REPOSITORIES=true
const DEBUG = process.env.DEBUG_REPOSITORIES === 'true';
const debugLog = (...args) => DEBUG && console.log(...args);
const debugError = (...args) => DEBUG && console.error(...args);

// ALWAYS log module loading (critical for debugging)
console.log('🔧 [browsing.js] MODULE LOADING - Creating Express router...');
debugLog('🔧 [browsing.js] DEBUG mode enabled');

const { authenticateToken, requireAdmin } = require('../../middleware/auth');
debugLog('🔧 [browsing.js] authenticateToken loaded, type:', typeof authenticateToken);

const { execa } = require('execa');
debugLog('🔧 [browsing.js] execa loaded, type:', typeof execa);

const fs = require('fs-extra');
const path = require('path');
const { constructSSHPath } = require('./helpers');
const {
    PASSWORD_AUTH_SSH_FLAGS,
    PASSWORD_AUTH_SFTP_FLAGS,
} = require('../../utils/ssh-password-auth');
debugLog('🔧 [browsing.js] constructSSHPath loaded, type:', typeof constructSSHPath);

const rcloneCLI = require('../../services/rclone-cli');
debugLog('🔧 [browsing.js] rcloneCLI loaded, type:', typeof rcloneCLI);

debugLog('✅ [browsing.js] Module loaded successfully');

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

// Per-credential ControlMaster socket path.
//
// SECURITY: the socket MUST be unique per (credential, host, port, user) — not
// just host/port/user (which is all ssh's %C encodes). If two browse requests
// to the same user@host use DIFFERENT keys (or key vs. password), a shared
// socket would let the second request piggyback on the first's authenticated
// master and skip its own auth — defeating the "use only the selected key"
// guarantee and blurring credential boundaries (raised in review). We fold a
// hash of the selected credential into the socket name; ssh's %C still adds
// host/port/user. Same-credential reuse (the actual benefit) is preserved;
// cross-credential reuse cannot happen. The credential value is hashed, so no
// key id or password ever appears in a world-listable /tmp path.
function browseControlPathOpt(authMethod, keyId, password) {
    const credString = authMethod === 'key' ? `key:${keyId || ''}` : `pw:${password || ''}`;
    const tag = require('crypto').createHash('sha256').update(credString).digest('hex').slice(0, 16);
    return `/tmp/borgui-cm-${tag}-%C`;
}

// ============================================================================
// Rclone CLI Endpoints (no RCD required)
// ============================================================================

/**
 * GET /api/repositories/rclone-check
 * Check if Rclone CLI is installed on the host
 */
router.get('/rclone-check', authenticateToken, async (req, res) => {
    try {
        const result = await rcloneCLI.checkInstallation();
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Failed to check rclone installation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/repositories/rclone-remotes
 * List all configured Rclone remotes
 */
router.get('/rclone-remotes', authenticateToken, async (req, res) => {
    try {
        const result = await rcloneCLI.listRemotes();

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                remotes: result.remotes
            }
        });
    } catch (error) {
        console.error('Failed to list rclone remotes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/repositories/rclone-list
 * List files/directories at a remote path using Rclone CLI
 */
router.post('/rclone-list', authenticateToken, async (req, res) => {
    try {
        const { remote, path: remotePath, dirsOnly } = req.body;

        if (!remote) {
            return res.status(400).json({
                success: false,
                error: 'Remote name is required'
            });
        }

        const result = await rcloneCLI.listPath(remote, remotePath || '', { dirsOnly: !!dirsOnly });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                items: result.items,
                remote,
                path: remotePath || ''
            }
        });
    } catch (error) {
        console.error('Failed to list rclone path:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/repositories/rclone-test
 * Test connection to a remote
 */
router.post('/rclone-test', authenticateToken, async (req, res) => {
    try {
        const { remote, path: remotePath } = req.body;

        if (!remote) {
            return res.status(400).json({
                success: false,
                error: 'Remote name is required'
            });
        }

        const result = await rcloneCLI.testConnection(remote, remotePath || '');

        res.json({
            success: result.success,
            data: {
                message: result.message,
                error: result.error
            }
        });
    } catch (error) {
        console.error('Failed to test rclone connection:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/repositories/rclone-mkdir
 * Create a directory on a remote
 */
router.post('/rclone-mkdir', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { remote, path: remotePath } = req.body;

        if (!remote || !remotePath) {
            return res.status(400).json({
                success: false,
                error: 'Remote and path are required'
            });
        }

        const result = await rcloneCLI.mkdir(remote, remotePath);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                message: 'Directory created',
                remote,
                path: remotePath
            }
        });
    } catch (error) {
        console.error('Failed to create rclone directory:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// Legacy Rclone browse endpoint (now uses CLI instead of RCD)
// ============================================================================

router.post('/rclone-browse', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { remote, path: browsePath } = req.body;

        if (!remote) {
            return res.status(400).json({
                success: false,
                error: 'Remote name is required'
            });
        }

        // Validate remote name (alphanumeric, dash, underscore only)
        if (!/^[a-zA-Z0-9_-]+$/.test(remote)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid remote name. Only alphanumeric characters, dashes, and underscores are allowed.'
            });
        }

        // Validate and normalize path
        let normalizedPath = '';
        if (browsePath) {
            // Remove leading/trailing slashes
            normalizedPath = browsePath.trim().replace(/^\/+/, '').replace(/\/+$/, '');

            // Block path traversal
            if (normalizedPath.includes('..')) {
                return res.status(400).json({
                    success: false,
                    error: 'Path traversal is not allowed'
                });
            }

            // Block shell metacharacters
            if (/[;&|`$()\\]/.test(normalizedPath)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid characters in path'
                });
            }
        }

        // Use CLI to list directories (simpler, no daemon needed)
        try {
            const result = await rcloneCLI.listPath(remote, normalizedPath, { dirsOnly: true });

            if (!result.success) {
                return res.status(500).json({
                    success: false,
                    error: result.error || 'Failed to browse remote'
                });
            }

            // Transform CLI response to expected format
            const folders = result.items.map(item => ({
                name: item.name
            }));

            res.json({
                success: true,
                folders,
                path: normalizedPath
            });
        } catch (error) {
            console.error('Rclone CLI browse error:', error.message);

            res.status(500).json({
                success: false,
                error: 'Failed to browse remote. Check if remote exists and is accessible.'
            });
        }
    } catch (error) {
        console.error('Failed to browse rclone folders:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to browse folders'
        });
    }
});

// NOTE: GET /rclone-remotes is now registered earlier in the file using CLI instead of RCD

/**
 * Browse S3 buckets and folders
 */
router.post('/s3-browse', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            s3_endpoint,
            s3_region,
            s3_access_key,
            s3_secret_key,
            bucket,
            path = ''
        } = req.body;

        if (!s3_access_key || !s3_secret_key) {
            return res.status(400).json({
                success: false,
                detail: 'S3 access key and secret key are required'
            });
        }

        try {
            const { S3Client, ListBucketsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

            // Normalize endpoint URL - always use HTTPS for Hetzner Object Storage
            let endpointUrl = null;
            if (s3_endpoint) {
                // Remove any existing protocol and force HTTPS (Hetzner requires HTTPS)
                let cleanEndpoint = s3_endpoint.replace(/^https?:\/\//, '');
                // Hetzner Object Storage requires HTTPS
                endpointUrl = `https://${cleanEndpoint}`;
                console.log(`📦 [S3 Browse] Using endpoint: ${endpointUrl}`);
            }

            // Configure S3 client
            const s3Config = {
                credentials: {
                    accessKeyId: s3_access_key,
                    secretAccessKey: s3_secret_key
                },
                // Only set region if provided (not required for non-AWS S3 providers like Hetzner)
                region: s3_region || 'us-east-1', // Some providers need a region even if not AWS
                // Force path style for S3-compatible providers (required for Hetzner)
                forcePathStyle: true
            };

            // Set endpoint for S3-compatible providers
            if (endpointUrl) {
                s3Config.endpoint = endpointUrl;
            }

            console.log(`📦 [S3 Browse] Connecting to S3... (bucket: ${bucket || 'listing buckets'}, path: ${path || '/'})`);
            const s3Client = new S3Client(s3Config);

            // Create abort controller for timeout
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                console.log(`⏱️ [S3 Browse] Request timed out after 30s`);
                abortController.abort();
            }, 30000);

            try {
                // If bucket is provided, list objects in bucket/path
                if (bucket) {
                    // Normalize path (remove leading/trailing slashes)
                    const prefix = path.replace(/^\/+/, '').replace(/\/+$/, '');
                    const prefixWithSlash = prefix ? `${prefix}/` : '';

                    const listCommand = new ListObjectsV2Command({
                        Bucket: bucket,
                        Prefix: prefixWithSlash,
                        Delimiter: '/'
                    });

                    console.log(`📦 [S3 Browse] Listing objects in bucket: ${bucket}, prefix: ${prefixWithSlash || '(root)'}`);
                    const response = await s3Client.send(listCommand, { abortSignal: abortController.signal });
                    console.log(`✅ [S3 Browse] Got response: ${response.Contents?.length || 0} files, ${response.CommonPrefixes?.length || 0} folders`);

                    const items = [];

                    // Add folders (common prefixes)
                    if (response.CommonPrefixes) {
                        for (const prefixObj of response.CommonPrefixes) {
                            const folderName = prefixObj.Prefix.replace(prefixWithSlash, '').replace(/\/$/, '');
                            if (folderName) {
                                const folderPath = path ? `${path}/${folderName}` : folderName;
                                items.push({
                                    name: folderName,
                                    type: 'folder',
                                    path: folderPath
                                });
                            }
                        }
                    }

                    // Add files
                    if (response.Contents) {
                        for (const object of response.Contents) {
                            // Skip the prefix itself if it's a folder marker
                            if (object.Key === prefixWithSlash && object.Size === 0) {
                                continue;
                            }

                            const fileName = object.Key.replace(prefixWithSlash, '');
                            if (fileName && !fileName.endsWith('/')) {
                                items.push({
                                    name: fileName,
                                    type: 'file',
                                    path: object.Key,
                                    size: object.Size,
                                    lastModified: object.LastModified
                                });
                            }
                        }
                    }

                    clearTimeout(timeoutId);
                    return res.json({
                        success: true,
                        data: {
                            items,
                            currentPath: path || '/',
                            bucket
                        }
                    });
                } else {
                    // List buckets
                    console.log(`📦 [S3 Browse] Listing buckets...`);
                    const listBucketsCommand = new ListBucketsCommand({});
                    const response = await s3Client.send(listBucketsCommand, { abortSignal: abortController.signal });
                    console.log(`✅ [S3 Browse] Got ${response.Buckets?.length || 0} buckets`);

                    const buckets = (response.Buckets || []).map(b => b.Name).filter(Boolean);

                    clearTimeout(timeoutId);
                    return res.json({
                        success: true,
                        data: {
                            buckets,
                            items: buckets.map(b => ({ name: b, type: 'bucket', path: '' }))
                        }
                    });
                }
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (browseError) {
            console.error('❌ [S3 Browse] Error:', browseError.name, browseError.message);

            // Handle AWS SDK errors
            const errorCode = browseError.name || browseError.Code || '';
            const errorMessage = browseError.message || '';

            // Handle abort/timeout errors
            if (errorCode === 'AbortError' || errorMessage.includes('aborted')) {
                return res.status(504).json({
                    success: false,
                    detail: 'S3 connection timed out after 30 seconds. Please check your endpoint URL and network connectivity.'
                });
            } else if (errorCode === 'InvalidAccessKeyId' || errorCode === 'SignatureDoesNotMatch' ||
                errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
                return res.status(401).json({
                    success: false,
                    detail: 'S3 authentication failed. Please check your access key and secret key.'
                });
            } else if (errorCode === 'NoSuchBucket' || errorMessage.includes('NoSuchBucket')) {
                return res.status(404).json({
                    success: false,
                    detail: 'S3 bucket does not exist'
                });
            } else if (errorCode === 'NetworkingError' || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
                return res.status(500).json({
                    success: false,
                    detail: `Cannot connect to S3 endpoint. Please check your endpoint URL: ${s3_endpoint || 'AWS S3'}`
                });
            } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
                return res.status(500).json({
                    success: false,
                    detail: `SSL/TLS error connecting to S3 endpoint. The endpoint may require HTTPS or have an invalid certificate.`
                });
            } else {
                return res.status(500).json({
                    success: false,
                    detail: `S3 browse failed: ${errorMessage || errorCode || 'Unknown error'}`
                });
            }
        }
    } catch (error) {
        console.error('Failed to browse S3:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to browse S3'
        });
    }
});

/**
 * Parse SFTP directory listing output
 * SFTP ls output format varies by server - handle multiple formats
 */
function parseSftpListing(output, targetPath) {
    const lines = output.split('\n').filter(line => line.trim());
    const items = [];

    console.log('📂 [parseSftpListing] Parsing', lines.length, 'lines for path:', targetPath);

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip sftp prompts, connection messages, and pwd output
        if (trimmedLine.startsWith('sftp>') ||
            trimmedLine.startsWith('Connected to') ||
            trimmedLine.startsWith('Changing to:') ||
            trimmedLine.startsWith('Remote working directory:') ||
            trimmedLine === '' ||
            trimmedLine === 'exit') {
            continue;
        }

        // Parse ls -la style output - multiple formats:
        // Format 1: drwxr-xr-x    2 user group   4096 Jan 21 10:00 dirname
        // Format 2: drwxr-xr-x    2 user group   4096 Jan 21  2024 dirname (year instead of time)
        // Format 3: -rw-r--r--    1 0     0       1234 Jan 21 10:00 filename
        // Format 4 (Hetzner): drwxr-xr-x    ? u533353  u533353    4 Jan 20 09:54 ./.ssh (? for link count, ./ prefix)
        const lsMatch = line.match(/^([d\-lrwxst@]+)\s+(\d+|\?)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\d+\s+[\d:]+|\S+\s+\d+\s+\d{4})\s+(.+)$/);
        if (lsMatch) {
            let [, permissions, , , , size, date, name] = lsMatch;

            // Trim whitespace from name
            name = name.trim();

            // Strip ./ prefix from Hetzner-style output
            if (name.startsWith('./')) {
                name = name.substring(2);
            }

            // Filter out . and .. directory entries (with various possible formats)
            const baseName = name.split('/').pop() || name;
            if (baseName === '.' || baseName === '..' || name === '.' || name === '..' || name === '') {
                console.log('📂 [parseSftpListing] Skipping special entry:', name);
                continue;
            }

            const isDir = permissions.startsWith('d');
            const isLink = permissions.startsWith('l');

            // Handle symlinks (name -> target)
            let displayName = name;
            if (isLink && name.includes(' -> ')) {
                displayName = name.split(' -> ')[0].trim();
            }

            // Some SFTP servers (notably Hetzner Storage Box) print the absolute path
            // in the name column when listing an absolute directory. Reduce to basename
            // so the UI shows just the folder/file name and so we can build child paths
            // correctly.
            const lastSlash = displayName.lastIndexOf('/');
            if (lastSlash !== -1) {
                displayName = displayName.substring(lastSlash + 1);
            }
            displayName = displayName.trim();
            if (!displayName || displayName === '.' || displayName === '..') {
                continue;
            }

            // Build full path - handle root path properly
            let fullPath;
            if (targetPath === '/' || targetPath === '.' || targetPath === '') {
                fullPath = `/${displayName}`;
            } else {
                fullPath = `${targetPath.replace(/\/$/, '')}/${displayName}`;
            }

            items.push({
                name: displayName,
                type: isDir ? 'folder' : 'file',
                permissions,
                size: parseInt(size, 10),
                modified: date,
                path: fullPath,  // Frontend expects 'path', not 'fullPath'
                is_borg_repo: false
            });

            console.log('📂 [parseSftpListing] Parsed item:', displayName, isDir ? '(folder)' : '(file)');
        } else {
            // Log unmatched lines for debugging
            if (trimmedLine.length > 0 && !trimmedLine.startsWith('sftp')) {
                console.log('📂 [parseSftpListing] Unmatched line:', trimmedLine);
            }
        }
    }

    console.log('📂 [parseSftpListing] Found', items.length, 'items');
    return items;
}

/**
 * Browse remote directory using SFTP (for servers that don't allow SSH shell access)
 * This is used for Hetzner Storage Boxes and similar SFTP-only servers
 */
async function browseSftp(host, port, username, authMethod, sshKey, ssh_password, targetPath, env) {
    const { execa } = require('execa');
    const fs = require('fs-extra');
    const path = require('path');

    let tempKeyPath = null;

    try {
        // Build sftp command
        let sftpArgs = [];

        if (authMethod === 'key') {
            tempKeyPath = path.join('/tmp', `sftp-browse-${Date.now()}`);
            await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

            if (sshKey.is_encrypted && sshKey.passphrase) {
                env.SSHPASS = sshKey.passphrase;
                sftpArgs = ['sshpass', '-e', 'sftp'];
            } else {
                sftpArgs = ['sftp'];
            }
            // IdentitiesOnly=yes: offer ONLY the selected key (see ssh-browse
            // note) so the remote sshd doesn't log a "Failed publickey" per
            // mounted /root/.ssh key and trip fail2ban.
            sftpArgs.push('-i', tempKeyPath, '-o', 'IdentitiesOnly=yes');
        } else {
            env.SSHPASS = ssh_password;
            sftpArgs = ['sshpass', '-e', 'sftp', ...PASSWORD_AUTH_SFTP_FLAGS];
        }

        // Add SFTP options.
        // ControlMaster lets rapid successive browses reuse one authenticated
        // session instead of a fresh TCP+auth per click (keyed on host/port/user
        // via %C — it even shares the master created by the SSH browse path).
        // Cuts connection churn on the remote sshd so fail2ban isn't tickled.
        sftpArgs.push(
            '-oStrictHostKeyChecking=accept-new',
            '-oUserKnownHostsFile=/dev/null',
            '-oConnectTimeout=10',
            '-oBatchMode=no',
            '-oControlMaster=auto',
            `-oControlPath=${browseControlPathOpt(authMethod, sshKey && sshKey.id, ssh_password)}`,
            '-oControlPersist=20',
            '-P', port.toString(),
            `${username}@${host}`
        );

        // Use -b - for batch mode with stdin
        // Commands: pwd to see actual path, then ls -la
        // On Hetzner, "/" is the user's home - use "." for current directory
        const actualPath = targetPath === '/' ? '.' : targetPath;
        const sftpCommands = `pwd\nls -la ${actualPath}\nexit\n`;

        console.log('📂 [ssh-browse] Trying SFTP mode for:', host, 'path:', targetPath);

        const result = await execa(sftpArgs[0], sftpArgs.slice(1), {
            input: sftpCommands,
            env,
            timeout: 20000,
            reject: false
        });

        // Clean up temp key
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }

        // Debug: Log raw SFTP output
        console.log('📂 [ssh-browse] SFTP stdout:', result.stdout);
        console.log('📂 [ssh-browse] SFTP stderr:', result.stderr);
        console.log('📂 [ssh-browse] SFTP exit code:', result.exitCode);

        if (result.exitCode !== 0) {
            const errorMsg = result.stderr || result.stdout || 'SFTP connection failed';
            throw new Error(errorMsg);
        }

        // Parse actual path from pwd output. On chrooted SFTP (Hetzner Storage Box),
        // pwd returns the user's effective home directory, which is the highest path
        // they can navigate to.
        let homePath = null;
        const pwdMatch = result.stdout.match(/Remote working directory:\s*(.+)/);
        if (pwdMatch) {
            homePath = pwdMatch[1].trim();
            console.log('📂 [ssh-browse] Reported home/working directory:', homePath);
        }

        // Determine the absolute base path that the listed entries belong to. Use
        // homePath only when the request was for the synthetic root ('/' or '.').
        // Otherwise the user is navigating an explicit absolute path and we must
        // build child paths from it (NOT from pwd, which never changes).
        const isRootRequest = !targetPath || targetPath === '/' || targetPath === '.';
        const basePath = isRootRequest ? (homePath || '/') : targetPath;

        const items = parseSftpListing(result.stdout, basePath);

        return {
            success: true,
            items,
            currentPath: basePath,
            homePath,
            mode: 'sftp'
        };
    } catch (error) {
        // Clean up temp key
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }
        throw error;
    }
}

// ALWAYS log route registration (critical for debugging)
console.log('📝 [browsing.js] About to register POST /ssh-browse route...');
router.post('/ssh-browse', authenticateToken, requireAdmin, async (req, res) => {
    let tempKeyPath = null; // Declare at function scope for cleanup in catch blocks

    console.log('📥 [ssh-browse] Request received:', {
        host: req.body.host,
        port: req.body.port,
        username: req.body.username,
        ssh_key_id: req.body.ssh_key_id,
        ssh_auth_method: req.body.ssh_auth_method,
        remote_path: req.body.remote_path,
        use_sftp: req.body.use_sftp
    });

    try {
        const {
            host,
            port = 22,
            username,
            ssh_key_id,
            ssh_auth_method,
            ssh_password,
            remote_path = '/',
            use_sftp = false  // Force SFTP mode (for Hetzner Storage Boxes, etc.)
        } = req.body;

        if (!host || !username) {
            return res.status(400).json({
                success: false,
                detail: 'Host and username are required'
            });
        }

        const authMethod = ssh_auth_method || (ssh_key_id ? 'key' : 'password');

        if (authMethod === 'key' && !ssh_key_id) {
            return res.status(400).json({
                success: false,
                detail: 'SSH key is required for key authentication'
            });
        }

        if (authMethod === 'password' && (!ssh_password || ssh_password.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                detail: 'SSH password is required for password authentication'
            });
        }

        // Get SSH key if using key auth
        let sshKey = null;
        if (authMethod === 'key') {
            console.log('🔍 [ssh-browse] Looking up SSH key with ID:', ssh_key_id, 'type:', typeof ssh_key_id);
            const sshKeysAPI = require('../../services/ssh-keys');
            try {
                sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);
                console.log('🔍 [ssh-browse] SSH key lookup result:', sshKey ? `Found key: ${sshKey.name || sshKey.id}` : 'Not found');
            } catch (keyError) {
                console.error('❌ [ssh-browse] Error retrieving SSH key:', keyError.message);
                console.error('❌ [ssh-browse] Error stack:', keyError.stack);
                return res.status(500).json({
                    success: false,
                    detail: `Failed to retrieve SSH key: ${keyError.message}`
                });
            }

            if (!sshKey) {
                console.error('❌ [ssh-browse] SSH key not found for ID:', ssh_key_id);
                return res.status(404).json({
                    success: false,
                    detail: `SSH key not found (ID: ${ssh_key_id})`
                });
            }
        }

        // Detect Hetzner Storage Box by hostname pattern
        const isLikelyHetzner = host.includes('.your-storagebox.de') || host.includes('storagebox');
        const forceSftp = use_sftp || isLikelyHetzner;

        try {
            const { execa } = require('execa');
            const fs = require('fs-extra');
            const path = require('path');
            const env = { ...process.env };

            // Determine target path
            let targetPath = remote_path;
            if (!targetPath || targetPath.trim() === '') {
                // For SFTP-only servers, start at root or home
                targetPath = '/';
            }

            // If SFTP mode is forced (e.g., Hetzner), use SFTP directly
            if (forceSftp) {
                console.log('📂 [ssh-browse] Using SFTP mode (forced or Hetzner detected)');
                try {
                    const sftpResult = await browseSftp(host, port, username, authMethod, sshKey, ssh_password, targetPath, env);
                    return res.json({
                        success: true,
                        data: {
                            items: sftpResult.items,
                            currentPath: sftpResult.currentPath,
                            homePath: sftpResult.homePath || null,
                            mode: 'sftp'
                        }
                    });
                } catch (sftpError) {
                    const rawError = sftpError.message || sftpError.toString();
                    const friendlyError = parseSSHError(rawError, '');
                    console.error('SFTP browse error:', rawError);
                    return res.status(500).json({
                        success: false,
                        detail: `SFTP browse failed: ${friendlyError}`
                    });
                }
            }

            // Standard SSH mode - try SSH command execution first
            // Prepare SSH command
            let sshCmd;
            if (authMethod === 'key') {
                // Write temp key file
                tempKeyPath = path.join('/tmp', `ssh-browse-${Date.now()}`);
                await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

                // IdentitiesOnly=yes is CRITICAL: without it, ssh offers every
                // key it can find (the container mounts /root/.ssh) BEFORE the
                // one we selected with -i. Each rejected key logs a
                // "Failed publickey" line on the remote sshd, and since the
                // browser opens several short-lived connections per click, that
                // flood trips fail2ban and bans the user after a folder or two.
                // Restricting auth to exactly the chosen key means one clean,
                // successful auth per connection and nothing for fail2ban to count.
                if (sshKey.is_encrypted && sshKey.passphrase) {
                    env.SSHPASS = sshKey.passphrase;
                    sshCmd = ['sshpass', '-e', 'ssh', '-i', tempKeyPath, '-o', 'IdentitiesOnly=yes'];
                } else {
                    sshCmd = ['ssh', '-i', tempKeyPath, '-o', 'IdentitiesOnly=yes'];
                }
            } else {
                // Use sshpass for password auth.
                // PASSWORD_AUTH_SSH_FLAGS pins the connection to password-only
                // auth so /root/.ssh keys aren't offered first (see flag comment).
                env.SSHPASS = ssh_password;
                sshCmd = ['sshpass', '-e', 'ssh', ...PASSWORD_AUTH_SSH_FLAGS];
            }

            // CRITICAL (fail2ban): reuse ONE SSH connection for every command this
            // browse runs. A single ssh-browse opens multiple short-lived sessions
            // (the `ls`, the home lookup, and the Borg-repo probe), and on some
            // setups one of those secondary sessions ends up doing password auth —
            // producing "Failed password" lines on the remote sshd that ban the
            // user after a couple of clicks. ControlMaster authenticates ONCE and
            // multiplexes every later command over that master socket (no new TCP,
            // no re-auth). ControlPersist keeps it briefly alive so rapid clicking
            // reuses it too. Keyed on host/port/user (%C), so distinct sources keep
            // separate masters. If the socket can't be created, ssh falls back to a
            // normal connection — so this is safe.
            sshCmd.push(
                '-o', 'ControlMaster=auto',
                '-o', `ControlPath=${browseControlPathOpt(authMethod, ssh_key_id, ssh_password)}`,
                '-o', 'ControlPersist=20'
            );

            // Default to user's home directory if path is empty or not provided
            // But allow "/" to be browsed directly (especially for root users)
            if (!targetPath || targetPath.trim() === '') {
                // Get user's home directory using the same auth method (reuse sshCmd we already built)
                const homeCmd = [...sshCmd];
                homeCmd.push(
                    '-o', 'StrictHostKeyChecking=accept-new',
                    '-o', 'UserKnownHostsFile=/dev/null',
                    '-o', 'ConnectTimeout=10',
                    '-p', port.toString(),
                    `${username}@${host}`,
                    'echo $HOME'
                );

                try {
                    const homeResult = await execa(homeCmd[0], homeCmd.slice(1), { env, timeout: 10000 });
                    const homeDir = homeResult.stdout.trim();
                    targetPath = homeDir || (username === 'root' ? '/root' : `/home/${username}`);
                } catch (homeError) {
                    // Fallback to /home/username or /root
                    targetPath = username === 'root' ? '/root' : `/home/${username}`;
                }
            } else if (targetPath === '/') {
                // Allow browsing root directory directly - don't convert to /root
                targetPath = '/';
            }

            // Add SSH options
            // Note: Don't use BatchMode=yes with password auth (sshpass needs to interact with prompts)
            // Use UserKnownHostsFile=/dev/null to avoid known_hosts permission issues
            sshCmd.push(
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'ConnectTimeout=10',
                '-p', port.toString(),
                `${username}@${host}`,
                `ls -la "${targetPath}" 2>/dev/null || echo "ERROR: Cannot access path"`
            );

            let result;
            let usedSftp = false;
            try {
                result = await execa(sshCmd[0], sshCmd.slice(1), {
                    env,
                    timeout: 15000
                });
            } catch (execError) {
                // Check if this is an SFTP-only server (no shell access)
                const rawError = execError.stderr || execError.message || '';
                const isNoShellError = rawError.includes('not allowed') ||
                    rawError.includes('no shell') ||
                    rawError.includes('shell request failed') ||
                    rawError.includes('This service allows sftp connections only');

                if (isNoShellError) {
                    // Fallback to SFTP mode
                    console.log('📂 [ssh-browse] SSH shell not allowed, falling back to SFTP mode');
                    try {
                        const sftpResult = await browseSftp(host, port, username, authMethod, sshKey, ssh_password, targetPath, env);

                        // Clean up SSH temp key (SFTP creates its own)
                        if (tempKeyPath) {
                            await fs.remove(tempKeyPath).catch(() => { });
                        }

                        return res.json({
                            success: true,
                            data: {
                                items: sftpResult.items,
                                currentPath: sftpResult.currentPath,
                                homePath: sftpResult.homePath || null,
                                mode: 'sftp',
                                note: 'This server only allows SFTP connections (no SSH shell)'
                            }
                        });
                    } catch (sftpError) {
                        // Clean up temp key
                        if (tempKeyPath) {
                            await fs.remove(tempKeyPath).catch(() => { });
                        }
                        const sftpRawError = sftpError.message || sftpError.toString();
                        const friendlyError = parseSSHError(sftpRawError, '');
                        console.error('SFTP fallback error:', sftpRawError);
                        return res.status(500).json({
                            success: false,
                            detail: `SFTP browse failed: ${friendlyError}`
                        });
                    }
                }

                // Clean up temp key
                if (tempKeyPath) {
                    await fs.remove(tempKeyPath).catch(() => { });
                }

                // execa throws on non-zero exit codes
                // Parse the error to provide a user-friendly message
                const friendlyError = parseSSHError(rawError, execError.stdout);
                console.error('SSH browse raw error:', rawError);
                return res.status(500).json({
                    success: false,
                    detail: `SSH browse failed: ${friendlyError}`
                });
            }

            const stdout = result.stdout || '';
            const stderr = result.stderr || '';

            // Clean up temp key
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => { });
            }

            // Check if stderr contains meaningful errors (not just warnings)
            if (stderr) {
                const parsedError = parseSSHError(stderr, stdout);
                // Only log if it's not just filtered warnings
                if (parsedError !== 'SSH connection failed - check your credentials and connection settings') {
                    console.warn('SSH browse stderr (filtered):', parsedError);
                }
            }

            // Parse ls output
            const items = [];
            const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('total'));
            const folders = [];

            for (const line of lines) {
                // Skip error messages
                if (line.includes('ERROR:')) {
                    return res.status(404).json({
                        success: false,
                        detail: line.replace('ERROR:', '').trim() || 'Cannot access path'
                    });
                }

                // Parse: permissions links owner group size date time name
                // More flexible regex to handle different ls -la formats
                // Format: drwxr-xr-x 2 user user 4096 Jan 1 12:00 folder
                // Or: drwxr-xr-x 2 user user 4096 2024-01-01 12:00 folder
                const match = line.match(/^([d-])([rwx-]{9})\s+\d+\s+\S+\s+\S+\s+\d+\s+(\S+\s+\d+\s+\S+|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
                if (match) {
                    const isDir = match[1] === 'd';
                    const name = match[4].trim();

                    // Skip . and ..
                    if (name === '.' || name === '..') continue;

                    const fullPath = targetPath === '/'
                        ? `/${name}`
                        : `${targetPath.replace(/\/$/, '')}/${name}`;

                    items.push({
                        name: name,
                        type: isDir ? 'folder' : 'file',
                        path: fullPath,
                        is_borg_repo: false
                    });

                    if (isDir) {
                        folders.push({ name, fullPath });
                    }
                }
            }

            // Try to detect Borg repositories among folders
            // We check for config file containing [repository] and data directory
            if (folders.length > 0 && folders.length <= 50) {
                try {
                    // Shell-escape function to prevent command injection
                    const shellEscape = (str) => {
                        // Use single quotes and escape any single quotes within
                        return "'" + str.replace(/'/g, "'\"'\"'") + "'";
                    };

                    // Build a command to check multiple folders at once
                    const checkScript = folders.map(f => {
                        const safePath = shellEscape(f.fullPath);
                        const safeName = shellEscape(f.name);
                        return `if [ -f ${safePath}/config ] && [ -d ${safePath}/data ] && grep -q '\\[repository\\]' ${safePath}/config 2>/dev/null; then echo "BORG:"${safeName}; fi`;
                    }).join('; ');

                    const borgCheckCmd = [...sshCmd.slice(0, -1), checkScript];

                    const borgCheckResult = await execa(borgCheckCmd[0], borgCheckCmd.slice(1), {
                        env,
                        timeout: 10000,
                        reject: false
                    });

                    if (borgCheckResult.stdout) {
                        const borgFolders = new Set(
                            borgCheckResult.stdout.split('\n')
                                .filter(line => line.startsWith('BORG:'))
                                .map(line => line.replace('BORG:', '').trim())
                        );

                        // Mark borg repos in items
                        for (const item of items) {
                            if (borgFolders.has(item.name)) {
                                item.is_borg_repo = true;
                            }
                        }
                    }
                } catch (borgCheckError) {
                    // Silent fail - just don't mark any as borg repos
                    console.warn('Borg repo detection failed:', borgCheckError.message);
                }
            }

            return res.json({
                success: true,
                data: {
                    items: items.sort((a, b) => {
                        // Borg repos first, then folders, then alphabetical
                        if (a.is_borg_repo && !b.is_borg_repo) return -1;
                        if (!a.is_borg_repo && b.is_borg_repo) return 1;
                        if (a.type === 'folder' && b.type !== 'folder') return -1;
                        if (a.type !== 'folder' && b.type === 'folder') return 1;
                        return a.name.localeCompare(b.name);
                    }),
                    currentPath: targetPath
                }
            });
        } catch (browseError) {
            // Clean up temp key if it exists
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => { });
            }
            console.error('SSH browse error:', browseError);
            const rawError = browseError.stderr || browseError.message || browseError.toString();
            const friendlyError = parseSSHError(rawError, browseError.stdout);
            return res.status(500).json({
                success: false,
                detail: `SSH browse failed: ${friendlyError}`,
                error: process.env.NODE_ENV === 'development' ? browseError.stack : undefined
            });
        }
    } catch (error) {
        // Clean up temp key if it exists
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }
        console.error('Failed to browse SSH/SFTP:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            detail: `Failed to browse SSH/SFTP: ${error.message}`,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});
console.log('✅ [browsing.js] POST /ssh-browse route registered successfully');

/**
 * Create directory on SSH/SFTP server using SFTP
 * For SFTP-only servers like Hetzner Storage Boxes
 */
async function createFolderSftp(host, port, username, authMethod, sshKey, ssh_password, remotePath, env) {
    const { execa } = require('execa');
    const fs = require('fs-extra');
    const path = require('path');

    let tempKeyPath = null;

    try {
        // Build sftp command
        let sftpArgs = [];

        if (authMethod === 'key') {
            tempKeyPath = path.join('/tmp', `sftp-mkdir-${Date.now()}`);
            await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

            if (sshKey.is_encrypted && sshKey.passphrase) {
                env.SSHPASS = sshKey.passphrase;
                sftpArgs = ['sshpass', '-e', 'sftp'];
            } else {
                sftpArgs = ['sftp'];
            }
            // IdentitiesOnly=yes: offer ONLY the selected key (see ssh-browse
            // note) so the remote sshd doesn't log a "Failed publickey" per
            // mounted /root/.ssh key and trip fail2ban.
            sftpArgs.push('-i', tempKeyPath, '-o', 'IdentitiesOnly=yes');
        } else {
            env.SSHPASS = ssh_password;
            sftpArgs = ['sshpass', '-e', 'sftp', ...PASSWORD_AUTH_SFTP_FLAGS];
        }

        // Add SFTP options (ControlMaster reuses the browse session; see the
        // browseSftp note — keeps connection churn off the remote sshd/fail2ban).
        sftpArgs.push(
            '-oStrictHostKeyChecking=accept-new',
            '-oUserKnownHostsFile=/dev/null',
            '-oConnectTimeout=10',
            '-oBatchMode=no',
            '-oControlMaster=auto',
            `-oControlPath=${browseControlPathOpt(authMethod, sshKey && sshKey.id, ssh_password)}`,
            '-oControlPersist=20',
            '-P', port.toString(),
            `${username}@${host}`
        );

        // SFTP mkdir command - handle path starting with / by making it relative to home
        // On Hetzner, the user's home is the root, so /borgrepo becomes ./borgrepo
        let sftpPath = remotePath;
        if (sftpPath.startsWith('/')) {
            sftpPath = '.' + sftpPath;
        }

        const sftpCommands = `mkdir ${sftpPath}\nexit\n`;

        console.log('📁 [ssh-create-folder] Creating folder via SFTP:', sftpPath);

        const result = await execa(sftpArgs[0], sftpArgs.slice(1), {
            input: sftpCommands,
            env,
            timeout: 20000,
            reject: false
        });

        // Clean up temp key
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }

        console.log('📁 [ssh-create-folder] SFTP stdout:', result.stdout);
        console.log('📁 [ssh-create-folder] SFTP stderr:', result.stderr);

        // Check for errors in output
        const hasError = result.stderr?.includes('Couldn\'t') ||
            result.stderr?.includes('Permission denied') ||
            result.stderr?.includes('No such file') ||
            result.stdout?.includes('Couldn\'t');

        if (hasError) {
            throw new Error(result.stderr || result.stdout || 'Failed to create directory');
        }

        return { success: true };
    } catch (error) {
        // Clean up temp key
        if (tempKeyPath) {
            await fs.remove(tempKeyPath).catch(() => { });
        }
        throw error;
    }
}

/**
 * Create directory on SSH/SFTP server
 * POST /api/repositories/ssh-create-folder
 */
console.log('📝 [browsing.js] About to register POST /ssh-create-folder route...');
router.post('/ssh-create-folder', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            host,
            port = 22,
            username,
            ssh_key_id,
            ssh_auth_method,
            ssh_password,
            remote_path,
            use_sftp = false
        } = req.body;

        if (!host || !username || !remote_path) {
            return res.status(400).json({
                success: false,
                detail: 'Host, username, and remote_path are required'
            });
        }

        const authMethod = ssh_auth_method || (ssh_key_id ? 'key' : 'password');

        if (authMethod === 'key' && !ssh_key_id) {
            return res.status(400).json({
                success: false,
                detail: 'SSH key is required for key authentication'
            });
        }

        if (authMethod === 'password' && (!ssh_password || ssh_password.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                detail: 'SSH password is required for password authentication'
            });
        }

        // Get SSH key if using key auth
        let sshKey = null;
        if (authMethod === 'key') {
            const sshKeysAPI = require('../../services/ssh-keys');
            sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);

            if (!sshKey) {
                return res.status(404).json({
                    success: false,
                    detail: 'SSH key not found'
                });
            }
        }

        // Detect Hetzner Storage Box by hostname pattern
        const isLikelyHetzner = host.includes('.your-storagebox.de') || host.includes('storagebox');
        const forceSftp = use_sftp || isLikelyHetzner;

        const env = { ...process.env };

        // Use SFTP for Hetzner and other SFTP-only servers
        if (forceSftp) {
            console.log('📁 [ssh-create-folder] Using SFTP mode for:', host);
            try {
                await createFolderSftp(host, port, username, authMethod, sshKey, ssh_password, remote_path, env);
                return res.json({
                    success: true,
                    detail: 'Folder created successfully',
                    mode: 'sftp'
                });
            } catch (sftpError) {
                const errorMsg = parseSSHError(sftpError.message || sftpError.toString(), '');
                console.error('SFTP mkdir error:', sftpError.message);
                return res.status(500).json({
                    success: false,
                    detail: `Failed to create directory: ${errorMsg}`
                });
            }
        }

        // Standard SSH mode
        try {
            const { execa } = require('execa');
            const fs = require('fs-extra');
            const path = require('path');

            let tempKeyPath = null;

            // Prepare SSH command
            let sshCmd;
            if (authMethod === 'key') {
                tempKeyPath = path.join('/tmp', `ssh-create-${Date.now()}`);
                await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });

                // IdentitiesOnly=yes — offer only the selected key (see the
                // ssh-browse note) so rejected /root/.ssh keys don't pile up
                // "Failed publickey" lines and trip fail2ban.
                if (sshKey.is_encrypted && sshKey.passphrase) {
                    env.SSHPASS = sshKey.passphrase;
                    sshCmd = ['sshpass', '-e', 'ssh', '-i', tempKeyPath, '-o', 'IdentitiesOnly=yes'];
                } else {
                    sshCmd = ['ssh', '-i', tempKeyPath, '-o', 'IdentitiesOnly=yes'];
                }
            } else {
                // Password-only auth (see PASSWORD_AUTH_SSH_FLAGS rationale).
                env.SSHPASS = ssh_password;
                sshCmd = ['sshpass', '-e', 'ssh', ...PASSWORD_AUTH_SSH_FLAGS];
            }

            // Create directory with mkdir -p (creates parent directories if needed).
            // ControlMaster reuses the browse's authenticated session (same %C),
            // so creating a folder doesn't open an extra connection to the remote
            // sshd — see the browse note re: fail2ban.
            sshCmd.push(
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'ConnectTimeout=10',
                '-o', 'ControlMaster=auto',
                '-o', `ControlPath=${browseControlPathOpt(authMethod, ssh_key_id, ssh_password)}`,
                '-o', 'ControlPersist=20',
                '-p', port.toString(),
                `${username}@${host}`,
                `mkdir -p "${remote_path}" && echo "SUCCESS"`
            );

            let result;
            try {
                result = await execa(sshCmd[0], sshCmd.slice(1), {
                    env,
                    timeout: 15000
                });
            } catch (execError) {
                // Clean up temp key
                if (tempKeyPath) {
                    await fs.remove(tempKeyPath).catch(() => { });
                }

                const errorMsg = execError.stderr || execError.message || '';
                return res.status(500).json({
                    success: false,
                    detail: `Failed to create directory: ${parseSSHError(errorMsg, '')}`
                });
            }

            const stdout = result.stdout || '';

            // Clean up temp key
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => { });
            }

            if (stdout.includes('SUCCESS')) {
                return res.json({
                    success: true,
                    data: {
                        message: `Directory created: ${remote_path}`
                    }
                });
            } else {
                return res.status(500).json({
                    success: false,
                    detail: 'Failed to create directory'
                });
            }
        } catch (createError) {
            const errorMsg = createError.stderr || createError.message || '';
            return res.status(500).json({
                success: false,
                detail: `Failed to create directory: ${errorMsg}`
            });
        }
    } catch (error) {
        console.error('Failed to create SSH/SFTP directory:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to create SSH/SFTP directory'
        });
    }
});

// ALWAYS log registered routes (critical for debugging)
console.log('📋 [browsing.js] All routes registered. Router stack:', router.stack?.length || 0, 'routes');
if (router.stack) {
    router.stack.forEach((layer, idx) => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
            console.log(`  [${idx}] ${methods} ${layer.route.path}`);
        } else if (layer.name === 'router') {
            console.log(`  [${idx}] Sub-router mounted at: ${layer.regexp}`);
        }
    });
}
console.log('✅ [browsing.js] Module ready, exporting router');

module.exports = router;
