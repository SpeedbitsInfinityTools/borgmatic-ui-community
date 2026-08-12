'use strict';

const path = require('path');
const fs = require('fs-extra');

/**
 * Where OpenSSH should record host keys for connections this app makes.
 *
 * The container mounts the host's /root/.ssh read-only, so ssh cannot write the
 * default known_hosts and logs "Failed to add the host to the list of known
 * hosts". That is worse than the cosmetic warning it looks like: with
 * StrictHostKeyChecking=accept-new and nowhere to persist the key, every
 * connection accepts whatever it is offered, so the option's actual purpose —
 * noticing that a host's key changed since last time — never engages.
 *
 * Pointing ssh at the app's own writable data directory restores that
 * trust-on-first-use guarantee and survives container recreation, since the
 * data directory is a persisted mount.
 */

let cachedPath;
let warned = false;

/**
 * Absolute path of the known_hosts file this app owns.
 *
 * @returns {string}
 */
function getKnownHostsPath() {
    const config = require('../config');
    return path.join(config.dataDir || '/app/data', 'known_hosts');
}

/**
 * Ensure the known_hosts file exists and is writable.
 *
 * Returns null when the location cannot be used, in which case callers should
 * leave ssh on its own default. A backup must not fail over host-key
 * bookkeeping, so every problem here degrades to the previous behaviour.
 *
 * @returns {string|null}
 */
function ensureKnownHostsFile() {
    if (cachedPath !== undefined) return cachedPath;

    let target;
    try {
        target = getKnownHostsPath();
        fs.ensureDirSync(path.dirname(target));
        if (!fs.existsSync(target)) {
            fs.writeFileSync(target, '', { mode: 0o600 });
        }
        fs.accessSync(target, fs.constants.W_OK);
        cachedPath = target;
    } catch (error) {
        if (!warned) {
            warned = true;
            console.warn(
                `⚠️  Cannot use ${target || 'the data directory'} for known_hosts `
                + `(${error.message}); ssh will fall back to its default and host keys `
                + 'will not be pinned.'
            );
        }
        cachedPath = null;
    }

    return cachedPath;
}

/**
 * The `UserKnownHostsFile=...` option, or null when unavailable.
 *
 * @returns {string|null}
 */
function knownHostsOption() {
    const target = ensureKnownHostsFile();
    return target ? `UserKnownHostsFile=${target}` : null;
}

/**
 * Reset the memoised path. Tests only.
 */
function resetCacheForTests() {
    cachedPath = undefined;
    warned = false;
}

module.exports = {
    getKnownHostsPath,
    ensureKnownHostsFile,
    knownHostsOption,
    resetCacheForTests,
};
