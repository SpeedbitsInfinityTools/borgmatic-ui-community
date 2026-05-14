/**
 * Hook metadata extractors and source-summary builders.
 *
 * Extracted from BackupManager to keep each module under ~1000 lines.
 * These parse base64-encoded metadata markers from borgmatic command hooks
 * and build UI-facing source summaries from parsed YAML configs.
 */

// ---------------------------------------------------------------------------
// Hook metadata extraction
// ---------------------------------------------------------------------------

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

    let hasReposShWithoutMarker = false;
    for (const hook of hooks) {
        if (typeof hook !== 'string') continue;
        if (hook.includes(marker)) {
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
        } else if (/repos\.sh\b/.test(hook) && /--backup\b/.test(hook)) {
            // Older or externally-edited configs that invoke repos.sh without
            // the JSON metadata marker. We can't reconstruct full wizard state
            // from them, but we still want the UI to recognize this as a Git
            // backup (e.g. to expose the Git Restore button).
            hasReposShWithoutMarker = true;
        }
    }

    if (sources.length === 0 && hasReposShWithoutMarker) {
        sources.push({
            type: 'git_repos',
            platform: 'unknown',
            scope: 'unknown',
            backup_type: 'unknown',
            repo_selection: 'all',
            _fallback: true,
        });
    }
    return sources;
}

/**
 * Extract SSH/SFTP source rows from the wizard-emitted before-hooks.
 *
 * The before-hook script for an SSH source carries a base64 metadata marker
 * with all non-secret wizard fields. We decode and return them so the
 * Backups page (and the Edit-Backup wizard) can show / round-trip the
 * source. Secrets (password) are referenced by env-var name only and are
 * never embedded in the marker.
 */
function extractSshSourcesFromHooks(config) {
    const sources = [];
    const hooks = [];
    if (Array.isArray(config.commands)) {
        for (const commandHook of config.commands) {
            if (!commandHook || !Array.isArray(commandHook.run)) continue;
            hooks.push(...commandHook.run);
        }
    }
    const marker = 'BORGMATIC_UI_SSH_META_B64:';

    for (const hook of hooks) {
        if (typeof hook !== 'string' || !hook.includes(marker)) continue;
        try {
            const line = hook.split('\n').find((l) => l.includes(marker));
            if (!line) continue;
            const encoded = line.substring(line.indexOf(marker) + marker.length).trim();
            const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            if (parsed?.type === 'ssh') {
                const passwordEnvVar = parsed.ssh_password_env_var;
                const passwordPlaceholder = typeof passwordEnvVar === 'string'
                    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnvVar)
                    ? '${' + passwordEnvVar + '}'
                    : undefined;
                sources.push({
                    type: 'ssh',
                    host: parsed.host,
                    port: parsed.port || 22,
                    username: parsed.username,
                    auth_method: parsed.auth_method || 'key',
                    ssh_key_id: parsed.ssh_key_id || null,
                    ssh_password: passwordPlaceholder,
                    remote_path: parsed.remote_path,
                    mount_point: parsed.mount_point,
                    mount_options: parsed.mount_options || '',
                    exclude_patterns: Array.isArray(parsed.exclude_patterns) ? parsed.exclude_patterns : [],
                });
            }
        } catch (e) {
            // Ignore malformed metadata markers from older/broken configs.
        }
    }

    return sources;
}

// ---------------------------------------------------------------------------
// Source summary builders (for UI display)
// ---------------------------------------------------------------------------

/**
 * Detect whether a path is a generated DB dump temp directory.
 */
function isDumpTempPath(p) {
    if (!p || typeof p !== 'string') return false;
    const base = p.split('/').pop() || '';
    return (
        base === 'borgmatic_mssql_dumps' ||
        base.startsWith('borgmatic_mssql_dumps_backup_') ||
        base.startsWith('borgmatic_db_dumps_backup_')
    );
}

/**
 * Build a UI-oriented source summary from a parsed borgmatic config.
 */
function getSourcesSummary(config) {
    const sources = [];

    const gitRepoSources = extractGitRepoSourcesFromHooks(config);
    const gitRepoPaths = new Set();
    for (const gs of gitRepoSources) {
        if (gs.target_dir) gitRepoPaths.add(gs.target_dir);
        if (gs.target_dir_clone) gitRepoPaths.add(gs.target_dir_clone);
    }
    sources.push(...gitRepoSources.map(gs => {
        const envVar = gs.pat_env_var;
        const patPlaceholder = typeof envVar === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)
            ? '${' + envVar + '}'
            : undefined;
        return {
            type: 'git_repos',
            platform: gs.platform,
            scope: gs.scope || 'organization',
            backup_type: gs.backup_type || 'mirror',
            target_dir: gs.target_dir,
            target_dir_clone: gs.target_dir_clone,
            organization: gs.organization,
            user: gs.user,
            group: gs.group,
            workspace: gs.workspace,
            project: gs.project,
            host: gs.host,
            repo_selection: gs.repo_selection || 'all',
            selected_repos: gs.selected_repos,
            repo_name: gs.repo_name,
            bb_username: gs.bb_username,
            bb_auth_mode: gs.bb_auth_mode,
            include_private: gs.include_private,
            include_forks: gs.include_forks,
            include_archived: gs.include_archived,
            include_subgroups: gs.include_subgroups,
            group_by_project: gs.group_by_project,
            prune: gs.prune,
            repo_type: gs.repo_type,
            pat: patPlaceholder,
            pat_env_var: gs.pat_env_var,
        };
    }));

    const sshSources = extractSshSourcesFromHooks(config);
    const sshMountPoints = new Set();
    for (const ss of sshSources) {
        if (ss.mount_point) sshMountPoints.add(ss.mount_point);
    }
    sources.push(...sshSources.map((ss) => ({
        type: 'ssh',
        host: ss.host,
        port: ss.port,
        username: ss.username,
        auth_method: ss.auth_method,
        ssh_key_id: ss.ssh_key_id,
        remote_path: ss.remote_path,
        mount_point: ss.mount_point,
    })));

    const sourceDirs = config.source_directories || config.location?.source_directories || [];
    sources.push(...sourceDirs.map(dir => ({
        type: 'local',
        path: dir
    })).filter((s) => !isDumpTempPath(s.path) && !gitRepoPaths.has(s.path) && !sshMountPoints.has(s.path)));

    ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite'].forEach(dbType => {
        const dbKey = `${dbType}_databases`;
        if (config[dbKey]) {
            config[dbKey].forEach(db => {
                const isHostDatabase = db.hostname === 'host.docker.internal';
                const connection_type = dbType === 'sqlite' ? 'file' : (isHostDatabase ? 'host' : 'network');

                sources.push({
                    type: dbType,
                    database_type: dbType,
                    database_name: db.name,
                    hostname: db.hostname,
                    port: db.port,
                    username: db.username,
                    password: undefined,
                    tls: db.tls,
                    path: db.path,
                    is_host_database: isHostDatabase,
                    connection_type,
                    dump_method: dbType === 'sqlite' ? undefined : 'native',
                });
            });
        }
    });

    const dbDumpSources = extractDbDumpSourcesFromHooks(config).map((db) => ({
        type: db.type,
        database_type: db.type,
        database_name: db.database_name,
        hostname: db.hostname,
        port: db.port,
        username: db.username,
        password: undefined,
        tls: db.tls,
        ssl_mode: db.ssl_mode || null,
        auth_method: db.auth_method || 'password',
        aws_region: db.aws_region || null,
        is_host_database: !!db.is_host_database,
        connection_type: db.is_host_database ? 'host' : 'network',
        dump_method: 'local',
    }));
    sources.push(...dbDumpSources);

    const mssqlSources = extractMssqlSourcesFromHooks(config).map((db) => {
        const src = {
            type: 'mssql',
            database_type: 'mssql',
            database_name: db.database_name,
            hostname: db.hostname,
            port: db.port,
            username: db.username,
            password: undefined,
            instance: db.instance || '',
            encrypt: db.encrypt || 'true',
            trustServerCert: !!db.trustServerCert,
            is_host_database: !!db.is_host_database,
            connection_type: db.is_host_database ? 'host' : 'network',
            auth_method: db.auth_method || 'sql',
        };
        if (db.client_id) src.client_id = db.client_id;
        if (db.tenant_id) src.tenant_id = db.tenant_id;
        return src;
    });
    sources.push(...mssqlSources);

    return sources;
}

/**
 * Reconstruct wizard "sources" array from a parsed borgmatic config.
 */
function extractSourcesFromConfig(config) {
    const sources = [];

    const gitRepoSources = extractGitRepoSourcesFromHooks(config);
    const gitRepoPaths = new Set();
    for (const gs of gitRepoSources) {
        if (gs.target_dir) gitRepoPaths.add(gs.target_dir);
        if (gs.target_dir_clone) gitRepoPaths.add(gs.target_dir_clone);
        sources.push({ ...gs, type: 'git_repos' });
    }

    const sshSources = extractSshSourcesFromHooks(config);
    const sshMountPoints = new Set();
    for (const ss of sshSources) {
        if (ss.mount_point) sshMountPoints.add(ss.mount_point);
        sources.push({ ...ss, type: 'ssh' });
    }

    const sourceDirs = config.source_directories || config.location?.source_directories || [];
    for (const dir of sourceDirs) {
        if (isDumpTempPath(dir)) continue;
        if (gitRepoPaths.has(dir)) continue;
        if (sshMountPoints.has(dir)) continue;
        sources.push({ type: 'local', path: dir });
    }

    if (config.postgresql_databases) {
        for (const db of config.postgresql_databases) {
            sources.push({
                type: 'postgresql',
                database_name: db.name,
                hostname: db.hostname,
                port: db.port,
                username: db.username,
                password: db.password,
                dump_method: 'native',
            });
        }
    }

    if (config.mysql_databases) {
        for (const db of config.mysql_databases) {
            sources.push({
                type: 'mysql',
                database_name: db.name,
                hostname: db.hostname,
                port: db.port,
                username: db.username,
                password: db.password,
                tls: db.tls,
                dump_method: 'native',
            });
        }
    }

    if (config.mariadb_databases) {
        for (const db of config.mariadb_databases) {
            sources.push({
                type: 'mariadb',
                database_name: db.name,
                hostname: db.hostname,
                port: db.port,
                username: db.username,
                password: db.password,
                tls: db.tls,
                dump_method: 'native',
            });
        }
    }

    if (config.mongodb_databases) {
        for (const db of config.mongodb_databases) {
            sources.push({
                type: 'mongodb',
                database_name: db.name,
                hostname: db.hostname,
                port: db.port,
                username: db.username,
                password: db.password,
                authentication_database: db.authentication_database,
                dump_method: 'native',
            });
        }
    }

    if (config.sqlite_databases) {
        for (const db of config.sqlite_databases) {
            sources.push({
                type: 'sqlite',
                database_name: db.name,
                path: db.path
            });
        }
    }

    sources.push(...extractMssqlSourcesFromHooks(config));
    sources.push(...extractDbDumpSourcesFromHooks(config));

    return sources;
}

/**
 * Get repositories summary for UI display.
 */
function getRepositoriesSummary(config, allRepos = []) {
    const repos = config.repositories || config.location?.repositories || [];
    if (!repos.length) return [];

    return repos.map(repo => {
        const matchedRepo = allRepos.find(r => r.path === repo.path);
        return {
            path: repo.path,
            label: repo.label,
            borg_version: matchedRepo?.borg_version || repo.borg_version || null
        };
    });
}

module.exports = {
    extractMssqlSourcesFromHooks,
    extractDbDumpSourcesFromHooks,
    extractGitRepoSourcesFromHooks,
    extractSshSourcesFromHooks,
    isDumpTempPath,
    getSourcesSummary,
    extractSourcesFromConfig,
    getRepositoriesSummary,
};
