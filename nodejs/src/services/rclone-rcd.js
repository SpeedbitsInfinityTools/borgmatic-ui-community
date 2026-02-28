/**
 * Rclone RCD (Remote Control Daemon) Client
 * 
 * NOTE: This service is ONLY used for "Direct Repository" mode mount/unmount operations.
 * For listing remotes, browsing, and testing connections, use rclone-cli.js instead.
 * 
 * RCD requires running `rclone rcd` on the host system, which is complex to set up.
 * Most users should use CLI-based operations or the "Native Cloud (Borg 2.x)" mode instead.
 * 
 * RCD API documentation: https://rclone.org/rc/
 */

// Node 18+ provides global fetch (Node 20 in our containers).
// Keep deps minimal (no axios).

// RCD connection configuration
const RCD_HOST = process.env.RCLONE_RCD_HOST || 'host.docker.internal';
const RCD_PORT = process.env.RCLONE_RCD_PORT || '5572';
const RCD_USER = process.env.RCLONE_RCD_USER || '';
const RCD_PASS = process.env.RCLONE_RCD_PASS || '';

const RCD_BASE_URL = `http://${RCD_HOST}:${RCD_PORT}`;

// Debug logging
const DEBUG = process.env.DEBUG_RCLONE === 'true';
const debugLog = (...args) => DEBUG && console.log('[rclone-rcd]', ...args);

/**
 * Make an RCD API call
 * @param {string} method - RCD method (e.g., 'config/listremotes', 'operations/list')
 * @param {object} params - Parameters for the method
 * @param {number} timeout - Request timeout in ms (default: 30000)
 * @returns {Promise<any>} - Response data
 */
async function rcdCall(method, params = {}, timeout = 30000) {
    const url = `${RCD_BASE_URL}/${method}`;
    debugLog(`POST ${url}`, params);

    const headers = {
        'Content-Type': 'application/json'
    };

    // Add auth if configured (Basic Auth)
    if (RCD_USER && RCD_PASS) {
        const token = Buffer.from(`${RCD_USER}:${RCD_PASS}`, 'utf8').toString('base64');
        headers['Authorization'] = `Basic ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
            signal: controller.signal,
        });

        const text = await resp.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { raw: text };
        }

        if (!resp.ok) {
            const errorMsg = data?.error || resp.statusText || `HTTP ${resp.status}`;
            throw new Error(`RCD error: ${errorMsg}`);
        }

        debugLog(`Response:`, data);
        return data;
    } catch (error) {
        // Normalize common network errors
        if (error?.name === 'AbortError') {
            throw new Error(`RCD request timed out after ${timeout}ms (${method})`);
        }
        const msg = String(error?.message || error);
        if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
            throw new Error(`Cannot connect to rclone RCD at ${RCD_BASE_URL}. Is rclone rcd running on the host?`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check if RCD is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
    try {
        await rcdCall('core/version', {}, 5000);
        return true;
    } catch (error) {
        debugLog('RCD not available:', error.message);
        return false;
    }
}

/**
 * Get RCD version info
 * @returns {Promise<object>}
 */
async function getVersion() {
    return rcdCall('core/version');
}

/**
 * List all configured remotes
 * @returns {Promise<string[]>} - Array of remote names (without colons)
 */
async function listRemotes() {
    const result = await rcdCall('config/listremotes');
    // RCD returns { remotes: ['remote1', 'remote2', ...] }
    return result.remotes || [];
}

/**
 * List files/directories at a path
 * @param {string} remote - Remote name (without colon)
 * @param {string} remotePath - Path within the remote
 * @param {object} options - List options
 * @param {boolean} options.dirsOnly - Only return directories
 * @param {boolean} options.filesOnly - Only return files
 * @param {boolean} options.recurse - Recurse into subdirectories
 * @returns {Promise<Array>} - Array of {Path, Name, Size, MimeType, ModTime, IsDir}
 */
async function listPath(remote, remotePath = '', options = {}) {
    const fs = `${remote}:`;
    const result = await rcdCall('operations/list', {
        fs,
        remote: remotePath,
        opt: {
            recurse: options.recurse || false,
            filesOnly: options.filesOnly || false,
            dirsOnly: options.dirsOnly || false
        }
    });
    // RCD returns { list: [...] }
    return result.list || [];
}

/**
 * List directories only at a path
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path within the remote
 * @returns {Promise<Array>} - Array of directory objects
 */
async function listDirs(remote, remotePath = '') {
    return listPath(remote, remotePath, { dirsOnly: true });
}

/**
 * Check if a path exists and is accessible
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path within the remote
 * @returns {Promise<boolean>}
 */
async function pathExists(remote, remotePath = '') {
    try {
        const fs = `${remote}:`;
        // Use operations/stat to check if path exists
        await rcdCall('operations/stat', { fs, remote: remotePath }, 15000);
        return true;
    } catch (error) {
        // Path doesn't exist or other error
        return false;
    }
}

/**
 * Test connection to a remote
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path within the remote (optional)
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function testConnection(remote, remotePath = '') {
    try {
        // Try to list the path (or root if no path)
        await listPath(remote, remotePath, { dirsOnly: false });
        return { success: true, message: 'Connection successful' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Purge (delete) a path and all its contents
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path to purge
 * @returns {Promise<void>}
 */
async function purge(remote, remotePath) {
    const fs = `${remote}:`;
    await rcdCall('operations/purge', { fs, remote: remotePath }, 60000);
}

/**
 * Create a directory
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path to create
 * @returns {Promise<void>}
 */
async function mkdir(remote, remotePath) {
    const fs = `${remote}:`;
    await rcdCall('operations/mkdir', { fs, remote: remotePath });
}

/**
 * Mount a remote to a local path (runs on the RCD host)
 * NOTE: The mount happens on the HOST where RCD is running,
 * not inside the container. The mount_path must be accessible to the host.
 * 
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path within the remote
 * @param {string} mountPath - Local path to mount to (on the host)
 * @param {object} options - Mount options
 * @returns {Promise<void>}
 */
async function mount(remote, remotePath, mountPath, options = {}) {
    const fs = remotePath ? `${remote}:${remotePath}` : `${remote}:`;
    
    await rcdCall('mount/mount', {
        fs,
        mountPoint: mountPath,
        mountOpt: {
            AllowOther: true,
            ...options
        },
        vfsOpt: {
            CacheMode: 'full'
        }
    }, 30000);
}

/**
 * Unmount a path
 * @param {string} mountPath - The mount point to unmount
 * @returns {Promise<void>}
 */
async function unmount(mountPath) {
    await rcdCall('mount/unmount', { mountPoint: mountPath });
}

/**
 * List all current mounts
 * @returns {Promise<Array>}
 */
async function listMounts() {
    const result = await rcdCall('mount/listmounts');
    return result.mountPoints || [];
}

/**
 * Run an arbitrary rclone command via RCD
 * Use with caution - prefer specific methods when available
 * @param {string} command - Rclone command (e.g., 'lsd', 'ls')
 * @param {string[]} args - Command arguments
 * @returns {Promise<{result: string, error: string}>}
 */
async function runCommand(command, args = []) {
    return rcdCall('core/command', {
        command,
        arg: args,
        returnType: 'COMBINED_OUTPUT'
    }, 60000);
}

module.exports = {
    isAvailable,
    getVersion,
    listRemotes,
    listPath,
    listDirs,
    pathExists,
    testConnection,
    purge,
    mkdir,
    mount,
    unmount,
    listMounts,
    runCommand,
    // Export config for debugging
    config: {
        host: RCD_HOST,
        port: RCD_PORT,
        baseUrl: RCD_BASE_URL
    }
};

