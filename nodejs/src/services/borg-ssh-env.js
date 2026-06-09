/**
 * borg-ssh-env.js — single-source helper for configuring BORG_RSH / BORG_PASSPHRASE
 * when invoking `borg` or `borgmatic` against an SSH repository.
 *
 * Why this exists
 * ---------------
 * Several endpoints (archive info, archive file list, archive search, restore,
 * repo browse, repo operations, …) all need the same logic: take a repository
 * path, work out which SSH credentials to offer, and write them into a child
 * process `env` object. The logic used to be copy-pasted in ~6 places, subtly
 * diverged in each, and — most importantly — only looked for the SSH key id
 * in the YAML config. If the UI had stored the key in
 * `repository-credentials.json` but the YAML didn't carry `ssh_key_id`
 * (which happens for repos added via certain flows, or when the YAML is
 * regenerated without the field), the key-auth block was silently skipped
 * and borg fell through to password auth — yielding
 * `Permission denied (publickey,password)` against servers like Hetzner
 * Storage Box that require a specific key.
 *
 * Resolution order here (first match wins):
 *   1. Per-repo SSH key stored in `repository-credentials.json` (has the
 *      private key material directly). If the key id is known, we additionally
 *      consult `ssh-keys.yaml` to pick up encryption status / passphrase.
 *   2. Per-repo `ssh_key_id` recorded in YAML → full key looked up via the
 *      ssh-keys service.
 *   3. Per-repo SSH password stored in `repository-credentials.json`.
 *   4. None of the above → leave `env.BORG_RSH` at the server-wide default
 *      (`ssh -o StrictHostKeyChecking=accept-new`, set in server.js),
 *      which still lets ssh-agent / ~/.ssh/config work.
 */

const path = require('path');
const fs = require('fs-extra');
const config = require('../config');
const configParser = require('./config-parser');
const repositoryCredentials = require('./repository-credentials');
const { buildBorgPasswordSshArgs } = require('../utils/ssh-password-auth');

/**
 * Parse an `ssh://user@host[:port]/path` URL into its components.
 */
function parseSshUrl(url) {
    const m = /^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/.exec(url || '');
    if (!m) return null;
    return { user: m[1], host: m[2], port: m[3] || '22', path: m[4] };
}

/**
 * Ensure the runtime user's `~/.ssh` exists with mode 0700, so `ssh` can
 * create/append `known_hosts` when the global BORG_RSH uses
 * `StrictHostKeyChecking=accept-new`. Without this, ssh emits the
 * "Failed to add the host to the list of known hosts" warning on every call.
 */
async function ensureSshDir() {
    const home = process.env.HOME || '/root';
    const sshDir = path.join(home, '.ssh');
    try {
        await fs.ensureDir(sshDir);
        await fs.chmod(sshDir, 0o700).catch(() => { /* best-effort */ });
    } catch (_e) {
        // Non-fatal — ssh may still succeed, the warning is cosmetic.
    }
}

/**
 * Write a private key file under `<dataDir>/ssh-keys/<slug>_key_<id>`.
 * The file is rewritten on every call (keys can rotate) with mode 0600.
 */
async function writeTempSshKey(sshKeyId, privateKey, contextSlug) {
    const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
    await fs.ensureDir(sshKeyDir);
    const keyPath = path.join(sshKeyDir, `${contextSlug}_key_${sshKeyId || 'cred'}`);
    await fs.writeFile(keyPath, privateKey, { mode: 0o600 });
    return keyPath;
}

/**
 * Write an askpass helper script that prints the decrypted passphrase to
 * stdout. Invoked by ssh via SSH_ASKPASS for encrypted private keys.
 */
async function writeAskpassScript(sshKeyId, passphrase, contextSlug) {
    const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
    await fs.ensureDir(sshKeyDir);
    const scriptPath = path.join(sshKeyDir, `askpass_${contextSlug}_${sshKeyId || 'cred'}.sh`);
    // Single-quote escaping for POSIX sh: ' → '\''
    const escaped = passphrase.replace(/'/g, "'\"'\"'");
    await fs.writeFile(scriptPath, `#!/bin/sh\necho '${escaped}'\n`, { mode: 0o700 });
    return scriptPath;
}

/**
 * Resolve the best-available SSH key for `repositoryPath`. Returns
 *   `{ ssh_key_id, private_key, is_encrypted, passphrase, source }`
 * or `null` if nothing is available.
 */
async function resolveSshKey(repositoryPath) {
    // (1) repository-credentials.json is the richest source — it contains the
    //     decrypted private_key bytes. If a key id is recorded, also consult
    //     ssh-keys.yaml to pick up encryption / passphrase flags.
    try {
        const credKey = await repositoryCredentials.getSSHKey(repositoryPath);
        if (credKey && credKey.private_key) {
            const out = {
                ssh_key_id: credKey.ssh_key_id || null,
                private_key: credKey.private_key,
                is_encrypted: false,
                passphrase: null,
                source: 'credentials',
            };
            if (credKey.ssh_key_id) {
                try {
                    const sshKeysAPI = require('./ssh-keys');
                    const full = await sshKeysAPI.getSSHKey(credKey.ssh_key_id);
                    if (full) {
                        out.is_encrypted = !!full.is_encrypted;
                        out.passphrase = full.passphrase || null;
                    }
                } catch (_e) {
                    // Best-effort enrichment; a missing ssh-keys.yaml is OK.
                }
            }
            return out;
        }
    } catch (e) {
        console.warn(`[borg-ssh-env] repository-credentials lookup failed: ${e.message}`);
    }

    // (2) YAML ssh_key_id → ssh-keys service.
    try {
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repo = allRepos.find(r => r.path === repositoryPath);
        if (repo && repo.ssh_key_id) {
            const sshKeysAPI = require('./ssh-keys');
            const full = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
            if (full && full.private_key) {
                return {
                    ssh_key_id: repo.ssh_key_id,
                    private_key: full.private_key,
                    is_encrypted: !!full.is_encrypted,
                    passphrase: full.passphrase || null,
                    source: 'yaml',
                };
            }
            console.warn(`[borg-ssh-env] YAML references ssh_key_id=${repo.ssh_key_id} but the key's private material could not be loaded.`);
        }
    } catch (e) {
        console.warn(`[borg-ssh-env] YAML SSH key lookup failed: ${e.message}`);
    }

    return null;
}

/**
 * Configure `env` in-place for an SSH-backed borg/borgmatic call.
 *
 * @param {object} env            Environment object to mutate.
 * @param {string} repositoryPath Full repository path.
 * @param {string} [context='Borg']  Short label used in log prefixes and filenames.
 * @returns {Promise<object>} Diagnostic object (not required for call sites).
 */
async function configureBorgSshEnv(env, repositoryPath, context = 'Borg') {
    if (!repositoryPath || !repositoryPath.startsWith('ssh://')) {
        return { method: 'none', reason: 'not an ssh repository' };
    }

    await ensureSshDir();

    const port = parseSshUrl(repositoryPath)?.port || '22';
    const slug = String(context).toLowerCase().replace(/\W+/g, '_') || 'borg';

    // Key-based auth (preferred).
    const keyInfo = await resolveSshKey(repositoryPath);
    if (keyInfo) {
        const keyPath = await writeTempSshKey(keyInfo.ssh_key_id, keyInfo.private_key, slug);

        if (keyInfo.is_encrypted && keyInfo.passphrase) {
            const askpass = await writeAskpassScript(keyInfo.ssh_key_id, keyInfo.passphrase, slug);
            env.SSH_ASKPASS = askpass;
            env.SSH_ASKPASS_REQUIRE = 'force';
            env.DISPLAY = ':0';
            // BatchMode cannot be used here: ssh needs SSH_ASKPASS to prompt
            // for the key passphrase. accept-new is safe because there is
            // still no interactive TTY, but the askpass helper is non-tty.
            env.BORG_RSH = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -p ${port}`;
        } else {
            env.BORG_RSH = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes -p ${port}`;
        }
        console.log(`🔑 [${context}] SSH key authentication (source: ${keyInfo.source}, key ${keyInfo.ssh_key_id || 'unnamed'})`);
        return { method: 'key', source: keyInfo.source, ssh_key_id: keyInfo.ssh_key_id };
    }

    // Password-based auth.
    try {
        const pw = await repositoryCredentials.getSSHPassword(repositoryPath);
        if (pw) {
            env.SSHPASS = pw;
            // Pin to password-only auth so ssh doesn't offer /root/.ssh keys
            // before the password and trip fail2ban (see browsing.js for the
            // full PASSWORD_AUTH_SSH_FLAGS rationale).
            env.BORG_RSH = `sshpass -e ssh ${buildBorgPasswordSshArgs()} -o StrictHostKeyChecking=accept-new -p ${port}`;
            console.log(`🔐 [${context}] SSH password authentication (source: repository-credentials)`);
            return { method: 'password', source: 'credentials' };
        }
    } catch (e) {
        console.warn(`[${context}] repository-credentials password lookup failed: ${e.message}`);
    }

    console.log(`ℹ️  [${context}] No per-repo SSH credentials found for ${repositoryPath} — using ssh-agent / ~/.ssh defaults.`);
    return { method: 'default' };
}

module.exports = {
    configureBorgSshEnv,
    parseSshUrl,
    ensureSshDir,
};
