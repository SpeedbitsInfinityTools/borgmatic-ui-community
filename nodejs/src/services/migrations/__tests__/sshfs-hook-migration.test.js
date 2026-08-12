/**
 * Tests for the sshfs hook migration.
 *
 * The regression being guarded: a job saved before the fix has its mount script
 * frozen in YAML with the stale-mount cleanup running *after* "mkdir -p", which
 * makes the hook abort on EIO and permanently break that job.
 */

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');

jest.mock('../../../config', () => ({
    configDir: '/tmp/test-borgmatic-config',
}));

const {
    migrateSshfsHooks,
    rewriteSshfsHooks,
    serializeWithOriginalHeader,
} = require('../sshfs-hook-migration');

const MOUNT_POINT = '/mnt/borgmatic-sshfs/backup_abc123-0';

const META = {
    type: 'ssh',
    host: '10.16.18.54',
    port: 22,
    username: 'sim-code-read',
    auth_method: 'key',
    ssh_key_id: 'key-1',
    ssh_key_env_var: 'BORGMATIC_UI_SSHKEY_backup_abc123_0',
    ssh_password_env_var: null,
    remote_path: '/SIM-Code-Backup',
    mount_point: MOUNT_POINT,
    key_tmpfile: '/tmp/borgmatic-sshfs-key-backup_abc123-0',
    mount_options: null,
    exclude_patterns: [],
};

const ENCODED = Buffer.from(JSON.stringify(META)).toString('base64');

/** A mount script in the shape generated before the fix. */
function legacyMountScript() {
    return `#!/usr/bin/env bash
set -euo pipefail
# BORGMATIC_UI_SSH_META_B64:${ENCODED}
MOUNT_POINT='${MOUNT_POINT}'
HOST='10.16.18.54'
mkdir -p "$MOUNT_POINT"
if mountpoint -q "$MOUNT_POINT"; then
  fusermount -uz "$MOUNT_POINT" 2>/dev/null || true
fi
sshfs -p "$PORT" "$USER_NAME@$HOST:$REMOTE_PATH" "$MOUNT_POINT"`;
}

/** An umount script in the shape generated before the fix. */
function legacyUmountScript() {
    return `#!/usr/bin/env bash
set +e
MOUNT_POINT='${MOUNT_POINT}'
if mountpoint -q "$MOUNT_POINT"; then
  fusermount -uz "$MOUNT_POINT" 2>/dev/null || umount -l "$MOUNT_POINT" 2>/dev/null || true
fi
rmdir "$MOUNT_POINT" 2>/dev/null || true
exit 0`;
}

/**
 * Position of a command within a script, ignoring comment lines — the scripts
 * discuss "mkdir -p" in their comments, so raw indexOf finds the wrong thing.
 */
function commandLine(script, needle) {
    return script
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .findIndex((l) => l.includes(needle));
}

function expectCleanupBeforeMkdir(script) {
    const cleanup = commandLine(script, 'fusermount');
    const mkdir = commandLine(script, 'mkdir -p');
    expect(cleanup).toBeGreaterThanOrEqual(0);
    expect(mkdir).toBeGreaterThanOrEqual(0);
    expect(cleanup).toBeLessThan(mkdir);
}

function legacyConfig() {
    return {
        source_directories: [MOUNT_POINT],
        commands: [
            { before: 'action', when: ['create'], run: [legacyMountScript()] },
            { after: 'action', when: ['create'], run: [legacyUmountScript()] },
            { after: 'error', run: [legacyUmountScript()] },
        ],
    };
}

describe('rewriteSshfsHooks', () => {
    it('moves stale-mount cleanup ahead of mkdir in the mount script', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        expectCleanupBeforeMkdir(config.commands[0].run[0]);
    });

    it('drops the mountpoint guard that failed on dead mounts', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        for (const hook of config.commands) {
            expect(hook.run[0]).not.toContain('if mountpoint -q "$MOUNT_POINT"; then\n  fusermount');
        }
    });

    it('caps the unmount so a wedged mount cannot hang the backup', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        expect(config.commands[0].run[0]).toContain('TIMEOUT_BIN');
    });

    it('tries the fuse3 helper first — the image has no plain fusermount', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        for (const hook of config.commands) {
            const script = hook.run[0];
            expect(commandLine(script, 'fusermount3 -uz')).toBeGreaterThanOrEqual(0);
            expect(commandLine(script, 'fusermount3 -uz'))
                .toBeLessThan(commandLine(script, 'umount -l'));
        }
    });

    it('rewrites both the mount hook and every umount hook', () => {
        const config = legacyConfig();
        const { rewritten } = rewriteSshfsHooks(config);

        expect(rewritten).toBe(3);
    });

    it('preserves the metadata marker byte-for-byte', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        expect(config.commands[0].run[0]).toContain(`BORGMATIC_UI_SSH_META_B64:${ENCODED}`);
    });

    it('rebuilds the connection details from the marker', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);

        const script = config.commands[0].run[0];
        expect(script).toContain("HOST='10.16.18.54'");
        expect(script).toContain("USER_NAME='sim-code-read'");
        expect(script).toContain("REMOTE_PATH='/SIM-Code-Backup'");
    });

    it('is idempotent — a second run changes nothing', () => {
        const config = legacyConfig();
        rewriteSshfsHooks(config);
        const { rewritten } = rewriteSshfsHooks(config);

        expect(rewritten).toBe(0);
    });

    it('leaves unrelated hooks untouched', () => {
        const config = legacyConfig();
        const dbHook = '#!/usr/bin/env bash\npg_dump mydb > /tmp/dump.sql';
        config.commands.push({ before: 'action', when: ['create'], run: [dbHook] });

        rewriteSshfsHooks(config);

        expect(config.commands[3].run[0]).toBe(dbHook);
    });

    it('leaves a hook alone when its marker is unreadable', () => {
        const broken = `#!/usr/bin/env bash\n# ${'BORGMATIC_UI_SSH_META_B64:'}not-valid-base64!!\nmkdir -p /x`;
        const config = { commands: [{ before: 'action', run: [broken] }] };

        const { rewritten, skipped } = rewriteSshfsHooks(config);

        expect(rewritten).toBe(0);
        expect(config.commands[0].run[0]).toBe(broken);
        expect(skipped).toHaveLength(1);
    });

    it('does not touch an umount hook for an unknown mount point', () => {
        const foreign = `#!/usr/bin/env bash\nMOUNT_POINT='/mnt/other'\nfusermount -uz "$MOUNT_POINT"`;
        const config = { commands: [{ after: 'action', run: [foreign] }] };

        rewriteSshfsHooks(config);

        expect(config.commands[0].run[0]).toBe(foreign);
    });

    it('handles a config with no commands', () => {
        expect(() => rewriteSshfsHooks({})).not.toThrow();
    });

    it('repairs password-auth sources too', () => {
        const meta = {
            ...META,
            auth_method: 'password',
            ssh_key_id: null,
            ssh_key_env_var: null,
            ssh_password_env_var: 'BORGMATIC_UI_SSHPASS_backup_abc123_0',
            key_tmpfile: null,
        };
        const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
        const config = {
            commands: [{
                before: 'action',
                run: [`#!/usr/bin/env bash\n# ${'BORGMATIC_UI_SSH_META_B64:'}${encoded}\nMOUNT_POINT='${MOUNT_POINT}'\nmkdir -p "$MOUNT_POINT"`],
            }],
        };

        const { rewritten } = rewriteSshfsHooks(config);

        expect(rewritten).toBe(1);
        const script = config.commands[0].run[0];
        expectCleanupBeforeMkdir(script);
        expect(script).toContain('printenv BORGMATIC_UI_SSHPASS_backup_abc123_0');
    });
});

describe('serializeWithOriginalHeader', () => {
    it('keeps the original header comments', () => {
        const original = '# Generated by Borgmatic-UI\n# Backup ID: backup-abc\n\nsource_directories:\n  - /tmp\n';

        const out = serializeWithOriginalHeader(original, { source_directories: ['/tmp'] });

        expect(out).toContain('# Generated by Borgmatic-UI');
        expect(out).toContain('# Backup ID: backup-abc');
    });

    it('round-trips to the same parsed config', () => {
        const original = '# header\n\nsource_directories:\n  - /tmp\n';
        const config = { source_directories: ['/tmp'], commands: [{ run: ['echo hi'] }] };

        expect(yaml.load(serializeWithOriginalHeader(original, config))).toEqual(config);
    });

    it('works when the file has no header', () => {
        expect(serializeWithOriginalHeader('a: 1\n', { a: 1 })).toBe('a: 1\n');
    });
});

describe('migrateSshfsHooks', () => {
    let dir;
    let backupsDir;
    let archiveDir;

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshfs-migration-'));
        backupsDir = path.join(dir, 'borgmatic.d');
        archiveDir = path.join(dir, '.migration-backups');
        await fs.ensureDir(backupsDir);
    });

    afterEach(async () => {
        await fs.remove(dir);
    });

    const run = () => migrateSshfsHooks({ backupsDir, backupDir: archiveDir });

    async function writeJob(name, config, header = '# Generated by Borgmatic-UI\n# Backup ID: backup-abc\n') {
        const text = `${header}\n${yaml.dump(config, { indent: 2, lineWidth: 120, noRefs: true })}`;
        await fs.writeFile(path.join(backupsDir, name), text);
    }

    it('repairs a job on disk', async () => {
        await writeJob('job.yaml', legacyConfig());

        const result = await run();

        expect(result.filesChanged).toBe(1);
        expect(result.hooksRewritten).toBe(3);

        const written = yaml.load(await fs.readFile(path.join(backupsDir, 'job.yaml'), 'utf8'));
        expectCleanupBeforeMkdir(written.commands[0].run[0]);
    });

    it('keeps a copy of the original outside borgmatic.d', async () => {
        await writeJob('job.yaml', legacyConfig());

        await run();

        const archived = yaml.load(
            await fs.readFile(path.join(archiveDir, 'job.yaml.pre-sshfs-fix'), 'utf8')
        );
        const script = archived.commands[0].run[0];
        expect(commandLine(script, 'mkdir -p')).toBeLessThan(commandLine(script, 'fusermount -uz'));
        expect(await fs.readdir(backupsDir)).toEqual(['job.yaml']);
    });

    it('preserves the file header', async () => {
        await writeJob('job.yaml', legacyConfig());

        await run();

        const text = await fs.readFile(path.join(backupsDir, 'job.yaml'), 'utf8');
        expect(text.startsWith('# Generated by Borgmatic-UI\n# Backup ID: backup-abc')).toBe(true);
    });

    it('does not rewrite on a second run', async () => {
        await writeJob('job.yaml', legacyConfig());
        await run();
        const afterFirst = await fs.readFile(path.join(backupsDir, 'job.yaml'), 'utf8');

        const result = await run();

        expect(result.filesChanged).toBe(0);
        expect(await fs.readFile(path.join(backupsDir, 'job.yaml'), 'utf8')).toBe(afterFirst);
    });

    it('ignores jobs that have no ssh sources', async () => {
        await writeJob('plain.yaml', { source_directories: ['/etc'] });

        const result = await run();

        expect(result.scanned).toBe(0);
        expect(result.filesChanged).toBe(0);
    });

    it('reports malformed yaml without aborting the run', async () => {
        await fs.writeFile(path.join(backupsDir, 'broken.yaml'), `x: [\n# ${'BORGMATIC_UI_SSH_META_B64:'}${ENCODED}\n`);
        await writeJob('good.yaml', legacyConfig());

        const result = await run();

        expect(result.errors).toHaveLength(1);
        expect(result.filesChanged).toBe(1);
    });

    it('returns an empty result when the directory is missing', async () => {
        const result = await migrateSshfsHooks({ backupsDir: path.join(dir, 'nope') });

        expect(result).toMatchObject({ scanned: 0, filesChanged: 0 });
    });
});
