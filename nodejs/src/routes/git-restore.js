const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const passwordManager = require('../services/password-manager');
const configParser = require('../services/config-parser');
const { getBorgPath } = require('../services/borg-version-detector');
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

async function buildBorgEnv(repositoryPath) {
    const env = { ...process.env };
    try {
        const passphrase = await passwordManager.getRepositoryPassphrase(repositoryPath);
        if (passphrase) env.BORG_PASSPHRASE = passphrase;
    } catch {
        // ignore missing passphrase
    }
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
    const dirs = new Map();
    const prefix = basePath ? basePath.replace(/\/$/, '') + '/' : '';

    for (const item of entries) {
        if (item.type !== 'd') continue;

        const itemPath = item.path;
        const relative = prefix && itemPath.startsWith(prefix) ? itemPath.slice(prefix.length) : itemPath;
        if (!relative || relative.includes('..')) continue;

        const isBareRepo = relative.endsWith('.git') && !relative.includes('/.git');
        const segments = relative.split('/');
        const isTopLevelDir = segments.length === 1;
        const isGroupedRepo = segments.length === 2;

        if (isBareRepo && (isTopLevelDir || isGroupedRepo)) {
            dirs.set(relative, {
                name: relative.replace(/\.git$/, ''),
                path: itemPath,
                type: 'mirror',
                group: isGroupedRepo ? segments[0] : null,
            });
        } else if ((isTopLevelDir || isGroupedRepo) && !relative.includes('.')) {
            if (!dirs.has(relative + '.git') && !dirs.has(relative)) {
                dirs.set(relative, {
                    name: relative,
                    path: itemPath,
                    type: 'clone',
                    group: isGroupedRepo ? segments[0] : null,
                });
            }
        }
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
    const env = await buildBorgEnv(repository);

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
    const { platform, organization, user, workspace, host, pat, bb_username } = req.body;

    if (!platform || !pat) {
        return res.status(400).json({ error: 'platform and pat are required' });
    }

    try {
        let url;
        let authHeaders;

        switch (platform) {
            case 'github': {
                const owner = organization || user;
                url = owner ? `https://api.github.com/orgs/${encodeURIComponent(owner)}` : 'https://api.github.com/user';
                authHeaders = { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' };
                break;
            }
            case 'gitlab': {
                const gitlabHost = (host || 'https://gitlab.com').replace(/\/$/, '');
                url = `${gitlabHost}/api/v4/user`;
                authHeaders = { 'PRIVATE-TOKEN': pat };
                break;
            }
            case 'bitbucket': {
                if (!workspace || !bb_username) {
                    return res.status(400).json({ error: 'Bitbucket requires workspace and username/email' });
                }
                url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=1`;
                const authStr = Buffer.from(`${bb_username}:${pat}`).toString('base64');
                authHeaders = { Authorization: `Basic ${authStr}` };
                break;
            }
            case 'azure': {
                if (!organization) {
                    return res.status(400).json({ error: 'Azure DevOps requires organization' });
                }
                url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=6.0&$top=1`;
                const authStr = Buffer.from(`:${pat}`).toString('base64');
                authHeaders = { Authorization: `Basic ${authStr}` };
                break;
            }
            default:
                return res.status(400).json({ error: `Unsupported platform: ${platform}` });
        }

        const response = await fetch(url, { headers: authHeaders });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return res.status(400).json({
                error: `Authentication failed (HTTP ${response.status})`,
                detail: sanitizeSensitive(detail.substring(0, 500), [pat]),
            });
        }

        res.json({ success: true, message: 'Connection successful. Credentials are valid.' });
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
            const borgEnv = await buildBorgEnv(String(repository));
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
    const owner = organization || user;
    const isOrg = !!organization;
    const url = isOrg
        ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`
        : 'https://api.github.com/user/repos';

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `token ${pat}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
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
