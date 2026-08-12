/**
 * Startup migration: rewrite sshfs mount/umount hooks in existing backup jobs.
 *
 * The sshfs mount script is generated once, when a job is created or updated,
 * and then stored verbatim inside the job's borgmatic YAML. Runtime only reads
 * that YAML and injects credentials — it never regenerates the hooks. So a bug
 * fixed in sshfs-helpers.js reaches new and re-saved jobs only; every existing
 * job keeps running the old script forever.
 *
 * The bug this exists for: stale-mount cleanup used to run *after* "mkdir -p".
 * A run killed mid-backup leaves a FUSE mount whose daemon is gone, "mkdir -p"
 * then fails with EIO (or blocks), and "set -e" aborts the hook before cleanup
 * can run. Because the mount point name is deterministic, one interrupted run
 * breaks that job permanently.
 *
 * Every generated mount script carries a BORGMATIC_UI_SSH_META_B64 marker with
 * the full source definition, so hooks can be rebuilt losslessly from the file
 * itself — no metadata store or user interaction needed.
 *
 * Safe to run on every boot: it rewrites only when the regenerated script
 * differs from what is on disk, so it is a no-op once applied.
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { isDeepStrictEqual } = require('util');

const appConfig = require('../../config');
const sshfsHelpers = require('../sshfs-helpers');

const SSH_MARKER = 'BORGMATIC_UI_SSH_META_B64:';

/**
 * Pull the base64 metadata marker out of a generated mount script.
 *
 * @param {string} script
 * @returns {string|null} the base64 payload, or null when absent/malformed
 */
function extractMarker(script) {
    const line = script.split('\n').find((l) => l.includes(SSH_MARKER));
    if (!line) return null;
    const encoded = line.substring(line.indexOf(SSH_MARKER) + SSH_MARKER.length).trim();
    return encoded || null;
}

/**
 * Decode a marker into the source definition it describes.
 *
 * @param {string} encoded
 * @returns {object|null} null when the payload is not a usable ssh source
 */
function decodeMarker(encoded) {
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        if (!parsed || parsed.type !== 'ssh') return null;
        if (!parsed.mount_point || !parsed.host || !parsed.username || !parsed.remote_path) {
            return null;
        }
        return parsed;
    } catch (_) {
        return null;
    }
}

/**
 * Rebuild the mount script for a source, reusing the original marker verbatim
 * so the wizard round-trip stays byte-identical.
 *
 * @param {object} meta   — decoded marker payload
 * @param {string} encoded — the original base64 marker
 * @returns {string}
 */
function buildMountScript(meta, encoded) {
    const mountOptions = meta.mount_options
        ? String(meta.mount_options).split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

    return sshfsHelpers.buildSshfsMountScript({
        mountPoint: meta.mount_point,
        host: meta.host,
        port: Number.isInteger(meta.port) ? meta.port : 22,
        username: meta.username,
        remotePath: meta.remote_path,
        authMethod: meta.auth_method || 'key',
        keyEnvVar: meta.ssh_key_env_var || null,
        keyTmpFile: meta.key_tmpfile || null,
        passwordEnvVar: meta.ssh_password_env_var || null,
        mountOptions,
        metadataB64: encoded,
    });
}

/**
 * Rewrite the sshfs hooks of a single parsed borgmatic config, in place.
 *
 * Hooks are replaced where they sit rather than removed and re-appended, so
 * ordering against unrelated database/git hooks is preserved exactly.
 *
 * @param {object} config — parsed borgmatic config
 * @returns {{rewritten: number, skipped: string[]}}
 */
function rewriteSshfsHooks(config) {
    const result = { rewritten: 0, skipped: [] };
    if (!Array.isArray(config.commands)) return result;

    // First pass: mount scripts. These carry the marker, so they are both the
    // rewrite target and the source of truth for the umount pass that follows.
    const mountPoints = new Map();

    for (const hook of config.commands) {
        if (!hook || !Array.isArray(hook.run)) continue;

        hook.run = hook.run.map((script) => {
            if (typeof script !== 'string' || !script.includes(SSH_MARKER)) return script;

            const encoded = extractMarker(script);
            const meta = encoded ? decodeMarker(encoded) : null;
            if (!meta) {
                result.skipped.push('unreadable BORGMATIC_UI_SSH_META_B64 marker');
                return script;
            }

            mountPoints.set(meta.mount_point, meta.key_tmpfile || null);

            let fresh;
            try {
                fresh = buildMountScript(meta, encoded);
            } catch (e) {
                // A marker can describe a source the builder rejects (e.g. key
                // auth with no env var, from a half-written config). Leaving it
                // untouched is strictly better than writing a broken hook.
                result.skipped.push(`${meta.mount_point}: ${e.message}`);
                return script;
            }

            if (fresh === script) return script;
            result.rewritten++;
            return fresh;
        });
    }

    if (mountPoints.size === 0) return result;

    // Second pass: umount scripts. They carry no marker, so they are matched by
    // the MOUNT_POINT assignment of a mount point discovered above.
    for (const hook of config.commands) {
        if (!hook || !Array.isArray(hook.run)) continue;

        hook.run = hook.run.map((script) => {
            if (typeof script !== 'string') return script;
            if (script.includes(SSH_MARKER) || !script.includes('fusermount')) return script;

            for (const [mountPoint, keyTmpFile] of mountPoints) {
                const needle = `MOUNT_POINT=${sshfsHelpers.shellSingleQuote(mountPoint)}`;
                if (!script.includes(needle)) continue;

                const fresh = sshfsHelpers.buildSshfsUmountScript({ mountPoint, keyTmpFile });
                if (fresh === script) return script;
                result.rewritten++;
                return fresh;
            }
            return script;
        });
    }

    return result;
}

/**
 * Re-serialize a config while keeping the file's original header comments.
 *
 * The header records name/id/created-at and is not reproducible from the parsed
 * config, so it is carried over verbatim instead of regenerated.
 *
 * @param {string} originalText
 * @param {object} config
 * @returns {string}
 */
function serializeWithOriginalHeader(originalText, config) {
    const lines = originalText.split('\n');
    let i = 0;
    while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) {
        i++;
    }
    const header = lines.slice(0, i).join('\n').replace(/\s+$/, '');
    // lineWidth -1 keeps hook scripts as literal blocks. At a finite width
    // js-yaml emits them folded and wraps long lines, which turns the
    // BORGMATIC_UI_SSH_META_B64 comment into two lines — still valid, but
    // backup-executor.js scrapes that marker straight out of the raw text.
    const body = yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });

    return header ? `${header}\n\n${body}` : body;
}

/**
 * Scan every backup job and bring its sshfs hooks up to date.
 *
 * @param {object} [options]
 * @param {string} [options.backupsDir] — override for tests
 * @param {string} [options.backupDir]  — where pre-migration copies are kept
 * @returns {Promise<{scanned: number, filesChanged: number, hooksRewritten: number, errors: string[], skipped: string[]}>}
 */
async function migrateSshfsHooks(options = {}) {
    const backupsDir = options.backupsDir || path.join(appConfig.configDir, 'borgmatic.d');
    // Kept out of borgmatic.d so neither borgmatic nor our own job discovery
    // can ever pick the copies up as configs.
    const archiveDir = options.backupDir
        || path.join(appConfig.configDir, '.migration-backups');

    const result = { scanned: 0, filesChanged: 0, hooksRewritten: 0, errors: [], skipped: [] };

    if (!(await fs.pathExists(backupsDir))) return result;

    const files = (await fs.readdir(backupsDir))
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const filename of files) {
        const filePath = path.join(backupsDir, filename);
        try {
            const originalText = await fs.readFile(filePath, 'utf8');
            if (!originalText.includes(SSH_MARKER)) continue;

            result.scanned++;

            // Parse the raw text: unlike loadBackupConfig() this must NOT strip
            // comment lines, because the metadata marker and the scripts' own
            // comments live inside YAML block scalars.
            const config = yaml.load(originalText) || {};
            const { rewritten, skipped } = rewriteSshfsHooks(config);
            result.skipped.push(...skipped.map((s) => `${filename}: ${s}`));

            if (rewritten === 0) continue;

            // These are live customer configs, so never write output we cannot
            // read back as the exact same config.
            const newText = serializeWithOriginalHeader(originalText, config);
            if (!isDeepStrictEqual(yaml.load(newText), config)) {
                result.errors.push(`${filename}: re-serialized config did not round-trip; left unchanged`);
                continue;
            }

            await fs.ensureDir(archiveDir);
            const archivePath = path.join(archiveDir, `${filename}.pre-sshfs-fix`);
            if (!(await fs.pathExists(archivePath))) {
                await fs.writeFile(archivePath, originalText, { mode: 0o600 });
            }

            await fs.writeFile(filePath, newText);

            result.filesChanged++;
            result.hooksRewritten += rewritten;
            console.log(`   ✓ ${filename}: rewrote ${rewritten} sshfs hook(s)`);
        } catch (error) {
            result.errors.push(`${filename}: ${error.message}`);
        }
    }

    if (result.filesChanged > 0) {
        console.log(
            `🔧 sshfs hook migration: updated ${result.hooksRewritten} hook(s) in `
            + `${result.filesChanged} job(s); originals kept in ${archiveDir}`
        );
    }
    for (const skip of result.skipped) {
        console.warn(`⚠️  sshfs hook migration skipped: ${skip}`);
    }
    for (const err of result.errors) {
        console.warn(`⚠️  sshfs hook migration error: ${err}`);
    }

    return result;
}

module.exports = {
    migrateSshfsHooks,
    // exported for tests
    rewriteSshfsHooks,
    serializeWithOriginalHeader,
};
