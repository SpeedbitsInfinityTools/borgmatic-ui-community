const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isFeatureAvailable } = require('../utils/edition');
const databaseDiscovery = require('../services/database-discovery');

function respondMssqlFeatureGate(res) {
    return res.status(402).json({
        success: false,
        error: 'payment_required',
        detail: 'MS SQL Server backup is only available in the Commercial edition.',
        upgrade_url: 'https://www.speedbits.io',
        feature: 'mssql',
    });
}

/**
 * Build sqlcmd args for MSSQL connections, handling SQL auth, Entra ID Password,
 * and Service Principal authentication methods.
 * @returns {{ args: string[], command: string }}
 */
function buildMssqlSqlcmdArgs({ hostname, port, username, password, container, instance, encrypt, trustServerCert, auth_method, client_id, tenant_id, database_name, query }) {
    const connectHost = hostname || container || 'localhost';
    const mssqlServer = instance
        ? `${connectHost},${port || 1433}\\${instance}`
        : `${connectHost},${port || 1433}`;
    const requestedEncrypt = ['true', 'false', 'strict'].includes(String(encrypt)) ? String(encrypt) : 'true';
    const encryptMode = requestedEncrypt === 'false' ? 'disable' : requestedEncrypt;
    const useTrustServerCert = trustServerCert !== undefined ? !!trustServerCert : true;

    const args = ['-S', mssqlServer];

    const method = auth_method || 'sql';
    if (method === 'ad_password') {
        args.push('--authentication-method', 'ActiveDirectoryPassword');
        args.push('-U', username || '');
        args.push('-P', password || '');
    } else if (method === 'service_principal') {
        args.push('--authentication-method', 'ActiveDirectoryServicePrincipal');
        args.push('-U', client_id || '');
        args.push('-P', password || '');
        args.push('--tenant-id', tenant_id || '');
    } else {
        args.push('-U', username || 'sa');
        args.push('-P', password || '');
    }

    if (database_name && String(database_name).trim()) {
        args.push('-d', String(database_name).trim());
    }
    args.push('-N', encryptMode);
    if (useTrustServerCert) args.push('-C');
    args.push('-b', '-r', '1', '-h', '-1', '-W');
    args.push('-Q', query);

    return { args, command: 'sqlcmd', server: mssqlServer };
}

/**
 * Translate spawn/connection errors into user-friendly messages.
 * Detects missing CLI tools (ENOENT) and suggests installation steps.
 */
function friendlyDbError(error, dbType) {
    const msg = String(error?.message || '');

    if (error?.code === 'ENOENT' || msg.includes('ENOENT')) {
        const toolMap = {
            mssql:      { tool: 'sqlcmd',       pkg: 'go-sqlcmd (https://github.com/microsoft/go-sqlcmd)' },
            postgresql: { tool: 'psql',          pkg: 'postgresql-client' },
            mysql:      { tool: 'mysql',         pkg: 'mysql-client or mariadb-client' },
            mariadb:    { tool: 'mysql',         pkg: 'mariadb-client' },
            mongodb:    { tool: 'mongosh',       pkg: 'mongosh (https://www.mongodb.com/docs/mongodb-shell/)' },
        };
        const info = toolMap[dbType] || { tool: 'database client', pkg: 'the appropriate database client' };
        return `"${info.tool}" is not installed on this system. ` +
               `Install ${info.pkg} and make sure it is on the PATH, then try again. ` +
               `(In the official Docker image this is pre-installed.)`;
    }

    if (/ETIMEOUT|ECONNREFUSED|ENOTFOUND/.test(msg)) {
        return `Cannot reach the database server: ${msg}. Check hostname, port, and firewall rules.`;
    }

    return null;
}

function validateMssqlAuthInput({ auth_method, username, password, client_id, tenant_id }) {
    const method = auth_method || 'sql';
    if (!['sql', 'ad_password', 'service_principal'].includes(method)) {
        throw new Error('Invalid MSSQL auth_method. Allowed: sql, ad_password, service_principal');
    }
    if (method === 'ad_password') {
        if (!String(username || '').trim()) {
            throw new Error('Entra ID Password authentication requires username');
        }
        if (!String(password || '').trim()) {
            throw new Error('Entra ID Password authentication requires password');
        }
    }
    if (method === 'service_principal') {
        if (!String(client_id || '').trim()) {
            throw new Error('Service Principal authentication requires client_id');
        }
        if (!String(tenant_id || '').trim()) {
            throw new Error('Service Principal authentication requires tenant_id');
        }
        if (!String(password || '').trim()) {
            throw new Error('Service Principal authentication requires client_secret');
        }
    }
}

/**
 * @route   GET /api/database-discovery/tool-check/:dbType
 * @desc    Check if required CLI tools for a database type are installed
 * @access  Private
 */
router.get('/tool-check/:dbType', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (req.params.dbType === 'mssql' && !isFeatureAvailable('mssql')) {
            return respondMssqlFeatureGate(res);
        }
        const { checkDbTools } = require('../utils/db-tool-check');
        const result = checkDbTools(req.params.dbType);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route   GET /api/database-discovery/scan
 * @desc    Run database discovery scan
 * @access  Private (Available in both Director and Client modes)
 */
router.get('/scan', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Support both single network and multiple networks
        let networks = ['borgmatic-db'];
        if (req.query.networks) {
            // Handle array from query string (networks[]=net1&networks[]=net2) or comma-separated
            networks = Array.isArray(req.query.networks) 
                ? req.query.networks 
                : req.query.networks.split(',');
        } else if (req.query.network) {
            networks = [req.query.network];
        }

        const options = {
            networks: networks,
            includeHost: req.query.includeHost === 'true',
            includeStopped: req.query.includeStopped === 'true',
            forceRefresh: req.query.forceRefresh === 'true',
            types: req.query.types ? req.query.types.split(',') : undefined
        };

        const result = await databaseDiscovery.discoverDatabases(options);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Database discovery scan failed:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to scan databases'
        });
    }
});

/**
 * @route   GET /api/database-discovery/results
 * @desc    Get cached discovery results
 * @access  Private (Available in both Director and Client modes)
 */
router.get('/results', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const cached = await databaseDiscovery.getCachedDiscovery();

        if (!cached) {
            return res.json({
                success: true,
                data: null,
                message: 'No cached results. Run a scan first.'
            });
        }

        res.json({
            success: true,
            data: cached
        });
    } catch (error) {
        console.error('Failed to get cached results:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get cached results'
        });
    }
});

/**
 * @route   GET /api/database-discovery/count
 * @desc    Get database count
 * @access  Private (Available in both Director and Client modes)
 */
router.get('/count', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const options = {
            network: req.query.network || 'borgmatic-db',
            includeStopped: req.query.includeStopped === 'true'
        };

        const result = await databaseDiscovery.getCount(options);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Failed to get database count:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get database count'
        });
    }
});

/**
 * @route   POST /api/database-discovery/validate
 * @desc    Validate single database connectivity
 * @access  Private (Available in both Director and Client modes)
 */
router.post('/validate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { database } = req.body;

        if (!database) {
            return res.status(400).json({
                success: false,
                detail: 'Database configuration required'
            });
        }

        const isValid = await databaseDiscovery.validateDatabase(database);

        res.json({
            success: true,
            data: {
                valid: isValid,
                database: database
            }
        });
    } catch (error) {
        console.error('Database validation failed:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to validate database'
        });
    }
});

/**
 * @route   POST /api/database-discovery/refresh
 * @desc    Invalidate cache and force refresh
 * @access  Private (Available in both Director and Client modes)
 */
router.post('/refresh', authenticateToken, requireAdmin, async (req, res) => {
    try {
        databaseDiscovery.invalidateCache();

        res.json({
            success: true,
            message: 'Cache invalidated. Run a new scan to refresh.'
        });
    } catch (error) {
        console.error('Failed to refresh cache:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to refresh cache'
        });
    }
});

/**
 * @route   POST /api/database-discovery/generate-config
 * @desc    Generate Borgmatic YAML config for selected databases
 * @access  Private (Available in both Director and Client modes)
 */
router.post('/generate-config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { databases } = req.body;

        if (!Array.isArray(databases)) {
            return res.status(400).json({
                success: false,
                detail: 'Databases array required'
            });
        }

        const yamlConfig = await databaseDiscovery.generateBorgmaticConfig(databases);

        res.json({
            success: true,
            data: {
                config: yamlConfig
            }
        });
    } catch (error) {
        console.error('Failed to generate config:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to generate configuration'
        });
    }
});

/**
 * @route   POST /api/database-discovery/test-connection
 * @desc    Test database server connectivity (supports MSSQL)
 * @access  Private
 */
router.post('/test-connection', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, hostname, port, username, password, container, instance, encrypt, trustServerCert, auth_method, client_id, tenant_id, database_name } = req.body;

        if (!type) {
            return res.status(400).json({
                success: false,
                detail: 'Database type is required'
            });
        }

        if (type !== 'mssql') {
            return res.status(400).json({
                success: false,
                detail: `Test connection currently supports MSSQL only (got '${type}')`
            });
        }
        if (!isFeatureAvailable('mssql')) {
            return respondMssqlFeatureGate(res);
        }
        validateMssqlAuthInput({ auth_method, username, password, client_id, tenant_id });

        const { spawn } = require('child_process');
        const { args, command, server: mssqlServer } = buildMssqlSqlcmdArgs({
            hostname, port, username, password, container, instance, encrypt, trustServerCert,
            auth_method, client_id, tenant_id, database_name,
            query: 'SET NOCOUNT ON; SELECT @@SERVERNAME AS server_name, DB_NAME() AS current_db, 1 AS connection_ok',
        });

        const runSqlcmd = () => new Promise((resolve, reject) => {
            const child = spawn(command, args, { env: { ...process.env } });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('Connection test timed out after 20 seconds.'));
            }, 20000);

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    const detail = (stderr || stdout || '').trim();
                    reject(new Error(detail || `Connection test failed with code ${code}`));
                } else {
                    resolve(stdout.trim());
                }
            });
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });

        let result;
        try {
            result = await runSqlcmd();
        } catch (firstError) {
            if (/timed? ?out|i\/o timeout|ETIMEOUT/i.test(firstError.message)) {
                console.log('MSSQL test connection: first attempt timed out, retrying once…');
                result = await runSqlcmd();
            } else {
                throw firstError;
            }
        }

        res.json({
            success: true,
            data: {
                connected: true,
                type,
                server: mssqlServer,
                output: result
            }
        });
    } catch (error) {
        console.error('MSSQL test connection failed:', error.message);
        const friendly = friendlyDbError(error, 'mssql');
        const isValidationError =
            /requires|Invalid MSSQL auth_method/.test(String(error.message || ''));
        const status = friendly ? 503 : isValidationError ? 400 : 500;
        res.status(status).json({
            success: false,
            detail: friendly || error.message || 'Failed to test MSSQL connection'
        });
    }
});

/**
 * @route   POST /api/database-discovery/list-databases
 * @desc    List individual databases within a database server
 * @access  Private
 */
router.post('/list-databases', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, hostname, port, username, password, container, instance, encrypt, trustServerCert, auth_method, client_id, tenant_id } = req.body;

        if (!type) {
            return res.status(400).json({
                success: false,
                detail: 'Database type is required'
            });
        }
        if (type === 'mssql') {
            if (!isFeatureAvailable('mssql')) {
                return respondMssqlFeatureGate(res);
            }
            validateMssqlAuthInput({ auth_method, username, password, client_id, tenant_id });
        }

        const { spawn } = require('child_process');
        let databases = [];
        let command, args;

        // Build command based on database type
        const connectHost = hostname || container || 'localhost';
        
        switch (type) {
            case 'postgresql':
                // List PostgreSQL databases
                if (container) {
                    command = 'docker';
                    args = ['exec', container, 'psql', '-U', username || 'postgres', '-t', '-c', 'SELECT datname FROM pg_database WHERE datistemplate = false'];
                } else {
                    command = 'psql';
                    args = ['-h', connectHost, '-p', String(port || 5432), '-U', username || 'postgres', '-t', '-c', 'SELECT datname FROM pg_database WHERE datistemplate = false'];
                }
                break;

            case 'mysql':
            case 'mariadb':
                // List MySQL/MariaDB databases
                if (container) {
                    command = 'docker';
                    args = ['exec', container, 'mysql', '-u', username || 'root'];
                    if (password) args.push(`-p${password}`);
                    args.push('-e', 'SHOW DATABASES');
                } else {
                    command = 'mysql';
                    args = ['-h', connectHost, '-P', String(port || 3306), '-u', username || 'root'];
                    if (password) args.push(`-p${password}`);
                    args.push('-e', 'SHOW DATABASES');
                }
                break;

            case 'mongodb':
                // List MongoDB databases
                if (container) {
                    command = 'docker';
                    const mongoUri = username && password 
                        ? `mongodb://${username}:${password}@localhost:27017`
                        : 'mongodb://localhost:27017';
                    args = ['exec', container, 'mongosh', '--quiet', mongoUri, '--eval', 'db.adminCommand("listDatabases").databases.forEach(d => print(d.name))'];
                } else {
                    command = 'mongosh';
                    const mongoUri = username && password 
                        ? `mongodb://${username}:${password}@${connectHost}:${port || 27017}`
                        : `mongodb://${connectHost}:${port || 27017}`;
                    args = ['--quiet', mongoUri, '--eval', 'db.adminCommand("listDatabases").databases.forEach(d => print(d.name))'];
                }
                break;

            case 'mssql': {
                const mssqlQuery = "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND name NOT IN ('master','tempdb','model','msdb')";
                const built = buildMssqlSqlcmdArgs({
                    hostname, port, username, password, container, instance, encrypt, trustServerCert,
                    auth_method, client_id, tenant_id,
                    query: mssqlQuery,
                });
                command = built.command;
                args = built.args;
                break;
            }

            default:
                return res.status(400).json({
                    success: false,
                    detail: `Database type '${type}' does not support listing databases`
                });
        }

        // Execute command
        const result = await new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                env: {
                    ...process.env,
                    PGPASSWORD: password || '',
                    MYSQL_PWD: password || ''
                }
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());
            
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(stderr || `Command failed with code ${code}`));
                } else {
                    resolve(stdout);
                }
            });
            
            child.on('error', (error) => reject(error));
        });

        // Parse output
        const lines = result.trim().split('\n').filter(line => line.trim());
        
        // Filter out system databases and format
        const systemDbs = {
            postgresql: ['postgres', 'template0', 'template1'],
            mysql: ['information_schema', 'mysql', 'performance_schema', 'sys'],
            mariadb: ['information_schema', 'mysql', 'performance_schema', 'sys'],
            mongodb: ['admin', 'config', 'local'],
            mssql: ['master', 'tempdb', 'model', 'msdb']
        };
        
        const systemList = systemDbs[type] || [];
        
        databases = lines
            .map(line => line.trim().replace(/^\|?\s*|\s*\|?$/g, '')) // Clean up MySQL table formatting
            .filter(db => db && !db.startsWith('-') && db !== 'Database' && !systemList.includes(db.toLowerCase()));

        // Add "all" option at the beginning
        databases.unshift('all');

        res.json({
            success: true,
            data: {
                databases,
                type,
                hostname: connectHost,
                systemDatabases: systemList
            }
        });
    } catch (error) {
        console.error('Failed to list databases:', error.message);
        const friendly = friendlyDbError(error, type);
        const isValidationError =
            /requires|Invalid MSSQL auth_method/.test(String(error.message || ''));
        const status = friendly ? 503 : isValidationError ? 400 : 500;
        res.status(status).json({
            success: false,
            detail: friendly || error.message || 'Failed to list databases. Check credentials and connectivity.'
        });
    }
});

/**
 * Helper: Spawn Docker command with proper access method
 * Tries direct Docker access first, falls back to sudo if needed
 */
const { spawn, spawnSync } = require('child_process');

let useDirectDocker = null;

function canAccessDockerDirectly() {
    if (useDirectDocker !== null) return useDirectDocker;
    try {
        const result = spawnSync('docker', ['info'], { 
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        useDirectDocker = result.status === 0;
    } catch (error) {
        useDirectDocker = false;
    }
    return useDirectDocker;
}

function spawnDocker(args) {
    if (canAccessDockerDirectly()) {
        return spawn('docker', args);
    } else {
        return spawn('sudo', ['-n', 'docker', ...args]);
    }
}

/**
 * @route   GET /api/database-discovery/networks
 * @desc    Get available Docker networks and which ones borgmatic is connected to
 * @access  Private
 */
router.get('/networks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get all Docker networks
        const networksPromise = new Promise((resolve, reject) => {
            const child = spawnDocker(['network', 'ls', '--format', '{{.Name}}']);
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());
            
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(stderr || 'Failed to list Docker networks'));
                } else {
                    const networks = stdout.trim().split('\n').filter(n => n && n !== 'none');
                    resolve(networks);
                }
            });
            
            child.on('error', (error) => reject(error));
        });

        // Get networks that the borgmatic-ui container itself is connected to. The
        // container is almost never literally named `borgmatic-ui` — Compose adds a
        // project prefix (`<project>-borgmatic-ui-1`), and the user may name it
        // anything. Best self-detection: read our own container ID from
        // /etc/hostname (Docker sets this to the short container ID) and inspect
        // that. Fall back to a name-pattern scan, then to the literal name.
        const fsExtra = require('fs-extra');
        const connectedPromise = (async () => {
            const tryInspect = (id) => new Promise((resolve) => {
                const child = spawnDocker(['inspect', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', id]);
                let stdout = '';
                child.stdout.on('data', (data) => stdout += data.toString());
                child.on('close', (code) => {
                    if (code === 0 && stdout.trim()) {
                        resolve(stdout.trim().split(/\s+/).filter(Boolean));
                    } else {
                        resolve(null);
                    }
                });
                child.on('error', () => resolve(null));
            });

            // 1) Self via /etc/hostname (only works when we're running inside Docker).
            try {
                const hostnameFile = await fsExtra.readFile('/etc/hostname', 'utf8');
                const selfId = hostnameFile.trim();
                if (selfId) {
                    const nets = await tryInspect(selfId);
                    if (nets) return nets;
                }
            } catch (_) { /* not in a container or /etc/hostname unreadable */ }

            // 2) By image: any running container whose image name contains
            //    `borgmatic-ui` or `infinity-tools-borgmatic` is plausibly us.
            const byImage = await new Promise((resolve) => {
                const child = spawnDocker(['ps', '--format', '{{.Names}}\t{{.Image}}']);
                let stdout = '';
                child.stdout.on('data', (data) => stdout += data.toString());
                child.on('close', (code) => {
                    if (code !== 0) return resolve(null);
                    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
                    const match = lines.find(l => /borgmatic-ui|infinity-tools-borgmatic/i.test(l));
                    resolve(match ? match.split('\t')[0] : null);
                });
                child.on('error', () => resolve(null));
            });
            if (byImage) {
                const nets = await tryInspect(byImage);
                if (nets) return nets;
            }

            // 3) Legacy literal name.
            const literal = await tryInspect('borgmatic-ui');
            if (literal) return literal;

            // 4) Last resort: don't lie — return empty. The UI should then
            //    recommend "Scan all networks" rather than pre-selecting a
            //    network that might not contain anything useful.
            return [];
        })();

        const [allNetworks, connectedNetworks] = await Promise.all([networksPromise, connectedPromise]);

        // Sort networks: connected first, then borgmatic-db, then alphabetically
        const sortedNetworks = allNetworks.sort((a, b) => {
            const aConnected = connectedNetworks.includes(a);
            const bConnected = connectedNetworks.includes(b);
            if (aConnected && !bConnected) return -1;
            if (!aConnected && bConnected) return 1;
            if (a === 'borgmatic-db') return -1;
            if (b === 'borgmatic-db') return 1;
            return a.localeCompare(b);
        });

        res.json({
            success: true,
            data: {
                networks: sortedNetworks,
                connected: connectedNetworks
            }
        });
    } catch (error) {
        console.error('Failed to get Docker networks:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to get Docker networks. Is Docker running?'
        });
    }
});

module.exports = router;

