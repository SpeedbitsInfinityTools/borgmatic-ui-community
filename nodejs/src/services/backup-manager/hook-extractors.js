/**
 * Extract backup source metadata from borgmatic command hooks.
 * Parses Base64-encoded JSON markers embedded in hook scripts.
 * All functions are pure (operate on config objects, no I/O).
 */

const path = require('path');

function isDumpTempPath(dir) {
    if (typeof dir !== 'string') return false;
    const base = path.basename(dir);
    return (
        base === 'borgmatic_mssql_dumps' ||
        base.startsWith('borgmatic_mssql_dumps_backup_') ||
        base.startsWith('borgmatic_db_dumps_backup_')
    );
}

function extractMssqlSourcesFromHooks(config) {
    const sources = [];
    const hooks = [];
    if (Array.isArray(config.before_backup)) {
        hooks.push(...config.before_backup);
    }
    if (Array.isArray(config.commands)) {
        for (const commandHook of config.commands) {
            if (!commandHook || !Array.isArray(commandHook.run)) continue;
            hooks.push(...commandHook.run);
        }
    }
    const marker = 'BORGMATIC_UI_MSSQL_META_B64:';

    for (const hook of hooks) {
        if (typeof hook !== 'string' || !hook.includes(marker)) continue;
        try {
            const line = hook.split('\n').find((l) => l.includes(marker));
            if (!line) continue;
            const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
            const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            if (parsed?.type === 'mssql') {
                const src = {
                    type: 'mssql',
                    database_name: parsed.database_name,
                    hostname: parsed.hostname,
                    port: parsed.port,
                    username: parsed.username,
                    instance: parsed.instance || '',
                    encrypt: parsed.encrypt || 'true',
                    trustServerCert: !!parsed.trustServerCert,
                    is_host_database: !!parsed.is_host_database,
                    password: undefined,
                    auth_method: parsed.auth_method || 'sql',
                };
                if (parsed.client_id) src.client_id = parsed.client_id;
                if (parsed.tenant_id) src.tenant_id = parsed.tenant_id;
                sources.push(src);
            }
        } catch (e) {
            // Ignore malformed metadata markers from older/broken configs.
        }
    }

    return sources;
}

function extractDbDumpSourcesFromHooks(config) {
    const sources = [];
    const hooks = [];
    if (Array.isArray(config.commands)) {
        for (const commandHook of config.commands) {
            if (!commandHook || !Array.isArray(commandHook.run)) continue;
            hooks.push(...commandHook.run);
        }
    }
    const marker = 'BORGMATIC_UI_DB_META_B64:';

    for (const hook of hooks) {
        if (typeof hook !== 'string' || !hook.includes(marker)) continue;
        try {
            const line = hook.split('\n').find((l) => l.includes(marker));
            if (!line) continue;
            const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
            const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            if (parsed?.type && ['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(parsed.type)) {
                const envVar = parsed.db_password_env_var;
                const placeholder = typeof envVar === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)
                    ? '${' + envVar + '}'
                    : undefined;
                sources.push({
                    type: parsed.type,
                    database_name: parsed.database_name,
                    hostname: parsed.hostname,
                    port: parsed.port,
                    username: parsed.username,
                    tls: parsed.tls,
                    ssl_mode: parsed.ssl_mode || null,
                    auth_method: parsed.auth_method || 'password',
                    aws_region: parsed.aws_region || null,
                    authentication_database: parsed.authentication_database,
                    is_host_database: !!parsed.is_host_database,
                    dump_method: 'local',
                    password: placeholder,
                });
            }
        } catch (e) {
            // Ignore malformed metadata
        }
    }

    return sources;
}

function extractGitRepoSourcesFromHooks(config) {
    const sources = [];
    const hooks = [];
    if (Array.isArray(config.commands)) {
        for (const commandHook of config.commands) {
            if (!commandHook || !Array.isArray(commandHook.run)) continue;
            hooks.push(...commandHook.run);
        }
    }
    const marker = 'BORGMATIC_UI_GIT_META_B64:';

    for (const hook of hooks) {
        if (typeof hook !== 'string' || !hook.includes(marker)) continue;
        try {
            const line = hook.split('\n').find((l) => l.includes(marker));
            if (!line) continue;
            const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
            const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            if (parsed?.type === 'git_repos') {
                sources.push(parsed);
            }
        } catch (e) {
            // Ignore malformed metadata
        }
    }
    return sources;
}

module.exports = {
    isDumpTempPath,
    extractMssqlSourcesFromHooks,
    extractDbDumpSourcesFromHooks,
    extractGitRepoSourcesFromHooks,
};
