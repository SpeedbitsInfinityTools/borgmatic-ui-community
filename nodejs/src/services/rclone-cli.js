/**
 * Rclone CLI Service
 * 
 * Uses the rclone CLI binary on the host system (via /host mount) for cloud storage operations.
 * This is simpler than RCD and doesn't require credentials or a running daemon.
 * 
 * For containerized deployments, rclone should be installed on the HOST system,
 * and accessible via /host/usr/bin/rclone or similar path.
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Execute a command and return stdout/stderr
 * @param {string} command - Command to run
 * @param {string[]} args - Arguments
 * @param {object} options - Options (timeout, env)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 30000;
        const env = { ...process.env, ...options.env };
        
        const proc = spawn(command, args, {
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        let killed = false;
        
        const timer = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
        
        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return;
            
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(`Command failed with exit code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                error.exitCode = code;
                reject(error);
            }
        });
        
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// Possible paths where rclone might be installed on the host
const RCLONE_PATHS = [
    '/host/usr/bin/rclone',
    '/host/usr/local/bin/rclone',
    '/host/opt/homebrew/bin/rclone', // macOS Homebrew
    '/usr/bin/rclone',  // Fallback to container's rclone if available
    '/usr/local/bin/rclone',
];

// Cache the detected rclone path
let detectedRclonePath = null;
let lastDetectionTime = 0;
const DETECTION_CACHE_MS = 60000; // Cache for 1 minute

/**
 * Find the rclone binary path
 * @returns {Promise<string|null>} Path to rclone binary or null if not found
 */
async function findRclonePath() {
    // Use cached result if recent
    if (detectedRclonePath && (Date.now() - lastDetectionTime) < DETECTION_CACHE_MS) {
        return detectedRclonePath;
    }

    for (const rclonePath of RCLONE_PATHS) {
        try {
            if (await fs.pathExists(rclonePath)) {
                // Verify it's executable
                await execCommand(rclonePath, ['version'], { timeout: 5000 });
                detectedRclonePath = rclonePath;
                lastDetectionTime = Date.now();
                console.log(`✅ [rclone-cli] Found rclone at: ${rclonePath}`);
                return rclonePath;
            }
        } catch (error) {
            // Continue to next path
        }
    }

    detectedRclonePath = null;
    lastDetectionTime = Date.now();
    return null;
}

/**
 * Check if rclone is installed and available
 * @returns {Promise<{installed: boolean, path?: string, version?: string, error?: string}>}
 */
async function checkInstallation() {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            installed: false,
            error: 'Rclone not found on host system. Please install Rclone or use Infinity Tools to set up Rclone Director.'
        };
    }

    try {
        const result = await execCommand(rclonePath, ['version'], { timeout: 5000 });
        const versionMatch = result.stdout.match(/rclone v?([\d.]+)/i);
        const version = versionMatch ? versionMatch[1] : 'unknown';

        return {
            installed: true,
            path: rclonePath,
            version
        };
    } catch (error) {
        return {
            installed: false,
            path: rclonePath,
            error: `Rclone found but not working: ${error.message}`
        };
    }
}

/**
 * Get rclone config file path
 * The config is typically at ~/.config/rclone/rclone.conf on the host
 * @returns {string}
 */
function getConfigPath() {
    // Check for host-mounted config paths
    const possiblePaths = [
        '/host/root/.config/rclone/rclone.conf',
        '/host/home/*/.config/rclone/rclone.conf', // Will need to expand
        process.env.RCLONE_CONFIG,
        path.join(process.env.HOME || '/root', '.config/rclone/rclone.conf'),
    ].filter(Boolean);

    return possiblePaths[0]; // Return first one, actual resolution happens in rclone
}

/**
 * List all configured remotes
 * @returns {Promise<{success: boolean, remotes?: Array<{name: string, type?: string}>, error?: string}>}
 */
async function listRemotes() {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            success: false,
            remotes: [],
            error: 'Rclone not installed'
        };
    }

    try {
        // Get list of remote names
        const listResult = await execCommand(rclonePath, ['listremotes'], { 
            timeout: 10000,
            env: {
                // Use host's home directory for config if available
                HOME: process.env.HOST_HOME || process.env.HOME,
            }
        });

        const remoteNames = listResult.stdout
            .split('\n')
            .map(line => line.trim().replace(/:$/, '')) // Remove trailing colon
            .filter(name => name.length > 0);

        // Get type for each remote using config dump
        const remotes = [];
        for (const name of remoteNames) {
            try {
                const configResult = await execCommand(rclonePath, ['config', 'show', name], {
                    timeout: 5000,
                    env: {
                        HOME: process.env.HOST_HOME || process.env.HOME,
                    }
                });
                
                // Parse type from config output
                const typeMatch = configResult.stdout.match(/type\s*=\s*(\S+)/i);
                const type = typeMatch ? typeMatch[1] : 'unknown';
                
                remotes.push({ name, type });
            } catch {
                // If we can't get type, still include the remote
                remotes.push({ name, type: 'unknown' });
            }
        }

        return {
            success: true,
            remotes
        };
    } catch (error) {
        return {
            success: false,
            remotes: [],
            error: `Failed to list remotes: ${error.message}`
        };
    }
}

/**
 * List directories/files at a remote path
 * @param {string} remote - Remote name (without colon)
 * @param {string} remotePath - Path within the remote
 * @param {object} options - Options
 * @param {boolean} options.dirsOnly - Only list directories
 * @returns {Promise<{success: boolean, items?: Array, error?: string}>}
 */
async function listPath(remote, remotePath = '', options = {}) {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            success: false,
            items: [],
            error: 'Rclone not installed'
        };
    }

    try {
        const fullPath = remotePath ? `${remote}:${remotePath}` : `${remote}:`;
        const cmd = options.dirsOnly ? 'lsd' : 'lsf';
        const args = [cmd, fullPath];
        
        if (!options.dirsOnly) {
            args.push('--format', 'pst'); // path, size, time
        }

        const result = await execCommand(rclonePath, args, {
            timeout: 30000,
            env: {
                HOME: process.env.HOST_HOME || process.env.HOME,
            }
        });

        const items = result.stdout
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
                if (options.dirsOnly) {
                    // lsd output format: "     -1 2024-01-15 12:00:00        -1 dirname"
                    const match = line.match(/^\s*[\d-]+\s+[\d-]+\s+[\d:]+\s+[\d-]+\s+(.+)$/);
                    return {
                        name: match ? match[1] : line.trim(),
                        isDir: true
                    };
                } else {
                    // lsf with format pst: "path;size;time"
                    const parts = line.split(';');
                    const name = parts[0] || line;
                    const isDir = name.endsWith('/');
                    return {
                        name: isDir ? name.slice(0, -1) : name,
                        size: parts[1] ? parseInt(parts[1]) : 0,
                        modTime: parts[2] || null,
                        isDir
                    };
                }
            });

        return {
            success: true,
            items
        };
    } catch (error) {
        return {
            success: false,
            items: [],
            error: `Failed to list path: ${error.message}`
        };
    }
}

/**
 * Test connection to a remote
 * @param {string} remote - Remote name
 * @param {string} remotePath - Optional path to test
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function testConnection(remote, remotePath = '') {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            success: false,
            error: 'Rclone not installed'
        };
    }

    try {
        const fullPath = remotePath ? `${remote}:${remotePath}` : `${remote}:`;
        
        // Use lsd to test if we can list the path
        await execCommand(rclonePath, ['lsd', fullPath, '--max-depth', '1'], {
            timeout: 15000,
            env: {
                HOME: process.env.HOST_HOME || process.env.HOME,
            }
        });

        return {
            success: true,
            message: 'Connection successful'
        };
    } catch (error) {
        return {
            success: false,
            error: `Connection failed: ${error.stderr || error.message}`
        };
    }
}

/**
 * Create a directory on the remote
 * @param {string} remote - Remote name
 * @param {string} remotePath - Path to create
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function mkdir(remote, remotePath) {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            success: false,
            error: 'Rclone not installed'
        };
    }

    try {
        const fullPath = `${remote}:${remotePath}`;
        await execCommand(rclonePath, ['mkdir', fullPath], {
            timeout: 30000,
            env: {
                HOME: process.env.HOST_HOME || process.env.HOME,
            }
        });

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `Failed to create directory: ${error.message}`
        };
    }
}

/**
 * Sync local path to remote (for Local + Cloud Sync mode)
 * @param {string} localPath - Local source path
 * @param {string} remote - Remote name
 * @param {string} remotePath - Destination path on remote
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sync(localPath, remote, remotePath) {
    const rclonePath = await findRclonePath();
    
    if (!rclonePath) {
        return {
            success: false,
            error: 'Rclone not installed'
        };
    }

    try {
        const destination = `${remote}:${remotePath}`;
        await execCommand(rclonePath, ['sync', localPath, destination, '--progress'], {
            timeout: 3600000, // 1 hour timeout for large syncs
            env: {
                HOME: process.env.HOST_HOME || process.env.HOME,
            }
        });

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `Sync failed: ${error.message}`
        };
    }
}

module.exports = {
    findRclonePath,
    checkInstallation,
    listRemotes,
    listPath,
    testConnection,
    mkdir,
    sync,
};
