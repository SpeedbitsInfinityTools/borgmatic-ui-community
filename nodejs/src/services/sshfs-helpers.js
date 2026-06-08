/**
 * SSHFS helpers — script builders for the SSH/SFTP backup source.
 *
 * The wizard's SSH source is implemented as a temporary sshfs mount in
 * borgmatic's before/after/on_error hooks. These helpers produce the bash
 * snippets that are embedded into the generated borgmatic YAML.
 *
 * Key design points:
 *   - The before-script uses `set -euo pipefail` so any failure (mount, key
 *     write, mountpoint verification) aborts the hook with a non-zero exit
 *     code. borgmatic interprets that as a failed action and aborts the
 *     backup, which is exactly what the user wants — no silent skips.
 *   - SSH key material / password are sourced from environment variables
 *     populated by `backup-executor.js` from the encrypted SSH key store
 *     (or password-manager for SSH passwords). They never appear in the
 *     YAML on disk.
 *   - The umount script always runs `|| true` for cleanup commands so
 *     leftover state (stale tmpfile, half-mounted point) doesn't keep us
 *     from finishing cleanup on failure paths.
 */

const { execSync } = require('child_process');
const fs = require('fs');

// TTLs are intentionally asymmetric:
//   - Positive results are cached for a long time because once sshfs is
//     installed it is essentially never removed during a process lifetime,
//     and probing on every UI poll wastes a fork+exec.
//   - Negative results are cached only briefly so users who install sshfs
//     on the host while the wizard is open get accurate status on the next
//     reload without having to restart the borgmatic-ui backend.
const POSITIVE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 1000;
const SYS_ADMIN_CAP_BIT = 21n;

let sshfsAvailableCache = null; // { value: { available, error }, expiresAt: number }

/**
 * Detect whether SSH/SFTP sources can actually be mounted on the backend host.
 *
 * There are TWO independent prerequisites, and both must hold:
 *
 *   1. The `sshfs` binary must be installed. It ships in our Docker image, but
 *      can be absent on bare-metal / dev hosts.
 *   2. The FUSE device `/dev/fuse` must be present in the container. This only
 *      happens when the deployment was granted FUSE access — i.e. the
 *      Infinity Tools installer's "Enable SSH/SFTP backup sources" prompt
 *      (or BORGUI_ENABLE_FUSE=true), which adds `cap_add: SYS_ADMIN` +
 *      `devices: /dev/fuse` to the container. Without the device, the sshfs
 *      binary exists but every mount fails at runtime with
 *      "fusermount: device not found" / permission denied.
 *
 * Checking only the binary (as a previous version did) gives a false "OK" on
 * containers where FUSE was never enabled — which is exactly the opt-in default
 * now — so we check both and report which prerequisite is missing.
 *
 * Result is cached with TTLs short enough that a freshly-enabled FUSE / newly
 * installed sshfs is picked up without restarting the backend process.
 *
 * Pass `{ force: true }` to bypass the cache (used by the API route's
 * "?refresh=1" query parameter).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]
 * @returns {{ available: boolean, error: string|null, binary_available: boolean, fuse_device_available: boolean, sys_admin_cap_available: boolean|null }}
 */
function isSshfsAvailable(opts) {
    const force = !!(opts && opts.force);
    const now = Date.now();
    if (
        !force
        && sshfsAvailableCache
        && sshfsAvailableCache.expiresAt > now
    ) {
        return sshfsAvailableCache.value;
    }

    let binaryAvailable = false;
    try {
        execSync('command -v sshfs', { stdio: 'ignore' });
        binaryAvailable = true;
    } catch (_) {
        binaryAvailable = false;
    }

    // /dev/fuse must exist or sshfs mounts cannot work at all.
    let fuseDeviceAvailable = false;
    try {
        fuseDeviceAvailable = fs.existsSync('/dev/fuse');
    } catch (_) {
        fuseDeviceAvailable = false;
    }

    // Harden the probe: some custom/manual deployments can expose /dev/fuse but
    // still lack SYS_ADMIN in the container capability bounding set.
    // That can still fail at mount time, so treat it as unavailable.
    let sysAdminCapAvailable = null;
    try {
        const procStatus = fs.readFileSync('/proc/self/status', 'utf8');
        const capBndMatch = procStatus.match(/^CapBnd:\s*([0-9a-fA-F]+)\s*$/m);
        if (capBndMatch && capBndMatch[1]) {
            const capMask = BigInt(`0x${capBndMatch[1]}`);
            sysAdminCapAvailable = (capMask & (1n << SYS_ADMIN_CAP_BIT)) !== 0n;
        }
    } catch (_) {
        // Keep null when unreadable/unknown so we don't risk false negatives.
        sysAdminCapAvailable = null;
    }

    let error = null;
    if (!binaryAvailable && !fuseDeviceAvailable) {
        error = 'sshfs is not installed and FUSE (/dev/fuse) is not available on the host running borgmatic.';
    } else if (!binaryAvailable) {
        error = 'sshfs binary not found on the host running borgmatic.';
    } else if (!fuseDeviceAvailable) {
        error = 'FUSE (/dev/fuse) is not available to this container. SSH/SFTP sources require FUSE to be enabled for the borgmatic-ui container.';
    } else if (sysAdminCapAvailable === false) {
        error = 'FUSE device is present but container capability SYS_ADMIN is missing. Reinstall/redeploy borgmatic-ui with "Enable SSH/SFTP backup sources" (or BORGUI_ENABLE_FUSE=true).';
    }

    const value = {
        available: binaryAvailable && fuseDeviceAvailable && sysAdminCapAvailable !== false,
        error,
        binary_available: binaryAvailable,
        fuse_device_available: fuseDeviceAvailable,
        sys_admin_cap_available: sysAdminCapAvailable,
    };

    sshfsAvailableCache = {
        value,
        expiresAt: now + (value.available ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    };
    return value;
}

/**
 * Reset the cached availability result. Used by tests and after an explicit
 * refresh request from the API.
 */
function _resetSshfsAvailableCache() {
    sshfsAvailableCache = null;
}

/**
 * Default sshfs mount options. We always want auto-reconnect, keepalive
 * pings to keep flaky NAT/firewalls happy, and host-key TOFU so first-run
 * unknown keys don't block the backup.
 *
 * `password_stdin` is added by the mount script for password auth. The
 * IdentityFile flag is added by the mount script for key auth.
 */
function defaultMountOptions() {
    return [
        'reconnect',
        'ServerAliveInterval=15',
        'ServerAliveCountMax=3',
        'StrictHostKeyChecking=accept-new',
    ];
}

/**
 * Single-quote a value for safe inclusion in a bash double-quoted string.
 * We embed user-supplied host/path/options into the script via shell
 * variables rather than direct interpolation — this is the escaping helper
 * for the variable assignments themselves.
 *
 * @param {string} value
 * @returns {string}
 */
function shellSingleQuote(value) {
    if (value === null || value === undefined) return "''";
    const s = String(value);
    return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

/**
 * Build a unique mount point path for a backup's SSH source.
 *
 * @param {string} backupId
 * @param {number} index
 * @returns {string}
 */
function buildMountPoint(backupId, index) {
    const safe = String(backupId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    const idx = Number.isInteger(index) ? index : 0;
    return `/mnt/borgmatic-sshfs/${safe}-${idx}`;
}

/**
 * Build the bash snippet that mounts a remote sshfs path into a unique
 * mount point. Embeds a base64 metadata marker so the wizard can round-trip
 * the source on edit.
 *
 * @param {object} opts
 * @param {string} opts.mountPoint        — absolute target mount path
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {string} opts.username
 * @param {string} opts.remotePath        — absolute path on the remote
 * @param {('key'|'password')} opts.authMethod
 * @param {string} [opts.keyEnvVar]       — env var holding the plaintext private key
 * @param {string} [opts.keyTmpFile]      — absolute key temp file path for this source
 * @param {string} [opts.passphraseEnvVar]— env var holding the key passphrase, optional
 * @param {string} [opts.passwordEnvVar]  — env var holding the SSH password (password auth)
 * @param {string[]} [opts.mountOptions]  — extra sshfs -o options
 * @param {string} [opts.metadataB64]     — base64 JSON marker for round-trip
 * @returns {string}                      — the bash snippet
 */
function buildSshfsMountScript(opts) {
    const {
        mountPoint,
        host,
        port = 22,
        username,
        remotePath,
        authMethod,
        keyEnvVar,
        keyTmpFile,
        passphraseEnvVar,
        passwordEnvVar,
        mountOptions,
        metadataB64,
    } = opts || {};

    if (!mountPoint || !host || !username || !remotePath) {
        throw new Error('buildSshfsMountScript: mountPoint, host, username, and remotePath are required');
    }

    const optsList = Array.isArray(mountOptions) && mountOptions.length > 0
        ? mountOptions.slice()
        : defaultMountOptions();

    // NOTE: IdentityFile is intentionally NOT added to optsList here. optsList
    // is rendered into the script as a single-quoted OPTS='...' assignment, so
    // any '$KEYFILE' embedded in it would be stored literally and never expand
    // (bash does not re-scan a variable's value for further expansion). For key
    // auth the script instead passes IdentityFile as a SEPARATE, double-quoted
    // `-o "IdentityFile=$KEYFILE"` argument after $KEYFILE is defined, so the
    // real temp-key path is used. (Previously this produced a literal
    // "IdentityFile=$KEYFILE" and silently broke key-based sshfs mounts.)
    const optsStr = optsList.join(',');
    const portNum = Number.isInteger(port) ? port : 22;

    const hostQ = shellSingleQuote(host);
    const userQ = shellSingleQuote(username);
    const remoteQ = shellSingleQuote(remotePath);
    const mountQ = shellSingleQuote(mountPoint);
    const optsQ = shellSingleQuote(optsStr);
    const metaLine = metadataB64
        ? `# BORGMATIC_UI_SSH_META_B64:${metadataB64}\n`
        : '';

    if (authMethod === 'key') {
        const keyVar = keyEnvVar || '';
        const keyFilePath = keyTmpFile || '';
        if (!keyVar) {
            throw new Error('buildSshfsMountScript: keyEnvVar required for key auth');
        }
        if (!keyFilePath) {
            throw new Error('buildSshfsMountScript: keyTmpFile required for key auth');
        }
        // Note: passphrase support for encrypted keys is not currently used
        // because sshfs has no first-class passphrase prompt path that works
        // with -o password_stdin. Encrypted keys would need ssh-agent setup
        // up front, which is out of scope for v1. The wizard surfaces this
        // by hiding the key option for encrypted keys at picker level.
        if (passphraseEnvVar) {
            // Reserved for future ssh-agent integration; intentionally unused.
        }
        return `#!/usr/bin/env bash
set -euo pipefail
${metaLine}MOUNT_POINT=${mountQ}
HOST=${hostQ}
USER_NAME=${userQ}
REMOTE_PATH=${remoteQ}
OPTS=${optsQ}
PORT=${portNum}
KEY_RAW="$(printenv ${keyVar} || true)"
if [ -z "$KEY_RAW" ]; then
  echo "ERROR: SSH key material env var ${keyVar} is empty — backup credential injection failed" >&2
  exit 1
fi
KEYFILE=${shellSingleQuote(keyFilePath)}
rm -f "$KEYFILE"
touch "$KEYFILE"
chmod 600 "$KEYFILE"
printf '%s\\n' "$KEY_RAW" > "$KEYFILE"
unset KEY_RAW
mkdir -p "$MOUNT_POINT"
# Clean up any stale half-mounted state from a previous failed run.
if mountpoint -q "$MOUNT_POINT"; then
  fusermount -uz "$MOUNT_POINT" 2>/dev/null || true
fi
# IdentityFile is passed as its own -o so "$KEYFILE" expands to the real temp
# key path (it cannot live inside the single-quoted $OPTS — see sshfs-helpers).
sshfs -p "$PORT" -o "$OPTS" -o "IdentityFile=$KEYFILE" "$USER_NAME@$HOST:$REMOTE_PATH" "$MOUNT_POINT"
# Hard-verify: sshfs has been known to return 0 even when the mount didn't
# actually take. mountpoint(1) is the authoritative check.
if ! mountpoint -q "$MOUNT_POINT"; then
  echo "ERROR: sshfs mount did not appear at $MOUNT_POINT — backup aborted" >&2
  rm -f "$KEYFILE"
  exit 1
fi
echo "sshfs mount ok: $USER_NAME@$HOST:$REMOTE_PATH -> $MOUNT_POINT"`;
    }

    if (authMethod === 'password') {
        const passVar = passwordEnvVar || '';
        if (!passVar) {
            throw new Error('buildSshfsMountScript: passwordEnvVar required for password auth');
        }
        return `#!/usr/bin/env bash
set -euo pipefail
${metaLine}MOUNT_POINT=${mountQ}
HOST=${hostQ}
USER_NAME=${userQ}
REMOTE_PATH=${remoteQ}
OPTS=${optsQ}
PORT=${portNum}
PASS_RAW="$(printenv ${passVar} || true)"
if [ -z "$PASS_RAW" ]; then
  echo "ERROR: SSH password env var ${passVar} is empty — backup credential injection failed" >&2
  exit 1
fi
mkdir -p "$MOUNT_POINT"
if mountpoint -q "$MOUNT_POINT"; then
  fusermount -uz "$MOUNT_POINT" 2>/dev/null || true
fi
# Feed password via sshpass env var (never as CLI argument).
export SSHPASS="$PASS_RAW"
sshpass -e sshfs -p "$PORT" -o "$OPTS" "$USER_NAME@$HOST:$REMOTE_PATH" "$MOUNT_POINT"
unset SSHPASS
unset PASS_RAW
if ! mountpoint -q "$MOUNT_POINT"; then
  echo "ERROR: sshfs mount did not appear at $MOUNT_POINT — backup aborted" >&2
  exit 1
fi
echo "sshfs mount ok: $USER_NAME@$HOST:$REMOTE_PATH -> $MOUNT_POINT"`;
    }

    throw new Error(`buildSshfsMountScript: unsupported authMethod "${authMethod}"`);
}

/**
 * Build the bash snippet that unmounts the sshfs mount and removes the
 * temporary key file. Designed to be safe to run on cleanup paths even if
 * the mount never came up — every step is best-effort with `|| true`.
 *
 * @param {object} opts
 * @param {string} opts.mountPoint — absolute mount point to release
 * @param {string} [opts.keyTmpFile] — key temp file to remove
 * @returns {string}
 */
function buildSshfsUmountScript(opts) {
    const { mountPoint, keyTmpFile } = opts || {};
    if (!mountPoint) {
        throw new Error('buildSshfsUmountScript: mountPoint is required');
    }
    const mountQ = shellSingleQuote(mountPoint);
    const keyFileQ = keyTmpFile ? shellSingleQuote(keyTmpFile) : null;
    return `#!/usr/bin/env bash
# Cleanup is best-effort: never block the backup pipeline on umount issues.
set +e
MOUNT_POINT=${mountQ}
if mountpoint -q "$MOUNT_POINT"; then
  fusermount -uz "$MOUNT_POINT" 2>/dev/null || umount -l "$MOUNT_POINT" 2>/dev/null || true
fi
rmdir "$MOUNT_POINT" 2>/dev/null || true
${keyFileQ ? `KEYFILE=${keyFileQ}
rm -f "$KEYFILE" 2>/dev/null || true` : '# no key tmpfile for password auth'}
exit 0`;
}

module.exports = {
    isSshfsAvailable,
    _resetSshfsAvailableCache,
    defaultMountOptions,
    buildMountPoint,
    buildSshfsMountScript,
    buildSshfsUmountScript,
    shellSingleQuote,
};
