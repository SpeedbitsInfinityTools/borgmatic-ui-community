/**
 * Borg Version Detector Service
 * 
 * Detects the Borg version of existing repositories and provides
 * the correct binary path for each version.
 */

const { execa } = require('execa');
const path = require('path');

// Borg binary paths (from environment or defaults)
// Defaults match our dev container layout (/usr/bin/*), but can be overridden via env vars.
const BORG1_PATH = process.env.BORG1_PATH || '/usr/bin/borg1';
const BORG2_PATH = process.env.BORG2_PATH || '/usr/bin/borg2';
const DEFAULT_BORG_PATH = process.env.BORG_PATH || '/usr/bin/borg';

// Version cache to avoid repeated detection
const versionCache = new Map();

/**
 * Get the binary path for a specific Borg version
 * @param {string} version - '1.x' or '2.x'
 * @returns {string} - Path to borg binary
 */
function getBorgPath(version) {
  if (version === '1.x') {
    return BORG1_PATH;
  }
  if (version === '2.x') {
    return BORG2_PATH;
  }
  // Default to borg2 (which is symlinked to 'borg')
  return DEFAULT_BORG_PATH;
}

/**
 * Check if a Borg binary exists and is executable
 * @param {string} borgPath - Path to borg binary
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function checkBorgBinary(borgPath) {
  try {
    const { stdout } = await execa(borgPath, ['--version'], { timeout: 5000 });
    // Output is like "borg 1.4.0" or "borg 2.0.0b20"
    const match = stdout.match(/borg\s+(\d+)/);
    const majorVersion = match ? match[1] : null;
    return {
      available: true,
      version: majorVersion === '1' ? '1.x' : majorVersion === '2' ? '2.x' : null,
      fullVersion: stdout.trim(),
    };
  } catch (err) {
    return {
      available: false,
      version: null,
      error: err.message,
    };
  }
}

/**
 * Get available Borg versions on the system
 * @returns {Promise<Object>}
 */
async function getAvailableBorgVersions() {
  const [borg1Status, borg2Status] = await Promise.all([
    checkBorgBinary(BORG1_PATH),
    checkBorgBinary(BORG2_PATH),
  ]);

  return {
    borg1: {
      path: BORG1_PATH,
      ...borg1Status,
    },
    borg2: {
      path: BORG2_PATH,
      ...borg2Status,
    },
    default: DEFAULT_BORG_PATH,
  };
}

/**
 * Detect the Borg version of an existing repository
 * Tries both borg1 and borg2 to see which one can read the repo
 * 
 * @param {string} repoPath - Path to the repository
 * @param {string} passphrase - Repository passphrase (optional)
 * @returns {Promise<{version: string, borgPath: string, error: string|null}>}
 */
async function detectRepoVersion(repoPath, passphrase = null) {
  // Check cache first
  const cacheKey = repoPath;
  if (versionCache.has(cacheKey)) {
    return versionCache.get(cacheKey);
  }

  const env = {
    ...process.env,
    BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: 'yes',
    BORG_RELOCATED_REPO_ACCESS_IS_OK: 'yes',
  };

  if (passphrase) {
    env.BORG_PASSPHRASE = passphrase;
  }

  // Try Borg 2.x first (uses repo-info command)
  try {
    await execa(BORG2_PATH, ['-r', repoPath, 'repo-info'], {
      env,
      timeout: 30000,
    });

    const result = {
      version: '2.x',
      borgPath: BORG2_PATH,
      error: null,
    };
    versionCache.set(cacheKey, result);
    return result;
  } catch (borg2Error) {
    // Borg 2 failed, try Borg 1.x
    try {
      await execa(BORG1_PATH, ['info', repoPath], {
        env,
        timeout: 30000,
      });

      const result = {
        version: '1.x',
        borgPath: BORG1_PATH,
        error: null,
      };
      versionCache.set(cacheKey, result);
      return result;
    } catch (borg1Error) {
      // Both failed - repository might not exist or be accessible
      return {
        version: null,
        borgPath: null,
        error: `Could not detect Borg version. Borg 2.x: ${borg2Error.message}. Borg 1.x: ${borg1Error.message}`,
      };
    }
  }
}

/**
 * Get the correct Borg command for a specific version and operation
 * Borg 1.x and 2.x have different CLI syntax
 * 
 * @param {string} version - '1.x' or '2.x'
 * @param {string} operation - 'init', 'info', 'list', 'create', 'extract', 'delete', 'compact'
 * @param {Object} params - Parameters for the command
 * @param {string} [params.remotePath] - Remote borg binary path (--remote-path, e.g., 'borg-1.4' for Hetzner)
 * @returns {Object} - { command: string, args: string[] }
 */
function getBorgCommand(version, operation, params = {}) {
  const borgPath = getBorgPath(version);
  const { repoPath, archiveName, extraArgs = [], remotePath } = params;

  // Build global options that come before the operation
  const globalOptions = [];
  if (remotePath) {
    // --remote-path specifies which Borg binary to use on remote server
    // Commonly used for Hetzner Storage Boxes: borg-1.1, borg-1.2, borg-1.4
    globalOptions.push('--remote-path', remotePath);
  }

  if (version === '2.x') {
    // Borg 2.x syntax: borg [global-opts] -r REPO COMMAND [args]
    switch (operation) {
      case 'init':
      case 'repo-create':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'repo-create', ...extraArgs],
        };
      case 'info':
      case 'repo-info':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'repo-info', ...extraArgs],
        };
      case 'list':
      case 'repo-list':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'repo-list', ...extraArgs],
        };
      case 'archive-info':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'info', archiveName, ...extraArgs],
        };
      case 'archive-list':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'list', archiveName, ...extraArgs],
        };
      case 'create':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'create', archiveName, ...extraArgs],
        };
      case 'extract':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'extract', archiveName, ...extraArgs],
        };
      case 'delete':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'delete', archiveName, ...extraArgs],
        };
      case 'compact':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'compact', ...extraArgs],
        };
      case 'check':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'check', ...extraArgs],
        };
      case 'prune':
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, 'prune', ...extraArgs],
        };
      default:
        return {
          command: borgPath,
          args: [...globalOptions, '-r', repoPath, operation, ...extraArgs],
        };
    }
  } else {
    // Borg 1.x syntax: borg [global-opts] COMMAND REPO[::ARCHIVE] [args]
    switch (operation) {
      case 'init':
      case 'repo-create':
        return {
          command: borgPath,
          args: [...globalOptions, 'init', repoPath, ...extraArgs],
        };
      case 'info':
      case 'repo-info':
        return {
          command: borgPath,
          args: [...globalOptions, 'info', repoPath, ...extraArgs],
        };
      case 'list':
      case 'repo-list':
        return {
          command: borgPath,
          args: [...globalOptions, 'list', repoPath, ...extraArgs],
        };
      case 'archive-info':
        return {
          command: borgPath,
          args: [...globalOptions, 'info', `${repoPath}::${archiveName}`, ...extraArgs],
        };
      case 'archive-list':
        return {
          command: borgPath,
          args: [...globalOptions, 'list', `${repoPath}::${archiveName}`, ...extraArgs],
        };
      case 'create':
        return {
          command: borgPath,
          args: [...globalOptions, 'create', `${repoPath}::${archiveName}`, ...extraArgs],
        };
      case 'extract':
        return {
          command: borgPath,
          args: [...globalOptions, 'extract', `${repoPath}::${archiveName}`, ...extraArgs],
        };
      case 'delete':
        return {
          command: borgPath,
          args: [...globalOptions, 'delete', `${repoPath}::${archiveName}`, ...extraArgs],
        };
      case 'compact':
        // Borg 1.x supports `compact` (compacts segments to free space after deletes/prunes).
        return {
          command: borgPath,
          args: [...globalOptions, 'compact', repoPath, ...extraArgs],
        };
      case 'check':
        return {
          command: borgPath,
          args: [...globalOptions, 'check', repoPath, ...extraArgs],
        };
      case 'prune':
        return {
          command: borgPath,
          args: [...globalOptions, 'prune', repoPath, ...extraArgs],
        };
      default:
        return {
          command: borgPath,
          args: [...globalOptions, operation, repoPath, ...extraArgs],
        };
    }
  }
}

/**
 * Get encryption options available for a Borg version
 * @param {string} version - '1.x' or '2.x'
 * @returns {Array<{value: string, label: string, recommended: boolean}>}
 */
function getEncryptionOptions(version) {
  if (version === '2.x') {
    return [
      // Recommended AEAD modes
      { value: 'repokey-blake2-aes-ocb', label: 'Repokey BLAKE2 + AES-OCB (Recommended)', recommended: true },
      { value: 'repokey-blake2-chacha20-poly1305', label: 'Repokey BLAKE2 + ChaCha20 (Older CPUs)', recommended: true },
      // Other repokey modes
      { value: 'repokey-aes-ocb', label: 'Repokey AES-OCB', recommended: false },
      { value: 'repokey-chacha20-poly1305', label: 'Repokey ChaCha20-Poly1305', recommended: false },
      // Keyfile modes
      { value: 'keyfile-blake2-aes-ocb', label: 'Keyfile BLAKE2 + AES-OCB', recommended: false },
      { value: 'keyfile-blake2-chacha20-poly1305', label: 'Keyfile BLAKE2 + ChaCha20', recommended: false },
      { value: 'keyfile-aes-ocb', label: 'Keyfile AES-OCB', recommended: false },
      { value: 'keyfile-chacha20-poly1305', label: 'Keyfile ChaCha20-Poly1305', recommended: false },
      // Authenticated (no encryption)
      { value: 'authenticated-blake2', label: 'Authenticated BLAKE2 (No Encryption)', recommended: false },
      { value: 'authenticated', label: 'Authenticated (No Encryption)', recommended: false },
      // None
      { value: 'none', label: 'None (No Encryption/Auth)', recommended: false },
    ];
  } else {
    // Borg 1.x encryption modes
    return [
      { value: 'repokey-blake2', label: 'Repokey BLAKE2 (Recommended)', recommended: true },
      { value: 'repokey', label: 'Repokey (AES-CTR)', recommended: false },
      { value: 'keyfile-blake2', label: 'Keyfile BLAKE2', recommended: false },
      { value: 'keyfile', label: 'Keyfile (AES-CTR)', recommended: false },
      { value: 'authenticated-blake2', label: 'Authenticated BLAKE2 (No Encryption)', recommended: false },
      { value: 'authenticated', label: 'Authenticated (No Encryption)', recommended: false },
      { value: 'none', label: 'None (No Encryption/Auth)', recommended: false },
    ];
  }
}

/**
 * Get default encryption for a Borg version
 * @param {string} version - '1.x' or '2.x'
 * @returns {string}
 */
function getDefaultEncryption(version) {
  return version === '2.x' ? 'repokey-blake2-aes-ocb' : 'repokey-blake2';
}

/**
 * Clear the version cache for a repository
 * @param {string} repoPath - Repository path
 */
function clearVersionCache(repoPath) {
  versionCache.delete(repoPath);
}

/**
 * Clear all version cache entries
 */
function clearAllVersionCache() {
  versionCache.clear();
}

module.exports = {
  BORG1_PATH,
  BORG2_PATH,
  DEFAULT_BORG_PATH,
  getBorgPath,
  checkBorgBinary,
  getAvailableBorgVersions,
  detectRepoVersion,
  getBorgCommand,
  getEncryptionOptions,
  getDefaultEncryption,
  clearVersionCache,
  clearAllVersionCache,
};

