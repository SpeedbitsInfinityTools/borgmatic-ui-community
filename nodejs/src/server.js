const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const authService = require('./services/auth');
const config = require('./config');
const { initRedis } = require('./services/redis-client');

// -----------------------------------------------------------------------------
// SSH host-key policy for borg/borgmatic invocations
// -----------------------------------------------------------------------------
// We run non-interactively, so OpenSSH's default `StrictHostKeyChecking=ask`
// for unknown hosts degrades to `yes` (= reject) and the user sees:
//   Remote: Host key verification failed.
//   Connection closed by remote host. Is borg working on the server?
// whenever `borg` needs to contact a host whose key isn't yet in known_hosts.
//
// Setting `accept-new` means:
//   - First connection to a new host: auto-accept and pin the key.
//   - Subsequent connections: verify against the pinned key; reject on mismatch.
// This is the only sensible default for a daemon process; an attacker who wants
// to MITM must still beat the initial trust-on-first-use, which is the same
// threat model as a human admin manually running `ssh-keyscan` once.
//
// We only set this if the admin hasn't already exported BORG_RSH themselves,
// so explicit configuration (custom ssh binary, extra flags, known_hosts path)
// always wins.
if (!process.env.BORG_RSH) {
    process.env.BORG_RSH = 'ssh -o StrictHostKeyChecking=accept-new';
}

// `accept-new` wants to append the pinned key to ~/.ssh/known_hosts. If that
// directory doesn't exist (fresh container, non-root user, etc.) ssh prints
// `Failed to add the host to the list of known hosts`. The warning is cosmetic
// — accept-new still lets the current connection proceed — but it confuses
// users reading the log output and can mask real errors next to it.
try {
    const home = process.env.HOME || '/root';
    const sshDir = path.join(home, '.ssh');
    if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    } else {
        try { fs.chmodSync(sshDir, 0o700); } catch (_e) { /* best-effort */ }
    }
} catch (e) {
    console.warn('Could not ensure ~/.ssh exists:', e.message);
}

// Get app version from package.json
const getAppVersion = () => {
    try {
        // Try root package.json first (monorepo source of truth)
        const rootPkgPath = path.join(__dirname, '..', '..', 'package.json');
        if (fs.existsSync(rootPkgPath)) {
            return require(rootPkgPath).version || '1.0.0';
        }
        // Fallback to nodejs package.json
        const nodejsPkgPath = path.join(__dirname, '..', 'package.json');
        if (fs.existsSync(nodejsPkgPath)) {
            return require(nodejsPkgPath).version || '1.0.0';
        }
    } catch (e) {
        console.error('Failed to read app version:', e.message);
    }
    return '1.0.0';
};

const app = express();
const PORT = config.port;

// Behind a TLS-terminating reverse proxy (nginx/Traefik/Caddy/...). Honor
// X-Forwarded-* headers so req.protocol / req.secure / req.ip reflect the
// original client, not the local socket from the proxy. Without this, any
// IP-based logic (rate limiting, client.ip recording, audit logs) would record
// `127.0.0.1` for every request.
//
// Scope: this is a *director-mode* feature (the env var is named
// DIRECTOR_TRUST_PROXY). Enabling it for client/standalone modes by accident
// would silently make those instances trust spoofed X-Forwarded-For headers
// from anything that can reach the local port — least surprise wins.
//
// We trust the immediate upstream only (one hop) — the safe default that
// prevents spoofing via crafted X-Forwarded-For headers from external callers.
// Operators with a chain of proxies should set DIRECTOR_TRUST_PROXY_HOPS to
// the number of trusted hops.
if (config.director.trustProxy && config.mode === 'director') {
    const hops = parseInt(process.env.DIRECTOR_TRUST_PROXY_HOPS, 10);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);
} else if (config.director.trustProxy && config.mode && config.mode !== 'director') {
    console.warn(`⚠️  DIRECTOR_TRUST_PROXY=true ignored — this instance is in ${config.mode} mode, not director`);
}

// Middleware
app.use(helmet());
app.use(cors({
    origin: true, // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Remote-Client-ID'],
    exposedHeaders: ['Content-Type', 'Cache-Control']
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Client proxy middleware - intercepts requests with X-Remote-Client-ID header
// Must be BEFORE routes to proxy to remote clients
const clientProxyMiddleware = require('./middleware/client-proxy');
app.use('/api', clientProxyMiddleware);

// Import routes
// Default to OFF; enable by setting DEBUG_ROUTES=true
const DEBUG_ROUTES = process.env.DEBUG_ROUTES === 'true';
const debugLog = (...args) => DEBUG_ROUTES && console.log(...args);

console.log('🔧 [server.js] Loading route modules...');
debugLog('🔧 [server.js] Loading route modules...');
let authRoutes, dashboardRoutes;
try {
    authRoutes = require('./routes/auth');
    console.log('🔧 [server.js] authRoutes loaded');
} catch (error) {
    console.error('❌ [server.js] ERROR loading authRoutes:', error.message);
    console.error('❌ [server.js] Error stack:', error.stack);
    throw error;
}
try {
    dashboardRoutes = require('./routes/dashboard');
    console.log('🔧 [server.js] dashboardRoutes loaded');
} catch (error) {
    console.error('❌ [server.js] ERROR loading dashboardRoutes:', error.message);
    throw error;
}
console.log('🔧 [server.js] Loading repositories routes...');
let repositoriesRoutes;
try {
    repositoriesRoutes = require('./routes/repositories/index');
    console.log('🔧 [server.js] repositoriesRoutes loaded, type:', typeof repositoriesRoutes);
    if (!repositoriesRoutes) {
        console.error('❌ [server.js] repositoriesRoutes is null/undefined!');
    }
    if (typeof repositoriesRoutes !== 'function') {
        console.error('❌ [server.js] repositoriesRoutes is not a function! It is:', typeof repositoriesRoutes);
        console.error('❌ [server.js] repositoriesRoutes value:', repositoriesRoutes);
    }
} catch (error) {
    console.error('❌ [server.js] ERROR loading repositoriesRoutes:', error.message);
    console.error('❌ [server.js] Error stack:', error.stack);
    throw error;
}
const backupRoutes = require('./routes/backup');
debugLog('🔧 [server.js] backupRoutes loaded');
const archivesRoutes = require('./routes/archives');
const restoreRoutes = require('./routes/restore');
const configRoutes = require('./routes/config');
const appriseRoutes = require('./routes/apprise');
const ntfyRoutes = require('./routes/ntfy');
const notificationRoutingRoutes = require('./routes/notification-routing');
const directorNotificationsRoutes = require('./routes/director-notifications');
const encryptionRoutes = require('./routes/encryption');
const passwordRoutes = require('./routes/passwords');
const borgmaticRoutes = require('./routes/borgmatic');
const scheduleRoutes = require('./routes/schedule');
const logsRoutes = require('./routes/logs');
const settingsRoutes = require('./routes/settings');
const eventsRoutes = require('./routes/events');
const sshKeysRoutes = require('./routes/ssh-keys');
const configParserRoutes = require('./routes/config-parser');
const backupsRoutes = require('./routes/backups');
const backupExecutorRoutes = require('./routes/backup-executor');
const yamlEditorRoutes = require('./routes/yaml-editor');
const identityRoutes = require('./routes/identity');
const directorRoutes = require('./routes/director');
const templatesRoutes = require('./routes/templates');
const deploymentsRoutes = require('./routes/deployments');
const systemConfigRoutes = require('./routes/system-config');
const notificationsRoutes = require('./routes/notifications');
const vaultRoutes = require('./routes/vault');
const databaseDiscoveryRoutes = require('./routes/database-discovery');
const filesystemRoutes = require('./routes/filesystem');
const scriptsRoutes = require('./routes/scripts');
const configExportRoutes = require('./routes/config-export');
const gitReposRoutes = require('./routes/git-repos');
const gitRestoreRoutes = require('./routes/git-restore');
const { eventManager } = require('./routes/events');
const monitoringIntegration = require('./services/monitoring-integration');

// Routes
console.log('🔧 [server.js] Mounting routes...');
try {
    app.use('/api/auth', authRoutes);
    console.log('🔧 [server.js] Mounted /api/auth');
} catch (error) {
    console.error('❌ [server.js] ERROR mounting /api/auth:', error.message);
    throw error;
}
try {
    app.use('/api/dashboard', dashboardRoutes);
    console.log('🔧 [server.js] Mounted /api/dashboard');
} catch (error) {
    console.error('❌ [server.js] ERROR mounting /api/dashboard:', error.message);
    throw error;
}
console.log('🔧 [server.js] Mounting /api/repositories...');
console.log('🔧 [server.js] repositoriesRoutes type before mounting:', typeof repositoriesRoutes);

// Add request logging middleware for /api/repositories
app.use('/api/repositories', (req, res, next) => {
    console.log('🔍 [server.js] Request to /api/repositories:', req.method, req.path, req.url);
    next();
});

try {
    app.use('/api/repositories', repositoriesRoutes);
    console.log('🔧 [server.js] Mounted /api/repositories successfully');
} catch (error) {
    console.error('❌ [server.js] ERROR mounting /api/repositories:', error.message);
    console.error('❌ [server.js] Error stack:', error.stack);
    throw error;
}
app.use('/api/backup', backupRoutes);
debugLog('🔧 [server.js] Mounted /api/backup');
app.use('/api/archives', archivesRoutes);
app.use('/api/restore', restoreRoutes);
app.use('/api/config', configRoutes);
app.use('/api/apprise', appriseRoutes);
app.use('/api/ntfy', ntfyRoutes);
app.use('/api/notification-routing', notificationRoutingRoutes);
app.use('/api/director-notifications', directorNotificationsRoutes);
app.use('/api/encryption', encryptionRoutes);
app.use('/api/passwords', passwordRoutes);
app.use('/api/borgmatic', borgmaticRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/ssh-keys', sshKeysRoutes);
app.use('/api/config-parser', configParserRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/backups', backupExecutorRoutes);
app.use('/api/yaml-editor', yamlEditorRoutes);
app.use('/api/identity', identityRoutes);
app.use('/api/director', directorRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/deployments', deploymentsRoutes);
app.use('/api/system-config', systemConfigRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/database-discovery', databaseDiscoveryRoutes);
app.use('/api/filesystem', filesystemRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/config-export', configExportRoutes);
app.use('/api/git-repos', gitReposRoutes);
app.use('/api/restore/git', gitRestoreRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: getAppVersion(),
        backend: 'nodejs'
    });
});

// Serve static files in production
if (config.nodeEnv === 'production') {
    const frontendBuildPath = path.join(__dirname, '../public');

    // Serve static files from React build
    app.use(express.static(frontendBuildPath));

    // Handle React routing - return index.html for all non-API routes
    app.get('*', (req, res) => {
        // Don't serve index.html for API routes
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'API endpoint not found' });
        }

        // Serve index.html for all other routes (React Router)
        res.sendFile(path.join(frontendBuildPath, 'index.html'));
    });
} else {
    // Development mode - serve simple status page
    app.get('/', (req, res) => {
        res.send(`
            <html>
                <head><title>Borgmatic UI - Development</title></head>
                <body>
                    <h1>🚀 Borgmatic UI Backend</h1>
                    <p>Backend is running in development mode.</p>
                    <p>Frontend should be running on <a href="http://localhost:5173">http://localhost:5173</a></p>
                    <p>API available at <a href="/api/health">/api/health</a></p>
                </body>
            </html>
        `);
    });
}

// Initialize admin user on startup
async function initializeApp() {
    try {
        console.log('🔐 Initializing authentication system...');
        await authService.createFirstUser();
        console.log('✅ Authentication system ready');
    } catch (error) {
        console.error('❌ Failed to initialize authentication:', error.message);
    }
}

// Start server
async function startServer() {
    console.log(`🚀 Borgmatic UI Server starting...`);
    console.log(`📁 Working directory: ${process.cwd()}`);
    console.log(`🔧 Environment: ${config.nodeEnv}`);

    // Initialize admin user
    await initializeApp();

    // Initialize configuration manager
    try {
        const configManager = require('./services/config-manager');
        await configManager.initialize();
        console.log('⚙️  Configuration manager initialized');
    } catch (error) {
        console.warn('⚠️ Configuration manager initialization warning:', error.message);
    }

    // Note: SSL certificate auto-generation used to happen unconditionally here
    // for *every* mode (client / standalone / director), which was wrong:
    //   • It spammed self-signed PEMs into the data dir for modes that never
    //     terminate TLS themselves.
    //   • cert-manager.updateConfig() writes DIRECTOR_SSL_ENABLED=true back into
    //     `.env`, which would silently flip non-director instances into a
    //     half-configured "SSL enabled but I'm not the director" state.
    // Cert initialization now happens once, in the director-mode branch below,
    // gated on DIRECTOR_TRUST_PROXY=false. Nothing else needs to pre-warm.

    // Initialize log manager
    try {
        const logManager = require('./services/log-manager');
        await logManager.initialize();
        console.log('📝 Log manager initialized');
    } catch (error) {
        console.error('❌ Failed to initialize log manager:', error.message);
    }

    // Initialize identity manager
    try {
        const identityManager = require('./services/identity-manager');
        await identityManager.initialize();
    } catch (error) {
        console.warn('⚠️ Identity manager initialization warning:', error.message);
    }

    // Initialize template manager
    try {
        const templateManager = require('./services/template-manager');
        await templateManager.initialize();

        // Initialize system templates (SpeedBits Standard, etc.)
        if (templateManager.initializeSystemTemplates) {
            await templateManager.initializeSystemTemplates();
        }
    } catch (error) {
        console.warn('⚠️ Template manager initialization warning:', error.message);
    }

    // Reconcile backups stuck in "running" after a restart/crash
    try {
        const backupManager = require('./services/backup-manager');
        await backupManager.reconcileStaleRunningBackups();
    } catch (error) {
        console.warn('⚠️ Backup metadata reconciliation warning:', error.message);
    }

    // Bring sshfs hooks of existing jobs up to date. Hook scripts are frozen
    // into each job's YAML at save time, so shipping a fix to the generator
    // does not reach jobs that already exist. No-op once applied.
    try {
        const { migrateSshfsHooks } = require('./services/migrations/sshfs-hook-migration');
        await migrateSshfsHooks();
    } catch (error) {
        console.warn('⚠️ sshfs hook migration warning:', error.message);
    }

    // Initialize schedule manager (restores cron jobs for active backups)
    try {
        const scheduleManager = require('./services/schedule-manager');
        await scheduleManager.initialize();
    } catch (error) {
        console.error('❌ Failed to initialize schedule manager:', error.message);
    }

    // Initialize database discovery service
    try {
        const databaseDiscovery = require('./services/database-discovery');
        await databaseDiscovery.initialize();
    } catch (error) {
        console.warn('⚠️ Database discovery initialization warning:', error.message);
    }

    // Initialize deployment manager
    try {
        const deploymentManager = require('./services/deployment-manager');
        await deploymentManager.initialize();
    } catch (error) {
        console.warn('⚠️ Deployment manager initialization warning:', error.message);
    }

    // Start background tasks for real-time events
    try {
        eventManager.startBackgroundTasks();
        console.log('📡 Started real-time event monitoring');
    } catch (error) {
        console.error('❌ Failed to start event monitoring:', error.message);
    }

    // Initialize monitoring integration
    try {
        await monitoringIntegration.initialize();
        console.log('🔔 Monitoring integration ready');
    } catch (error) {
        console.error('❌ Failed to initialize monitoring integration:', error.message);
    }

    // Check if we need SSL (for Director mode)
    // Check mode.json first (more reliable than identity which may not exist yet)
    const fs = require('fs-extra');
    const modeFile = path.join(config.dataDir, 'mode.json');
    let directorMode = false;

    if (await fs.pathExists(modeFile)) {
        try {
            const modeData = await fs.readJson(modeFile);
            directorMode = (modeData.mode === 'director');
            console.log(`📋 Detected mode from config: ${modeData.mode}`);
        } catch (err) {
            console.warn('⚠️  Could not read mode.json:', err.message);
        }
    }

    let useSSL = false;
    let httpServer;

    if (directorMode && config.director.trustProxy) {
        // Operator has explicitly delegated TLS termination to an upstream
        // reverse proxy. Run plain HTTP locally and DO NOT overwrite
        // DIRECTOR_SSL_ENABLED in the .env file — that flag is now controlled
        // by the operator, not by us. The proxy must also forward Socket.IO
        // upgrade traffic (see the comment on config.director.trustProxy).
        console.log('🔁 DIRECTOR_TRUST_PROXY=true — TLS terminated by upstream reverse proxy');
        console.log(`   Director will listen on plain HTTP on port ${PORT}`);
        console.log(`   X-Forwarded-* headers will be honored (trust proxy enabled)`);
        console.log(`   Make sure your proxy forwards WebSocket upgrade headers for Socket.IO`);
    } else if (directorMode) {
        // Auto-generate SSL certificates if missing
        const certManager = require('./services/cert-manager');
        const certResult = await certManager.initialize();

        if (certResult.success) {
            if (certResult.generated) {
                console.log('🔐 Self-signed SSL certificates generated');
                console.log(`📁 Certificate: ${certManager.certFile}`);
                console.log(`🔑 Private Key: ${certManager.keyFile}`);
                console.log('💡 For production, replace with proper SSL certificates');
                console.log('💡 To terminate TLS at an upstream nginx/Traefik/Caddy instead,');
                console.log('   set DIRECTOR_TRUST_PROXY=true and remove this self-signed cert.');
            }

            // Update .env to enable SSL
            const configManager = require('./services/config-manager');
            await configManager.updateEnv({
                DIRECTOR_SSL_ENABLED: 'true',
                DIRECTOR_SSL_CERT: certManager.certFile,
                DIRECTOR_SSL_KEY: certManager.keyFile
            });

            useSSL = true;
            console.log('✅ SSL enabled for Director mode');
        } else {
            console.warn('⚠️  SSL certificate initialization failed, falling back to HTTP');
        }
    }

    // Create HTTP or HTTPS server based on SSL availability
    if (useSSL) {
        const https = require('https');
        const certManager = require('./services/cert-manager');

        const httpsOptions = {
            key: fs.readFileSync(certManager.keyFile),
            cert: fs.readFileSync(certManager.certFile)
        };

        httpServer = https.createServer(httpsOptions, app);
        httpServer.listen(PORT, async () => {
            console.log(`🔒 HTTPS Server running on port ${PORT}`);
            console.log(`🔗 Access: https://localhost:${PORT}`);

            // Deploy any missing SSH keys from vault to filesystem
            await deployMissingSSHKeys();

            // Check for locked repositories on startup (non-blocking)
            checkLockedRepositoriesOnStartup().catch(err => {
                console.warn('⚠️ Failed to check for locked repositories:', err.message);
            });

            // Initialize Redis cache (optional - for Borg 1.x archive browsing)
            initRedis();

            // Initialize Director services after server starts
            await initializeDirectorServices(httpServer);
        });
    } else {
        httpServer = app.listen(PORT, async () => {
            console.log(`🌐 HTTP Server running on port ${PORT}`);
            console.log(`🔗 Access: http://localhost:${PORT}`);

            // Deploy any missing SSH keys from vault to filesystem
            await deployMissingSSHKeys();

            // Check for locked repositories on startup (non-blocking)
            checkLockedRepositoriesOnStartup().catch(err => {
                console.warn('⚠️ Failed to check for locked repositories:', err.message);
            });

            // Initialize Redis cache (optional - for Borg 1.x archive browsing)
            initRedis();

            // Initialize Director services after server starts
            await initializeDirectorServices(httpServer);
        });
    }
}

/**
 * Deploy missing SSH keys from vault to filesystem
 * Only deploys keys for repositories that currently exist
 */
async function deployMissingSSHKeys() {
    try {
        const fs = require('fs-extra');
        const configParser = require('./services/config-parser');
        const sshKeysAPI = require('./services/ssh-keys');

        console.log('🔑 Checking for missing SSH keys...');

        // Get all repositories
        const repositories = await configParser.getAllRepositoriesWithUsage();

        // Filter to SSH repositories with ssh_key_id
        const sshRepos = repositories.filter(repo =>
            repo.path?.startsWith('ssh://') && repo.ssh_key_id
        );

        if (sshRepos.length === 0) {
            console.log('🔑 No SSH repositories with keys to check');
            return;
        }

        // SSH keys directory
        const sshKeysDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
        await fs.ensureDir(sshKeysDir);
        await fs.chmod(sshKeysDir, 0o700);

        let deployedCount = 0;

        for (const repo of sshRepos) {
            try {
                // Check if key file exists
                const keyFilename = `borgmatic_key_${repo.ssh_key_id}`;
                const keyPath = path.join(sshKeysDir, keyFilename);

                if (await fs.pathExists(keyPath)) {
                    // Key already exists
                    continue;
                }

                // Key missing - deploy from vault
                console.log(`🔑 Deploying missing SSH key for: ${repo.name || repo.path}`);

                const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
                if (!sshKey || !sshKey.private_key) {
                    console.warn(`⚠️  SSH key ${repo.ssh_key_id} not found in vault for repo: ${repo.name || repo.path}`);
                    continue;
                }

                // Write key to filesystem
                await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });
                console.log(`✅ Deployed SSH key: ${keyPath}`);
                deployedCount++;
            } catch (repoError) {
                console.warn(`⚠️  Failed to deploy SSH key for ${repo.name || repo.path}: ${repoError.message}`);
            }
        }

        if (deployedCount > 0) {
            console.log(`🔑 Deployed ${deployedCount} missing SSH key(s)`);
        } else {
            console.log('🔑 All SSH keys are present');
        }
    } catch (error) {
        console.error('❌ Failed to check/deploy SSH keys:', error.message);
        // Non-fatal - continue startup
    }
}

/**
 * Check for locked repositories on startup
 * Logs warnings about any repositories that appear to be locked
 * This helps surface stale lock issues early
 */
async function checkLockedRepositoriesOnStartup() {
    try {
        console.log('🔒 Checking for locked repositories...');
        
        const configParser = require('./services/config-parser');
        const repositories = await configParser.getAllRepositoriesWithUsage();
        
        // Filter to repositories that are actually in use and configured
        const activeRepos = repositories.filter(repo => 
            repo.path && repo.used_by && repo.used_by.length > 0
        );
        
        if (activeRepos.length === 0) {
            console.log('🔒 No active repositories to check');
            return;
        }
        
        // Note: is_locked is populated by the repository list endpoint, not by config-parser directly
        // For startup check, we do a quick check using borg info
        const { getBorgCommand } = require('./services/borg-version-detector');
        const { execa } = require('execa');
        const passwordManager = require('./services/password-manager');
        
        let lockedCount = 0;
        
        for (const repo of activeRepos.slice(0, 5)) { // Check first 5 repos max to avoid slow startup
            try {
                // Set up environment with passphrase
                const env = { ...process.env };
                try {
                    const passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
                    if (passphrase) {
                        env.BORG_PASSPHRASE = passphrase;
                    }
                } catch (e) {
                    // Continue without passphrase - might work for unencrypted repos
                }
                
                const borgVersion = repo.borg_version || '1.x';
                const { command, args } = getBorgCommand(borgVersion, 'info', {
                    repoPath: repo.path,
                    extraArgs: ['--lock-wait=1'], // Fail fast if locked
                    remotePath: repo.hetzner_borg_version,
                });
                
                const isRemoteRepo = repo.path.includes('ssh://') || repo.path.includes('@');
                
                const result = await execa(command, args, {
                    env,
                    timeout: isRemoteRepo ? 15000 : 5000, // Quick check
                    reject: false
                });
                
                // Check if this looks like a lock error
                if (result.stderr && (
                        result.stderr.includes('Failed to create/acquire the lock') ||
                        result.stderr.includes('LockTimeout') ||
                        result.stderr.includes('Repository is already locked')
                    ) && !result.stderr.toLowerCase().includes('permission denied')) {
                    lockedCount++;
                    const repoLabel = repo.label || repo.name || repo.path;
                    console.warn(`⚠️  LOCKED: Repository "${repoLabel}" appears to be locked`);
                    console.warn(`   This may cause backup failures. Use "Break Lock" in the Repositories page to resolve.`);
                    
                    // Send notification about locked repository
                    try {
                        const notificationRouter = require('./services/notification-router');
                        await notificationRouter.notifyBackupWarning(
                            'System Startup',
                            repo.path,
                            `Repository "${repoLabel}" is locked - backups may fail`
                        );
                    } catch (notifyErr) {
                        console.warn('Could not send lock notification:', notifyErr.message);
                    }
                }
            } catch (err) {
                // Timeout or other error - skip this repo
                if (err.killed || err.timedOut) {
                    console.warn(`⏱️  Timeout checking repository: ${repo.label || repo.path}`);
                }
            }
        }
        
        if (lockedCount === 0) {
            console.log('🔒 No locked repositories detected');
        } else {
            console.warn(`🔒 Found ${lockedCount} locked repository(ies) - check Repositories page`);
            
            // Send summary notification if multiple repos are locked
            if (lockedCount > 1) {
                try {
                    const notificationRouter = require('./services/notification-router');
                    await notificationRouter.notifyBackupWarning(
                        'System Startup',
                        null,
                        `${lockedCount} repositories are locked - backups may fail until locks are cleared`
                    );
                } catch (notifyErr) {
                    console.warn('Could not send lock summary notification:', notifyErr.message);
                }
            }
        }
    } catch (error) {
        console.warn('⚠️ Could not check for locked repositories:', error.message);
        // Non-fatal - continue startup
    }
}

/**
 * Initialize Director-related services
 */
async function initializeDirectorServices(httpServer) {
    try {
        // EDITION_CHECK_INJECTED: Check edition before initializing Director services
        const editionInfo = (() => {
            try {
                return require('./.edition');
            } catch (e) {
                const { getEditionInfo } = require('./utils/edition');
                return getEditionInfo();
            }
        })();
        const identityManager = require('./services/identity-manager');
        let identity = await identityManager.getIdentity();

        // If identity is missing but mode.json exists, regenerate it (crash recovery)
        if (!identity) {
            const fs = require('fs-extra');
            const modeFile = path.join(config.dataDir, 'mode.json');

            if (await fs.pathExists(modeFile)) {
                try {
                    const modeData = await fs.readJson(modeFile);
                    console.log('⚠️  Identity missing but mode configured - regenerating...');
                    identity = await identityManager.generateIdentity(modeData.mode);
                    console.log('✅ Identity regenerated for:', modeData.mode);
                } catch (err) {
                    console.error('Failed to regenerate identity:', err.message);
                    console.log('⏭️ Skipping Director services');
                    return;
                }
            } else {
                console.log('⏭️ No identity or mode configured - skipping Director services');
                return;
            }
        }

        // Initialize Director Server (if in director mode)
        if (identity.mode === 'director') {
            if (!editionInfo.features.includes('director')) {
                console.error('❌ Director mode is not available in Community edition');
                console.error('   Upgrade to Commercial edition at https://www.speedbits.io');
                console.log('⏭️  Skipping Director server initialization');
            } else {
                // Try to load director-server (may be missing in Commercial builds before Infinity Tools injection)
                let directorServer;
                try {
                    directorServer = require('./services/director-server');
                } catch (error) {
                    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('director-server')) {
                        console.error('');
                        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        console.error('❌ CRITICAL ERROR: Missing director-server.js');
                        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        console.error('');
                        console.error('This is a Commercial edition that requires Infinity Tools deployment.');
                        console.error('');
                        console.error('The critical file services/director-server.js is missing.');
                        console.error('This file must be injected by Infinity Tools during setup.');
                        console.error('');
                        console.error('📝 Infinity Tools should:');
                        console.error('   1. Copy director-server.js to: /app/services/director-server.js');
                        console.error('   2. Restart this container');
                        console.error('');
                        console.error('⚠️  This container cannot start in Director mode without this file.');
                        console.error('   You can use Standalone or Client mode instead.');
                        console.error('');
                        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        console.error('');
                        process.exit(1);
                    }
                    // Re-throw other errors
                    throw error;
                }

                await directorServer.initialize(httpServer);
            }
        }

        // Initialize Director Client (if in client mode with Director configured)
        if (identity.mode === 'client') {
            if (!editionInfo.features.includes('client')) {
                console.error('❌ Client mode is not available in this edition');
                console.log('⏭️  Skipping Director client initialization');
                return;
            }
            console.log('🔧 CLIENT MODE: Initializing Director client and command handlers');
            const directorClient = require('./services/director-client');

            // Register basic command handlers
            console.log('📝 CLIENT MODE: Registering command handlers');
            registerClientCommandHandlers(directorClient);

            // Connect to Director
            console.log('🔌 CLIENT MODE: Connecting to Director');
            await directorClient.connect();
        } else {
            console.log(`ℹ️  Mode: ${identity.mode} - Director client not initialized`);
        }
    } catch (error) {
        console.error('❌ Failed to initialize Director services:', error.message);
    }
}

/**
 * Register command handlers for client mode
 */
function registerClientCommandHandlers(directorClient) {
    console.log('🔧 Registering client command handlers...');

    // Backup operations
    directorClient.registerCommandHandler('backup:run', async (params) => {
        const backupExecutor = require('./services/backup-executor');
        const { backup_id } = params;
        return await backupExecutor.runBackup(backup_id);
    });

    directorClient.registerCommandHandler('backup:create', async (params) => {
        const configParser = require('./services/config-parser');
        // TODO: Implement backup creation
        return { success: true, message: 'Not implemented yet' };
    });

    // Repository operations
    directorClient.registerCommandHandler('repo:create', async (params) => {
        // TODO: Implement repo creation
        return { success: true, message: 'Not implemented yet' };
    });

    // Repository initialization with passphrase
    directorClient.registerCommandHandler('repo:init', async (params) => {
        const { repositories, ssh_keys, template } = params;
        const { spawn } = require('child_process');
        const path = require('path');
        const fs = require('fs-extra');
        const os = require('os');

        const results = [];

        // Deploy SSH keys if provided
        if (ssh_keys && Array.isArray(ssh_keys)) {
            for (const sshKey of ssh_keys) {
                try {
                    const sshDir = path.join(os.homedir(), '.ssh');
                    await fs.ensureDir(sshDir);
                    const keyPath = path.join(sshDir, sshKey.name || `borgmatic_${Date.now()}`);
                    await fs.writeFile(keyPath, sshKey.private_key, { mode: 0o600 });
                    console.log(`✅ SSH key deployed: ${keyPath}`);
                } catch (error) {
                    console.error(`Failed to deploy SSH key:`, error.message);
                }
            }
        }

        // Initialize each repository
        if (repositories && Array.isArray(repositories)) {
            const templateManager = require('./services/template-manager');
            const identityManager = require('./services/identity-manager');

            // Get client identity for variable expansion
            const identity = await identityManager.getIdentity();
            const clientId = identity?.client_id || 'unknown';

            for (const repo of repositories) {
                let repoPath = '';
                try {
                    // Expand path pattern with all variables
                    repoPath = templateManager.expandPathPattern(
                        repo.path || repo.path_pattern || '',
                        { client_id: clientId }
                    );

                    if (!repoPath) {
                        throw new Error('Repository path is empty');
                    }

                    // Ensure directory exists for local repos
                    if (repo.repository_type === 'local' || !repo.repository_type) {
                        const dir = path.dirname(repoPath);
                        await fs.ensureDir(dir);
                    }

                    // Initialize repository with Borg 2.0 syntax using spawn (safer than exec)
                    // Borg 2.0: Use new AEAD encryption mode
                    const encryption = repo.encryption || 'repokey-blake2-aes-ocb';

                    console.log(`📦 Initializing repository: ${repoPath}`);

                    await new Promise((resolve, reject) => {
                        // Borg 2.0: repository is specified via -r/--repo (global option)
                        // Quick Start: borg -r /path/to/repo repo-create --encryption=...
                        const borgInit = spawn('borg', ['-r', repoPath, 'repo-create', `--encryption=${encryption}`], {
                            env: {
                                ...process.env,
                                BORG_PASSPHRASE: repo.passphrase || ''
                            }
                        });

                        let stderr = '';
                        let stdout = '';
                        let isTimedOut = false;

                        // Set up timeout
                        const timeoutHandle = setTimeout(() => {
                            isTimedOut = true;
                            borgInit.kill('SIGTERM');
                            reject(new Error('Repository initialization timed out after 30 seconds'));
                        }, 30000);

                        borgInit.stderr.on('data', (data) => {
                            stderr += data.toString();
                        });

                        borgInit.stdout.on('data', (data) => {
                            stdout += data.toString();
                        });

                        borgInit.on('close', (code) => {
                            clearTimeout(timeoutHandle);
                            if (isTimedOut) return; // Already rejected

                            if (code === 0) {
                                resolve();
                            } else {
                                // Check if repository already exists
                                if (stderr.includes('already exists') || stderr.includes('A repository already exists')) {
                                    console.log(`Repository ${repoPath} already exists, skipping init`);
                                    resolve(); // Treat as success
                                } else {
                                    reject(new Error(stderr || stdout || `borg repo-create exited with code ${code}`));
                                }
                            }
                        });

                        borgInit.on('error', (err) => {
                            clearTimeout(timeoutHandle);
                            if (!isTimedOut) {
                                reject(err);
                            }
                        });
                    });

                    results.push({
                        path: repoPath,
                        name: repo.name,
                        status: 'success',
                        message: 'Repository initialized successfully'
                    });

                    console.log(`✅ Repository initialized: ${repoPath}`);
                } catch (error) {
                    results.push({
                        path: repoPath || repo.path || 'unknown',
                        name: repo.name,
                        status: 'failed',
                        message: error.message
                    });
                    console.error(`Failed to initialize repository ${repoPath || repo.path}:`, error.message);
                }
            }
        }

        return {
            success: results.length > 0 && results.some(r => r.status === 'success'),
            results: results,
            message: results.length > 0
                ? `Initialized ${results.filter(r => r.status === 'success').length}/${results.length} repositories`
                : 'No repositories to initialize'
        };
    });

    // Configuration operations
    directorClient.registerCommandHandler('config:update', async (params) => {
        // TODO: Implement config update
        return { success: true, message: 'Not implemented yet' };
    });

    // Get authService reference for token generation (must be at module level)
    const authServiceModule = require('./services/auth');

    // API Proxy - forwards HTTP requests from Director to local API.
    // Returns { status, headers, body, isBase64 } so the director-side middleware can
    // faithfully replay the response with the original content-type. Binary responses are
    // base64-encoded so they survive socket.io's JSON serialization.
    directorClient.registerCommandHandler('api:proxy', async (params) => {
        const http = require('http');
        const { method, path, body, headers } = params;

        console.log(`📥 CLIENT: Received api:proxy command - ${method} ${path}`);

        return new Promise((resolve) => {
            try {
                // Director's JWT secret is not ours — mint a local one tied to admin.
                debugLog(`🔐 CLIENT: Generating local token for tunneled request`);
                const localToken = authServiceModule.createAccessToken({ sub: 'admin' });
                debugLog(`✅ CLIENT: Local token generated`);

                // Forward a curated subset of headers from the original request. We must NOT
                // forward the director's Authorization header (different JWT secret) and we
                // must NOT forward host/connection/content-length (computed by node http).
                const HOP_BY_HOP = new Set([
                    'authorization', 'host', 'connection', 'content-length', 'cookie',
                    'transfer-encoding', 'keep-alive', 'upgrade', 'x-remote-client-id',
                    'x-internal-proxy', 'x-api-key'
                ]);
                const forwardHeaders = {};
                for (const [k, v] of Object.entries(headers || {})) {
                    if (!HOP_BY_HOP.has(k.toLowerCase())) forwardHeaders[k] = v;
                }
                forwardHeaders['authorization'] = `Bearer ${localToken}`;
                forwardHeaders['content-type'] = forwardHeaders['content-type'] || (headers?.['content-type']) || 'application/json';
                forwardHeaders['x-internal-proxy'] = 'true';

                const options = {
                    hostname: '127.0.0.1',
                    port: config.port,
                    path: path,
                    method: method,
                    headers: forwardHeaders
                };

                console.log(`🔄 CLIENT: Tunneling local API call to port ${config.port}: ${method} ${path}`);

                const req = http.request(options, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        try {
                            const buf = Buffer.concat(chunks);
                            const ct = String(res.headers['content-type'] || '').toLowerCase();
                            // Treat anything that isn't text/json/xml/form as binary so we can
                            // safely round-trip through socket.io's JSON channel.
                            const isText = /^(text\/|application\/(json|xml|x-www-form-urlencoded|javascript)|application\/.+\+(json|xml))/.test(ct);
                            const body = isText ? buf.toString('utf8') : buf.toString('base64');
                            console.log(`✅ Proxied: ${method} ${path} -> ${res.statusCode} (${isText ? 'text' : 'binary'})`);
                            resolve({
                                status: res.statusCode,
                                headers: res.headers,
                                body,
                                isBase64: !isText
                            });
                        } catch (err) {
                            console.error('Failed to assemble proxy response:', err.message);
                            resolve({
                                status: 500,
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ success: false, detail: `Proxy assembly error: ${err.message}` }),
                                isBase64: false
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('API proxy error:', error.message);
                    resolve({
                        status: 500,
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ success: false, detail: `Local API error: ${error.message}` }),
                        isBase64: false
                    });
                });

                if (body && method !== 'GET' && method !== 'HEAD') {
                    req.write(typeof body === 'string' ? body : JSON.stringify(body));
                }
                req.end();
            } catch (error) {
                console.error('API proxy setup error:', error.message);
                resolve({
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ success: false, detail: `API proxy error: ${error.message}` }),
                    isBase64: false
                });
            }
        });
    });

    console.log('✅ Client command handlers registered');
}

// Start the server
startServer();

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log(`🛑 Already shutting down, ignoring ${signal}`);
        return;
    }
    isShuttingDown = true;
    
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    // Stop all running backups to prevent stale locks
    try {
        const backupExecutor = require('./services/backup-executor');
        const runningBackups = backupExecutor.getRunningBackups();
        
        if (runningBackups.length > 0) {
            console.log(`⏳ Stopping ${runningBackups.length} running backup(s) to prevent stale locks...`);
            
            // Stop all running backups
            for (const runningBackup of runningBackups) {
                const backupId = runningBackup.backup_id;
                try {
                    await backupExecutor.stopBackup(backupId);
                    console.log(`  ✓ Stopped backup: ${backupId}`);
                } catch (err) {
                    console.error(`  ✗ Failed to stop backup ${backupId}:`, err.message);
                }
            }
            
            // Give borgmatic time to clean up locks (max 15 seconds)
            console.log('⏳ Waiting for backup processes to release locks...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    } catch (error) {
        console.error('Error stopping backups during shutdown:', error.message);
    }

    // Cleanup Director client if connected
    try {
        const directorClient = require('./services/director-client');
        directorClient.disconnect();
    } catch (error) {
        // Ignore
    }

    eventManager.cleanup();
    console.log('✓ Shutdown complete');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Error logging configuration and state
const ERROR_LOG_CONFIG = {
    maxSizeMB: 10,           // Max log file size before rotation
    rateLimitMs: 5000,       // Don't log same error within this window
    floodThreshold: 100,     // Exit if this many errors in floodWindowMs
    floodWindowMs: 60000,    // Time window for flood detection (60 seconds)
};

let lastErrorMessage = null;
let lastErrorTime = 0;
let errorCount = 0;
let errorWindowStart = Date.now();

function sanitizeLogString(value) {
    if (!value) return value;
    return String(value)
        // Mask Borg 2.x S3 credentials: s3:ACCESS:SECRET@...
        .replace(/^s3:[^:]+:[^@]+@/i, 's3:***@')
        // Mask URL-encoded variant that can appear in logs: s3%3AACCESS%3ASECRET%40...
        .replace(/s3%3A[^%]+%3A[^%]+%40/gi, 's3%3A***%40')
        // Mask any access_token-style query params if present
        .replace(/([?&](?:access_token|token|jwt)=)[^&]+/gi, '$1***');
}

function writeFatalErrorLog(title, payload) {
    try {
        const now = Date.now();
        const errorMessage = sanitizeLogString(typeof payload === 'string' ? payload : JSON.stringify(payload));
        
        // Rate limiting: skip if same error within rate limit window
        if (lastErrorMessage === errorMessage && (now - lastErrorTime) < ERROR_LOG_CONFIG.rateLimitMs) {
            return; // Skip duplicate error
        }
        lastErrorMessage = errorMessage;
        lastErrorTime = now;
        
        // Flood detection: exit if too many errors too fast
        if (now - errorWindowStart > ERROR_LOG_CONFIG.floodWindowMs) {
            errorCount = 0;
            errorWindowStart = now;
        }
        errorCount++;
        
        if (errorCount > ERROR_LOG_CONFIG.floodThreshold) {
            console.error(`🚨 FATAL: Error flood detected (${errorCount} errors in ${ERROR_LOG_CONFIG.floodWindowMs / 1000}s) - exiting to prevent log explosion`);
            process.exit(1);
        }
        
        // Use data/logs inside the app directory for container environments
        const logsDir = process.env.LOGS_DIR || config.logsDir || path.join(__dirname, '..', 'data', 'logs');
        const logPath = path.join(logsDir, 'server-errors.log');
        const oldLogPath = logPath + '.old';
        
        fs.mkdirSync(logsDir, { recursive: true });
        
        // Size-based rotation: rotate if file exceeds max size
        try {
            const stats = fs.statSync(logPath);
            if (stats.size > ERROR_LOG_CONFIG.maxSizeMB * 1024 * 1024) {
                if (fs.existsSync(oldLogPath)) {
                    fs.unlinkSync(oldLogPath);
                }
                fs.renameSync(logPath, oldLogPath);
                console.error(`🔄 Rotated server-errors.log (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            }
        } catch (e) {
            // File doesn't exist yet, that's fine
        }
        
        const entry = [
            '============================================================',
            `${new Date().toISOString()} ${title}`,
            typeof payload === 'string' ? errorMessage : sanitizeLogString(JSON.stringify(payload, null, 2)),
            '============================================================',
            ''
        ].join('\n');
        
        fs.appendFileSync(logPath, entry, 'utf8');
        console.error(`📝 Fatal error logged to ${logPath}`);
    } catch (logError) {
        console.error('Failed to write fatal error log:', logError.message);
    }
}

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error?.stack);
    writeFatalErrorLog('Uncaught Exception', {
        message: error?.message,
        stack: error?.stack || String(error)
    });
    
    // Exit after brief delay to allow log write to complete
    // This prevents infinite error loops from causing log explosion
    setTimeout(() => {
        console.error('🛑 Exiting due to uncaught exception');
        try {
            eventManager?.cleanup?.();
        } catch (e) {
            // ignore cleanup errors during fatal shutdown
        }
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    console.error('Stack:', reason?.stack);
    writeFatalErrorLog('Unhandled Rejection', {
        reason: typeof reason === 'string' ? reason : (reason?.message || reason),
        stack: reason?.stack || null
    });
    // Note: Unhandled rejections don't exit - they are logged but allow process to continue
    // This is different from uncaughtException which indicates a more severe issue
});
