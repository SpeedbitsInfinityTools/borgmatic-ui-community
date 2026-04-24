const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const passwordManager = require('../services/password-manager');
const configParser = require('../services/config-parser');
const { getBorgPath } = require('../services/borg-version-detector');
const { configureBorgSshEnv } = require('../services/borg-ssh-env');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { execa } = require('execa');

const gitRestoreJobs = new Map();

function hasControlChars(value) {
    return /[\x00-\x1F\x7F]/.test(String(value || ''));
}

function validateArchiveName(name) {
    return (
        typeof name === 'string' &&
        name.length > 0 &&
        !hasControlChars(name) &&
        !name.includes('..') &&
        !name.includes('\\')
    );
}

function validateArchivePath(p) {
    if (!p) return true;
    if (typeof p !== 'string') return false;
    if (hasControlChars(p)) return false;
    if (p.includes('..')) return false;
    if (p.startsWith('/')) return false;
    return true;
}

function validateRepoName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 200 && /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * Normalize a platform identifier (org / user / workspace / group) that
 * a user types into the wizard. Strips common paste artefacts — trailing
 * slashes, leading '@', or a pasted URL — so that e.g.
 * "SpeedbitsInfinityTools/" or "https://github.com/SpeedbitsInfinityTools"
 * collapse down to "SpeedbitsInfinityTools" before they reach the API.
 * Kept intentionally conservative: does not change the inner value, only
 * removes well-known surrounding cruft.
 */
function normalizePlatformIdentifier(value) {
    if (value === undefined || value === null) return value;
    let v = String(value).trim();
    if (!v) return v;

    const urlLike = /^(https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}\/)/i.test(v);
    if (urlLike) {
        const cleaned = v.replace(/^https?:\/\//i, '');
        const parts = cleaned.split('/').filter(Boolean);
        const orgIdx = parts.findIndex(p => p.toLowerCase() === 'organizations');
        if (orgIdx >= 0 && parts[orgIdx + 1]) {
            v = parts[orgIdx + 1];
        } else if (parts.length >= 2) {
            v = parts[1];
        }
    }

    v = v.replace(/^@+/, '').replace(/\/+$/, '').trim();
    return v;
}

function sanitizeSensitive(text, secrets = []) {
    let out = String(text || '');
    for (const secret of secrets.filter(Boolean)) {
        out = out.split(secret).join('***');
    }
    return out;
}

async function getConfiguredRepository(repositoryPath) {
    const allRepos = await configParser.getAllRepositoriesWithUsage();
    return allRepos.find((r) => r.path === repositoryPath) || null;
}

async function buildBorgEnv(repositoryPath, context = 'Git Restore') {
    const env = { ...process.env };
    try {
        const passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        if (passphrase) env.BORG_PASSPHRASE = passphrase;
    } catch {
        // ignore missing passphrase
    }
    // Set up SSH auth for ssh:// repos (key/password from per-repo credentials).
    // Without this, `borg list`/`borg extract` against an SSH repo like Hetzner
    // would fall back to the global BORG_RSH default with no key attached and
    // fail with `Permission denied (publickey,password)`.
    await configureBorgSshEnv(env, repositoryPath, context);
    return env;
}

async function listArchiveEntries({ borgPath, repository, archive, basePath, env }) {
    const args = ['list', '--json-lines', `${repository}::${archive}`];
    if (basePath) args.push(basePath);

    const { stdout } = await execa(borgPath, args, {
        env,
        timeout: 120000,
        maxBuffer: 50 * 1024 * 1024,
    });

    return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function detectGitReposFromEntries(entries, basePath = '') {
    // A Git repository in the archive is either:
    //   a) a bare/mirror repo  -> directory whose name ends with ".git"
    //   b) a working-copy clone -> any directory containing a ".git" subdir
    //
    // We scan at ANY depth, because users commonly back up trees like
    // /home/user/repos/<org>/<project> or deeper, and the old heuristic
    // (depth 1 or 2 only) missed every real Git backup that repos.sh
    // produces.
    const dirs = new Map();
    const prefix = basePath ? basePath.replace(/\/$/, '') + '/' : '';

    const stripPrefix = (p) => {
        if (!prefix) return p;
        return p.startsWith(prefix) ? p.slice(prefix.length) : p;
    };

    // First pass: collect clone-type repos from `.git` subdirectory entries.
    // Given an entry like "a/b/project/.git", the parent "a/b/project" is a
    // Git working copy. This has priority over any mirror detection for the
    // same path.
    for (const item of entries) {
        if (item.type !== 'd') continue;
        const relative = stripPrefix(item.path);
        if (!relative || relative.includes('..')) continue;

        const isDotGit =
            relative === '.git' ||
            relative.endsWith('/.git');
        if (!isDotGit) continue;

        const parentRel = relative === '.git' ? '' : relative.slice(0, -'/.git'.length);
        const parentAbs = relative === '.git'
            ? item.path.replace(/\/?\.git\/?$/, '')
            : item.path.slice(0, -'/.git'.length);
        if (!parentAbs) continue;

        const segments = parentRel.split('/').filter(Boolean);
        const repoName = segments.length ? segments[segments.length - 1] : parentAbs.split('/').filter(Boolean).pop() || 'repo';
        const group = segments.length > 1 ? segments[segments.length - 2] : null;

        dirs.set(parentAbs, {
            name: repoName,
            path: parentAbs,
            type: 'clone',
            group,
        });
    }

    // Second pass: collect mirror/bare repos from any directory whose name
    // ends with ".git", unless we've already seen a clone at that location.
    for (const item of entries) {
        if (item.type !== 'd') continue;
        const relative = stripPrefix(item.path);
        if (!relative || relative.includes('..')) continue;

        // Skip if this is the `.git` subdir of a clone (handled above).
        if (relative === '.git' || relative.endsWith('/.git')) continue;

        if (!relative.endsWith('.git')) continue;

        if (dirs.has(item.path)) continue;

        const segments = relative.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        const repoName = last.replace(/\.git$/, '');
        const group = segments.length > 1 ? segments[segments.length - 2] : null;

        dirs.set(item.path, {
            name: repoName,
            path: item.path,
            type: 'mirror',
            group,
        });
    }

    return Array.from(dirs.values());
}

async function scanArchiveForGitRepos({ repository, archive, basePath }) {
    if (!repository || !archive) throw new Error('repository and archive are required');
    if (!validateArchiveName(archive)) throw new Error('Invalid archive name');
    if (!validateArchivePath(basePath)) throw new Error('Invalid archive path');

    const repo = await getConfiguredRepository(repository);
    if (!repo) throw new Error('Repository not found in configured repositories');

    const borgVersion = repo.borg_version || '1.x';
    const borgPath = getBorgPath(borgVersion);
    const env = await buildBorgEnv(repository, 'Git Restore Scan');

    const entries = await listArchiveEntries({ borgPath, repository, archive, basePath, env });
    return detectGitReposFromEntries(entries, basePath || '');
}

function buildGitPushAuthHeader(platform, { pat, bb_username, bb_auth_mode }) {
    if (platform === 'github') return `Authorization: Basic ${Buffer.from(`x-access-token:${pat}`).toString('base64')}`;
    if (platform === 'gitlab') return `Authorization: Basic ${Buffer.from(`oauth2:${pat}`).toString('base64')}`;
    if (platform === 'bitbucket') {
        const user = (bb_auth_mode === 'api_token' || bb_auth_mode === 'access_token')
            ? 'x-bitbucket-api-token-auth'
            : (bb_username || '');
        return `Authorization: Basic ${Buffer.from(`${user}:${pat}`).toString('base64')}`;
    }
    if (platform === 'azure') return `Authorization: Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    return '';
}

router.get('/scan', authenticateToken, async (req, res) => {
    const { repository, archive, basePath } = req.query;
    try {
        const repos = await scanArchiveForGitRepos({
            repository: String(repository || ''),
            archive: String(archive || ''),
            basePath: String(basePath || ''),
        });
        res.json({ success: true, repos, total: repos.length });
    } catch (err) {
        console.error('Git restore scan failed:', err.message);
        res.status(400).json({ error: err.message || 'Scan failed' });
    }
});

router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
    const {
        platform,
        organization: rawOrganization,
        user: rawUser,
        workspace: rawWorkspace,
        host,
        pat,
        bb_username,
    } = req.body;

    if (!platform || !pat) {
        return res.status(400).json({ error: 'platform and pat are required' });
    }

    const organization = normalizePlatformIdentifier(rawOrganization);
    const user = normalizePlatformIdentifier(rawUser);
    const workspace = normalizePlatformIdentifier(rawWorkspace);

    const redact = (text) => sanitizeSensitive(String(text || '').substring(0, 500), [pat]);

    try {
        switch (platform) {
            case 'github': {
                // Mirror repos.sh preflight behaviour:
                //   1) Validate the PAT itself via GET /user.
                //   2) If an owner was provided, try /orgs/{owner}, and on 404
                //      fall back to /users/{owner} (a personal account is not
                //      an organization, so /orgs/* returns 404 — which is what
                //      the user hit).
                const authHeaders = {
                    Authorization: `token ${pat}`,
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'borgmatic-ui',
                };

                const userResp = await fetch('https://api.github.com/user', { headers: authHeaders });
                if (!userResp.ok) {
                    const detail = await userResp.text().catch(() => '');
                    return res.status(400).json({
                        error: `GitHub PAT is invalid (HTTP ${userResp.status})`,
                        detail: redact(detail),
                    });
                }

                const owner = (organization || user || '').trim();
                if (!owner) {
                    const me = await userResp.json().catch(() => ({}));
                    return res.json({
                        success: true,
                        message: `Connection successful. Authenticated as ${me.login || 'user'}.`,
                    });
                }

                const orgResp = await fetch(
                    `https://api.github.com/orgs/${encodeURIComponent(owner)}`,
                    { headers: authHeaders }
                );
                if (orgResp.ok) {
                    return res.json({
                        success: true,
                        message: `Connection successful. Organization '${owner}' is accessible.`,
                    });
                }
                if (orgResp.status === 404) {
                    const userCheck = await fetch(
                        `https://api.github.com/users/${encodeURIComponent(owner)}`,
                        { headers: authHeaders }
                    );
                    if (userCheck.ok) {
                        const acct = await userCheck.json().catch(() => ({}));
                        const acctType = acct.type || 'User';
                        return res.json({
                            success: true,
                            message: `Connection successful. '${owner}' is a GitHub ${acctType} account (not an organization).`,
                        });
                    }
                    const detail = await userCheck.text().catch(() => '');
                    return res.status(400).json({
                        error: `'${owner}' was not found as a GitHub organization or user`,
                        detail: redact(detail),
                    });
                }
                const detail = await orgResp.text().catch(() => '');
                return res.status(400).json({
                    error: `Cannot access GitHub organization '${owner}' (HTTP ${orgResp.status}). The PAT may need SSO authorization or fine-grained access to this resource.`,
                    detail: redact(detail),
                });
            }

            case 'gitlab': {
                const gitlabHost = (host || 'https://gitlab.com').replace(/\/$/, '');
                const authHeaders = { 'PRIVATE-TOKEN': pat };

                // 1) Validate the PAT via /user.
                const r = await fetch(`${gitlabHost}/api/v4/user`, { headers: authHeaders });
                if (!r.ok) {
                    const detail = await r.text().catch(() => '');
                    return res.status(400).json({
                        error: `GitLab PAT is invalid (HTTP ${r.status})`,
                        detail: redact(detail),
                    });
                }
                const me = await r.json().catch(() => ({}));

                // 2) If a group/user namespace was provided, verify it exists.
                // GitLab namespaces cover both groups AND personal users with
                // a single unified endpoint, so there is no org-vs-user trap
                // like on GitHub.
                const targetGroup = (group || user || '').trim();
                if (targetGroup) {
                    const nsResp = await fetch(
                        `${gitlabHost}/api/v4/namespaces?search=${encodeURIComponent(targetGroup)}`,
                        { headers: authHeaders }
                    );
                    if (nsResp.ok) {
                        const namespaces = await nsResp.json().catch(() => []);
                        const match = Array.isArray(namespaces)
                            ? namespaces.find((n) => n.full_path === targetGroup || n.path === targetGroup)
                            : null;
                        if (!match) {
                            return res.status(400).json({
                                error: `GitLab namespace '${targetGroup}' was not found or is not visible to this PAT.`,
                                detail: 'The PAT authenticates correctly, but no group or user namespace matches that name. If this is a group, ensure the PAT has access to it.',
                            });
                        }
                        return res.json({
                            success: true,
                            message: `Connection successful. Authenticated as ${me.username || 'user'}; namespace '${match.full_path}' (${match.kind}) is accessible.`,
                        });
                    }
                    // Namespaces endpoint failed for some other reason — don't
                    // hard-fail, but report the PAT as valid.
                }

                return res.json({
                    success: true,
                    message: `Connection successful. Authenticated as ${me.username || 'user'} on ${gitlabHost}.`,
                });
            }

            case 'bitbucket': {
                if (!workspace || !bb_username) {
                    return res.status(400).json({ error: 'Bitbucket requires workspace and username/email' });
                }
                const authStr = Buffer.from(`${bb_username}:${pat}`).toString('base64');
                const authHeaders = { Authorization: `Basic ${authStr}`, Accept: 'application/json' };
                const r = await fetch(
                    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=1`,
                    { headers: authHeaders }
                );
                if (!r.ok) {
                    const detail = await r.text().catch(() => '');
                    return res.status(400).json({
                        error: `Bitbucket authentication failed (HTTP ${r.status})`,
                        detail: redact(detail),
                    });
                }
                return res.json({
                    success: true,
                    message: `Connection successful. Workspace '${workspace}' is accessible.`,
                });
            }

            case 'azure': {
                if (!organization) {
                    return res.status(400).json({ error: 'Azure DevOps requires organization' });
                }
                const authStr = Buffer.from(`:${pat}`).toString('base64');
                const authHeaders = { Authorization: `Basic ${authStr}`, Accept: 'application/json' };
                const r = await fetch(
                    `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=6.0&$top=1`,
                    { headers: authHeaders }
                );
                if (!r.ok) {
                    const detail = await r.text().catch(() => '');
                    return res.status(400).json({
                        error: `Azure DevOps authentication failed (HTTP ${r.status})`,
                        detail: redact(detail),
                    });
                }
                return res.json({
                    success: true,
                    message: `Connection successful. Organization '${organization}' is accessible.`,
                });
            }

            default:
                return res.status(400).json({ error: `Unsupported platform: ${platform}` });
        }
    } catch (err) {
        res.status(500).json({ error: sanitizeSensitive(err.message || 'Connection test failed', [pat]) });
    }
});

router.post('/execute', authenticateToken, requireAdmin, async (req, res) => {
    const {
        repository,
        archive,
        basePath,
        repos,
        platform,
        organization,
        group: targetGroup,
        user: targetUser,
        workspace,
        host,
        project,
        pat,
        bb_username,
        bb_auth_mode,
        nameSuffix,
        conflictMode,
        pushMode,
    } = req.body;

    if (!repository || !archive || !Array.isArray(repos) || repos.length === 0 || !platform || !pat) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!validateArchiveName(String(archive)) || !validateArchivePath(String(basePath || ''))) {
        return res.status(400).json({ error: 'Invalid archive/base path values' });
    }

    const jobId = uuidv4();
    const job = {
        id: jobId,
        status: 'running',
        startedAt: new Date().toISOString(),
        totalRepos: repos.length,
        completedRepos: 0,
        failedRepos: 0,
        currentRepo: null,
        results: [],
        log: [],
    };
    gitRestoreJobs.set(jobId, job);
    res.json({ success: true, jobId });

    (async () => {
        const secrets = [String(pat || '')].filter(Boolean);
        const addLog = (msg) => {
            job.log.push(`[${new Date().toISOString()}] ${sanitizeSensitive(msg, secrets)}`);
        };

        let tmpBase = null;
        try {
            const configuredRepo = await getConfiguredRepository(String(repository));
            if (!configuredRepo) throw new Error('Repository is not configured');

            const discoveredRepos = await scanArchiveForGitRepos({
                repository: String(repository),
                archive: String(archive),
                basePath: String(basePath || ''),
            });

            const discoveredByPath = new Map(discoveredRepos.map((r) => [r.path, r]));
            const selectedRepos = repos
                .filter((r) => r && typeof r.path === 'string' && discoveredByPath.has(r.path))
                .map((r) => discoveredByPath.get(r.path));

            if (selectedRepos.length === 0) {
                throw new Error('No valid repositories selected for restore');
            }

            job.totalRepos = selectedRepos.length;

            const borgVersion = configuredRepo.borg_version || '1.x';
            const borgPath = getBorgPath(borgVersion);
            const borgEnv = await buildBorgEnv(String(repository), 'Git Restore Extract');
            tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'git-restore-'));

            for (const repo of selectedRepos) {
                const repoName = String(repo.name || '').split('/').pop() || '';
                if (!validateRepoName(repoName)) {
                    job.failedRepos++;
                    job.results.push({ name: repoName || '<invalid>', targetName: repoName || '<invalid>', status: 'failed', message: 'Invalid repository name' });
                    continue;
                }

                const targetName = nameSuffix ? `${repoName}${nameSuffix}` : repoName;
                if (!validateRepoName(targetName)) {
                    job.failedRepos++;
                    job.results.push({ name: repoName, targetName, status: 'failed', message: 'Invalid target repository name' });
                    continue;
                }

                job.currentRepo = targetName;
                addLog(`Processing: ${repoName} -> ${targetName}`);

                try {
                    const extractDir = path.join(tmpBase, `extract-${repoName.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
                    await fs.ensureDir(extractDir);

                    addLog('Extracting from archive...');
                    await execa(borgPath, ['extract', `${repository}::${archive}`, repo.path], {
                        cwd: extractDir,
                        env: borgEnv,
                        timeout: 300000,
                        maxBuffer: 20 * 1024 * 1024,
                    });

                    const extractedPath = path.join(extractDir, repo.path);
                    if (!await fs.pathExists(extractedPath)) {
                        throw new Error(`Extraction failed: ${repo.path} not found`);
                    }

                    addLog(`Creating repository "${targetName}" on ${platform}...`);
                    let remoteUrl;
                    try {
                        remoteUrl = await createRemoteRepo(platform, targetName, {
                            organization,
                            group: targetGroup,
                            user: targetUser,
                            workspace,
                            host,
                            project,
                            pat,
                            bb_username,
                            bb_auth_mode,
                        });
                    } catch (createErr) {
                        if (conflictMode === 'skip' && String(createErr.message || '').toLowerCase().includes('already exists')) {
                            addLog(`Repository "${targetName}" already exists, skipping.`);
                            job.results.push({ name: repoName, targetName, status: 'skipped', message: 'Already exists' });
                            job.completedRepos++;
                            continue;
                        }
                        throw createErr;
                    }

                    const authHeader = buildGitPushAuthHeader(platform, { pat, bb_username, bb_auth_mode });
                    addLog('Pushing repository data...');

                    if (repo.type === 'mirror' || pushMode === 'all') {
                        await execa('git', ['-c', `http.extraHeader=${authHeader}`, 'push', '--mirror', remoteUrl], {
                            cwd: extractedPath,
                            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                            timeout: 600000,
                            maxBuffer: 20 * 1024 * 1024,
                        });
                    } else {
                        await execa('git', ['-c', `http.extraHeader=${authHeader}`, 'push', '--all', remoteUrl], {
                            cwd: extractedPath,
                            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                            timeout: 600000,
                            maxBuffer: 20 * 1024 * 1024,
                        });
                        await execa('git', ['-c', `http.extraHeader=${authHeader}`, 'push', '--tags', remoteUrl], {
                            cwd: extractedPath,
                            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                            timeout: 600000,
                            maxBuffer: 20 * 1024 * 1024,
                        });
                    }

                    addLog(`Successfully restored: ${targetName}`);
                    job.results.push({ name: repoName, targetName, status: 'success' });
                    job.completedRepos++;
                } catch (repoErr) {
                    const safeMsg = sanitizeSensitive(repoErr.message || 'Unknown error', secrets);
                    addLog(`FAILED: ${repoName} - ${safeMsg}`);
                    job.results.push({ name: repoName, targetName, status: 'failed', message: safeMsg });
                    job.failedRepos++;
                }
            }

            job.status = job.failedRepos > 0 ? (job.completedRepos > 0 ? 'partial' : 'failed') : 'success';
        } catch (err) {
            const safeMsg = sanitizeSensitive(err.message || 'Job failed', [String(pat || '')]);
            addLog(`Job failed: ${safeMsg}`);
            job.status = 'failed';
        } finally {
            job.currentRepo = null;
            job.finishedAt = new Date().toISOString();
            if (tmpBase) await fs.remove(tmpBase).catch(() => {});
        }
    })();
});

router.get('/status/:jobId', authenticateToken, async (req, res) => {
    const job = gitRestoreJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, data: job });
});

async function createRemoteRepo(platform, repoName, opts) {
    switch (platform) {
        case 'github':
            return createGitHubRepo(repoName, opts);
        case 'gitlab':
            return createGitLabRepo(repoName, opts);
        case 'bitbucket':
            return createBitbucketRepo(repoName, opts);
        case 'azure':
            return createAzureRepo(repoName, opts);
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

async function createGitHubRepo(repoName, { organization, user, pat }) {
    // The frontend exposes a single "Organization or Username" field, so we
    // cannot trust `organization` to literally mean an org. Resolve which
    // endpoint to hit by probing /orgs/{owner} first and falling back to the
    // authenticated user's repo endpoint on 404 — matching the behaviour of
    // the /test endpoint and scripts/repos.sh preflight.
    const baseHeaders = {
        Authorization: `token ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'borgmatic-ui',
    };

    const owner = (organization || user || '').trim();
    let createUrl = 'https://api.github.com/user/repos';
    if (owner) {
        const orgResp = await fetch(
            `https://api.github.com/orgs/${encodeURIComponent(owner)}`,
            { headers: baseHeaders }
        );
        if (orgResp.ok) {
            createUrl = `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`;
        } else if (orgResp.status === 404) {
            // Personal account — repos are created under the authenticated user.
            // GitHub will reject the request if the PAT does not actually own
            // this user namespace, so there's no risk of creating a repo under
            // the wrong account.
            createUrl = 'https://api.github.com/user/repos';
        } else {
            const body = await orgResp.text().catch(() => '');
            throw new Error(`Cannot access GitHub owner '${owner}' (HTTP ${orgResp.status}): ${body.substring(0, 300)}`);
        }
    }

    const resp = await fetch(createUrl, {
        method: 'POST',
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, private: true }),
    });

    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        if (resp.status === 422 && body.includes('already exists')) {
            throw new Error(`Repository "${repoName}" already exists on GitHub`);
        }
        throw new Error(`GitHub API error ${resp.status}: ${body.substring(0, 300)}`);
    }

    const data = await resp.json();
    return data.clone_url;
}

async function createGitLabRepo(repoName, { group, host, pat }) {
    const gitlabHost = (host || 'https://gitlab.com').replace(/\/$/, '');

    const body = { name: repoName, visibility: 'private' };
    if (group) {
        const nsResp = await fetch(`${gitlabHost}/api/v4/namespaces?search=${encodeURIComponent(group)}`, {
            headers: { 'PRIVATE-TOKEN': pat },
        });
        if (nsResp.ok) {
            const namespaces = await nsResp.json();
            const ns = namespaces.find((n) => n.full_path === group || n.path === group);
            if (ns) body.namespace_id = ns.id;
        }
    }

    const resp = await fetch(`${gitlabHost}/api/v4/projects`, {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': pat, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (text.includes('has already been taken')) {
            throw new Error(`Repository "${repoName}" already exists on GitLab`);
        }
        throw new Error(`GitLab API error ${resp.status}: ${text.substring(0, 300)}`);
    }

    const data = await resp.json();
    return data.http_url_to_repo;
}

async function createBitbucketRepo(repoName, { workspace, pat, bb_username }) {
    if (!workspace || !bb_username) {
        throw new Error('Bitbucket restore requires workspace and username/email');
    }

    const authStr = Buffer.from(`${bb_username}:${pat}`).toString('base64');
    const resp = await fetch(`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoName.toLowerCase())}`, {
        method: 'PUT',
        headers: { Authorization: `Basic ${authStr}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scm: 'git', is_private: true }),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if ((resp.status === 400 || resp.status === 409) && text.toLowerCase().includes('already exists')) {
            throw new Error(`Repository "${repoName}" already exists on Bitbucket`);
        }
        throw new Error(`Bitbucket API error ${resp.status}: ${text.substring(0, 300)}`);
    }

    return `https://bitbucket.org/${workspace}/${repoName.toLowerCase()}.git`;
}

async function createAzureRepo(repoName, { organization, project, pat }) {
    if (!organization) {
        throw new Error('Azure DevOps restore requires organization');
    }

    const proj = project || repoName;
    const authStr = Buffer.from(`:${pat}`).toString('base64');
    const resp = await fetch(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(proj)}/_apis/git/repositories?api-version=6.0`, {
        method: 'POST',
        headers: { Authorization: `Basic ${authStr}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName }),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (text.toLowerCase().includes('already exists')) {
            throw new Error(`Repository "${repoName}" already exists on Azure DevOps`);
        }
        throw new Error(`Azure DevOps API error ${resp.status}: ${text.substring(0, 300)}`);
    }

    const data = await resp.json();
    return data.remoteUrl || `https://dev.azure.com/${organization}/${proj}/_git/${repoName}`;
}

module.exports = router;
