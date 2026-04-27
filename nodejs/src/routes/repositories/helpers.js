const fs = require('fs-extra');
const path = require('path');
// os module removed - using config.dataDir for SSH keys storage

/**
 * Detect whether a host is a Hetzner Storage Box.
 * Used to decide whether to apply the relative-to-home path normalization.
 * @param {string} host
 * @returns {boolean}
 */
function isHetznerHost(host) {
    if (!host) return false;
    const h = String(host).toLowerCase();
    return /\.your-storagebox\.de$/.test(h) || h.includes('storagebox');
}

/**
 * Normalize a user-entered repository path for a Hetzner Storage Box.
 *
 * Background: Hetzner Storage Boxes expose two views of the same filesystem:
 *   - Over SFTP, the daemon chroots into a virtual root that contains /home,
 *     so the folder browser sees the writable area as "/home/<dir>".
 *   - Over SSH (which is what Borg uses), the user lands directly in their
 *     home directory; what SFTP calls "/home/<dir>" is "~/<dir>" over SSH.
 *
 * Consequence: an absolute SSH path like "/test" points at the chroot's
 * read-only virtual root, and `borg init` fails with
 *   OSError: [Errno 30] Read-only file system: '/test'
 *
 * Fix: always express Hetzner paths as relative to the user's home directory
 * using Borg's "/./<rel>" syntax, and strip any "/home/" prefix that may have
 * leaked in from the SFTP folder browser.
 *
 * @param {string} repoPath
 * @returns {string} Path component beginning with "/./" (e.g. "/./backups")
 */
function normalizeHetznerRepoPath(repoPath) {
    let p = String(repoPath || '').trim();
    p = p.replace(/^local:/i, '');
    p = p.replace(/^\/+home\/+/i, '');
    p = p.replace(/^\/+/, '');
    p = p.replace(/^\.\/+/, '');
    p = p.replace(/^~\/+/, '');
    p = p.replace(/\/+$/, '');
    if (!p) {
        p = 'borg';
    }
    return `/./${p}`;
}

/**
 * Helper function to construct SSH repository path
 * Handles version-specific path syntax:
 * - Borg 1.x: ssh://user@host:port/absolute/path (direct absolute path)
 * - Borg 1.x relative: ssh://user@host:port/./relative/path (dot prefix for relative to home)
 * - Borg 2.x: ssh://user@host:port//absolute/path (double slash for absolute)
 *
 * Hetzner Storage Boxes always use the relative-to-home form, regardless of
 * Borg version, because absolute paths target the read-only chroot root.
 *
 * @param {string} username - SSH username
 * @param {string} host - SSH host
 * @param {number} port - SSH port (default: 22)
 * @param {string} repoPath - Repository path on remote system
 * @param {string} borgVersion - '1.x' or '2.x' (default: '1.x')
 * @param {string} repositoryType - 'ssh' | 'sftp' | 'hetzner' (default: 'ssh')
 * @returns {string} SSH repository path in format ssh://user@host:port/path
 */
function constructSSHPath(username, host, port, repoPath, borgVersion = '1.x', repositoryType = 'ssh') {
    const portPart = port && port !== 22 ? `:${port}` : '';

    const treatAsHetzner = repositoryType === 'hetzner' || isHetznerHost(host);

    if (treatAsHetzner) {
        const normalizedPath = normalizeHetznerRepoPath(repoPath);
        return `ssh://${username}@${host}${portPart}${normalizedPath}`;
    }

    // Ensure path starts with /
    let normalizedPath = repoPath;
    if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
    }

    // Handle version-specific absolute path syntax
    // For absolute paths (starting with / but not /~ for home-relative, not /./ for relative)
    // Also guard against paths that already have // (user might have entered it manually)
    if (normalizedPath.startsWith('/') &&
        !normalizedPath.startsWith('/~') &&
        !normalizedPath.startsWith('/./') &&
        !normalizedPath.startsWith('//')) {
        if (borgVersion === '2.x') {
            // Borg 2.x: double slash for absolute paths (ssh://user@host:port//absolute/path)
            normalizedPath = '/' + normalizedPath; // results in //absolute/path
        }
        // Borg 1.x: absolute paths work directly (ssh://user@host:port/absolute/path)
        // No modification needed for 1.x
    }

    return `ssh://${username}@${host}${portPart}${normalizedPath}`;
}

/**
 * Helper function to construct S3 repository path for Borg 2.x
 * Borg 2.x S3 URL format: s3:[access_key_id:access_key_secret@][schema://hostname[:port]]/bucket/path
 * 
 * Examples:
 * - AWS S3: s3:ACCESSKEY:SECRETKEY@bucket/path
 * - Custom endpoint: s3:ACCESSKEY:SECRETKEY@https://fsn1.your-objectstorage.com/bucket/path
 * 
 * @param {string} accessKey - S3 access key
 * @param {string} secretKey - S3 secret key
 * @param {string} bucket - S3 bucket name
 * @param {string} s3Path - Path within bucket
 * @param {string} endpoint - S3 endpoint URL (optional, required for non-AWS S3)
 * @returns {string} S3 repository path in Borg 2.x format
 */
function constructS3Path(accessKey, secretKey, bucket, s3Path, endpoint) {
    // Borg 2.x format: s3:access_key:secret@[https://host]/bucket/path
    // The schema (https://) must be included for custom endpoints
    
    // Normalize the path within the bucket (remove leading slash)
    const pathPart = s3Path ? s3Path.replace(/^\/+/, '') : '';
    const fullPath = pathPart ? `${bucket}/${pathPart}` : bucket;
    
    if (endpoint) {
        // Custom endpoint (Hetzner, Wasabi, MinIO, etc.)
        // Ensure it has https:// prefix (Borg 2.x requires the schema for custom endpoints)
        let endpointUrl = endpoint.replace(/\/+$/, ''); // Remove trailing slashes
        if (!endpointUrl.startsWith('http://') && !endpointUrl.startsWith('https://')) {
            endpointUrl = `https://${endpointUrl}`;
        }
        
        return `s3:${accessKey}:${secretKey}@${endpointUrl}/${fullPath}`;
    } else {
        // AWS S3 (no endpoint needed - Borg 2.x defaults to AWS)
        return `s3:${accessKey}:${secretKey}@${fullPath}`;
    }
}

/**
 * Write SSH key to filesystem for borgmatic to use
 * @param {string|number} sshKeyId - SSH key ID
 * @param {string} privateKey - Decrypted private key content
 * @param {string|null} passphrase - Optional passphrase for encrypted keys
 * @returns {Promise<string>} Path to the written key file
 */
async function writeSSHKeyToFilesystem(sshKeyId, privateKey, passphrase = null) {
    try {
        const sshKeysAPI = require('../../services/ssh-keys');
        const sshKey = await sshKeysAPI.getSSHKey(sshKeyId);

        if (!sshKey) {
            throw new Error(`SSH key ${sshKeyId} not found`);
        }

        // Use /app/data/ssh-keys which is writable in Docker, fallback to ~/.ssh for non-Docker
        const config = require('../../config');
        const sshDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
        await fs.ensureDir(sshDir);
        // Ensure proper permissions on the directory
        await fs.chmod(sshDir, 0o700);

        // Use key name or generate filename
        // Sanitize filename to prevent path traversal attacks
        let keyFilename = sshKey.name || `borgmatic_${sshKeyId}`;
        // Remove path traversal sequences and normalize
        keyFilename = keyFilename.replace(/\.\./g, '').replace(/[\/\\]/g, '_');
        // Ensure filename is safe (alphanumeric, dash, underscore only)
        keyFilename = keyFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
        // Limit length to prevent issues
        if (keyFilename.length > 100) {
            keyFilename = keyFilename.substring(0, 100);
        }
        const keyPath = path.join(sshDir, keyFilename);

        // Write private key with secure permissions
        await fs.writeFile(keyPath, privateKey, { mode: 0o600 });

        // If key is encrypted, we need to handle it for borgmatic
        // Borgmatic can use encrypted keys via ssh-agent or by providing passphrase
        // For now, we'll write the encrypted key as-is and borgmatic will prompt if needed
        // In the future, we could use ssh-agent or provide passphrase via SSH_ASKPASS
        if (passphrase) {
            console.log(`🔐 SSH key is encrypted. Passphrase stored for use with ssh-agent or SSH_ASKPASS`);
            // Note: We could add the key to ssh-agent here, but that requires ssh-add
            // For now, the encrypted key is written and borgmatic will handle it
        }

        console.log(`✅ SSH key written to: ${keyPath}`);
        return keyPath;
    } catch (error) {
        console.error('Failed to write SSH key to filesystem:', error.message);
        throw error;
    }
}

/**
 * Helper function to construct native Rclone repository path (Borg 2.x only)
 * @param {string} remote - Rclone remote name
 * @param {string} rclonePath - Path within the remote
 * @returns {string} Native Rclone path in format rclone:remote:path
 */
function constructNativeRclonePath(remote, rclonePath) {
    // Format for Borg 2.x native Rclone: rclone:remote:path
    // Note: No "//" after rclone:, just "rclone:remote:path"
    const pathPart = rclonePath.startsWith('/') ? rclonePath.substring(1) : rclonePath;
    return `rclone:${remote}:${pathPart}`;
}

module.exports = {
    constructSSHPath,
    constructS3Path,
    constructNativeRclonePath,
    writeSSHKeyToFilesystem,
    isHetznerHost,
    normalizeHetznerRepoPath
};

