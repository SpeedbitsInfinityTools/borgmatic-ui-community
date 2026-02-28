const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

/**
 * Check if we can access Docker directly (without sudo)
 * This is true in production containers with mounted Docker socket
 */
let useDirectDocker = null; // Cache the result

function canAccessDockerDirectly() {
    if (useDirectDocker !== null) return useDirectDocker;
    
    try {
        // Try running docker info to check access
        const result = spawnSync('docker', ['info'], { 
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        useDirectDocker = result.status === 0;
        console.log(`🐳 Docker access: ${useDirectDocker ? 'direct (production)' : 'via sudo (development)'}`);
    } catch (error) {
        useDirectDocker = false;
    }
    return useDirectDocker;
}

/**
 * Spawn a Docker command with proper access method
 * Tries direct Docker access first, falls back to sudo if needed
 * @param {string[]} args - Docker command arguments
 * @param {Object} options - spawn options
 * @returns {ChildProcess}
 */
function spawnDocker(args, options = {}) {
    if (canAccessDockerDirectly()) {
        return spawn('docker', args, options);
    } else {
        return spawn('sudo', ['-n', 'docker', ...args], options);
    }
}

/**
 * Spawn a bash script with proper access method
 * @param {string} scriptPath - Path to the bash script
 * @param {string[]} scriptArgs - Script arguments
 * @param {Object} options - spawn options
 * @returns {ChildProcess}
 */
function spawnBashScript(scriptPath, scriptArgs = [], options = {}) {
    if (canAccessDockerDirectly()) {
        return spawn('bash', [scriptPath, ...scriptArgs], options);
    } else {
        return spawn('sudo', ['-n', 'bash', scriptPath, ...scriptArgs], options);
    }
}

/**
 * Database Discovery Service
 * Manages automatic database discovery for Borgmatic backups
 */
class DatabaseDiscoveryService {
    constructor() {
        this.cache = null;
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        // In production: /app/src/services -> /app/scripts
        // In development: nodejs/src/services -> scripts (via workspace mount)
        this.scriptPath = path.join(__dirname, '../../scripts/borgmatic-database-discovery.sh');
    }

    /**
     * Initialize service
     */
    async initialize() {
        try {
            // Verify discovery script exists
            if (!await fs.pathExists(this.scriptPath)) {
                console.warn('⚠️  Database discovery script not found:', this.scriptPath);
                return;
            }

            console.log('✅ Database discovery service initialized');
        } catch (error) {
            console.error('Failed to initialize database discovery:', error.message);
        }
    }

    /**
     * Discover all databases (PUBLIC - passwords are masked for security)
     * @param {Object} options - Discovery options
     * @param {string} options.network - Docker network to scan (default: borgmatic-db)
     * @param {boolean} options.includeStopped - Include stopped containers
     * @param {boolean} options.forceRefresh - Force cache refresh
     * @param {string[]} options.types - Database types to discover
     * @returns {Promise<Object>} Discovery results (passwords masked)
     */
    async discoverDatabases(options = {}) {
        try {
            // Check cache (cached results already have passwords masked)
            if (!options.forceRefresh && this.cache && !this._isCacheExpired()) {
                console.log('📦 Returning cached database discovery results');
                return this.cache.data;
            }

            console.log('🔍 Running database discovery...');

            // Run discovery script
            const scriptOutput = await this._runDiscoveryScript(options);

            // Parse results - DO NOT include passwords in public API responses
            const databases = this._parseDiscoveryOutput(scriptOutput, false);

            // Count by type
            const summary = this._generateSummary(databases);

            const result = {
                databases: databases,
                summary: summary,
                count: databases.length,
                timestamp: new Date().toISOString(),
                options: options
            };

            // Cache results (passwords already masked)
            this.cache = {
                data: result,
                timestamp: Date.now(),
                expiresAt: Date.now() + this.cacheTTL
            };

            console.log(`✅ Discovered ${databases.length} databases`);
            return result;

        } catch (error) {
            console.error('Database discovery failed:', error.message);
            throw new Error(`Database discovery failed: ${error.message}`);
        }
    }

    /**
     * Discover all databases WITH credentials (INTERNAL USE ONLY)
     * Used by template activation to store passwords in the vault.
     * NEVER expose this to API routes - passwords must stay server-side.
     * @param {Object} options - Discovery options
     * @returns {Promise<Object>} Discovery results WITH passwords
     */
    async discoverDatabasesWithCredentials(options = {}) {
        try {
            console.log('🔍 Running database discovery (with credentials for internal use)...');

            // Run discovery script - always fresh, never use cache for credentials
            const scriptOutput = await this._runDiscoveryScript({ ...options, forceRefresh: true });

            // Parse results WITH passwords (internal use only)
            const databases = this._parseDiscoveryOutput(scriptOutput, true);

            // Count by type
            const summary = this._generateSummary(databases);

            console.log(`✅ Discovered ${databases.length} databases with credentials`);
            return {
                databases: databases,
                summary: summary,
                count: databases.length,
                timestamp: new Date().toISOString(),
                options: options
            };

        } catch (error) {
            console.error('Database discovery (with credentials) failed:', error.message);
            throw new Error(`Database discovery failed: ${error.message}`);
        }
    }

    /**
     * Get cached discovery results
     */
    async getCachedDiscovery() {
        if (this.cache && !this._isCacheExpired()) {
            return {
                ...this.cache.data,
                cached: true,
                cacheAge: Math.floor((Date.now() - this.cache.timestamp) / 1000)
            };
        }

        return null;
    }

    /**
     * Get database count
     */
    async getCount(options = {}) {
        try {
            const scriptOutput = await this._runDiscoveryScript({ ...options, mode: 'count' });
            const count = parseInt(scriptOutput.trim()) || 0;
            
            return {
                count: count,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Failed to get database count:', error.message);
            return { count: 0, error: error.message };
        }
    }

    /**
     * Validate database connectivity
     * @param {Object} database - Database configuration
     * @returns {Promise<boolean>}
     */
    async validateDatabase(database) {
        try {
            // Basic validation
            if (!database || !database.container || !database.type) {
                return false;
            }

            // Check if container is running
            const dockerCheck = spawnDocker(['inspect', '--format', '{{.State.Running}}', database.container]);

            return new Promise((resolve) => {
                let output = '';
                dockerCheck.stdout.on('data', (data) => output += data.toString());
                
                dockerCheck.on('close', (code) => {
                    if (code !== 0) {
                        resolve(false);
                    } else {
                        resolve(output.trim() === 'true');
                    }
                });
            });
        } catch (error) {
            console.error('Database validation failed:', error.message);
            return false;
        }
    }

    /**
     * Invalidate cache
     */
    invalidateCache() {
        this.cache = null;
        console.log('🗑️  Database discovery cache invalidated');
    }

    /**
     * Run discovery bash script
     * @private
     */
    async _runDiscoveryScript(options = {}) {
        return new Promise((resolve, reject) => {
            // Build network filter - join multiple networks with spaces for the script
            const networks = options.networks || (options.network ? [options.network] : []);
            const networkFilter = networks.join(' ');

            const env = {
                ...process.env,
                BORG_DB_NETWORK: networkFilter,
                INCLUDE_STOPPED: options.includeStopped ? 'true' : 'false'
            };

            // Support multiple output modes from the discovery script.
            // Default remains JSON for scan/discovery endpoints.
            const mode = options.mode || 'json';
            const child = spawnBashScript(this.scriptPath, [mode], { env });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Discovery script failed with code ${code}: ${stderr}`));
                } else {
                    resolve(stdout);
                }
            });

            child.on('error', (error) => {
                reject(new Error(`Failed to spawn discovery script: ${error.message}`));
            });
        });
    }

    /**
     * Parse discovery script JSON output
     * @private
     * @param {boolean} includePasswords - If true, include passwords (for internal use only)
     */
    _parseDiscoveryOutput(output, includePasswords = false) {
        try {
            // The script now outputs JSON directly
            const trimmed = output.trim();
            if (!trimmed || trimmed === '[]') {
                return [];
            }

            const databases = JSON.parse(trimmed);
            
            // Add discovered_at timestamp to each and optionally strip passwords
            return databases.map(db => {
                const result = {
                    ...db,
                    discovered_at: new Date().toISOString()
                };
                // Strip password from API responses for security - passwords should only
                // be accessed internally during template activation, never sent to frontend
                if (!includePasswords) {
                    result.password = db.password ? '********' : '';
                    result.has_password = !!db.password;
                }
                return result;
            });
        } catch (error) {
            console.error('Failed to parse discovery output as JSON:', error.message);
            console.error('Output was:', output.substring(0, 500));
            return [];
        }
    }

    /**
     * Generate summary statistics
     * @private
     */
    _generateSummary(databases) {
        const summary = {
            mariadb: 0,
            mysql: 0,
            postgresql: 0,
            sqlite: 0,
            mongodb: 0,
            mssql: 0,
            total: databases.length
        };

        for (const db of databases) {
            if (summary[db.type] !== undefined) {
                summary[db.type]++;
            }
        }

        return summary;
    }

    /**
     * Check if cache is expired
     * @private
     */
    _isCacheExpired() {
        if (!this.cache) {
            return true;
        }

        return Date.now() > this.cache.expiresAt;
    }

    /**
     * Generate Borgmatic YAML configuration for discovered databases
     */
    async generateBorgmaticConfig(selectedDatabases) {
        try {
            if (!Array.isArray(selectedDatabases) || selectedDatabases.length === 0) {
                return '';
            }

            // Run script in YAML mode to get proper YAML output
            const yamlOutput = await this._runDiscoveryScript({ mode: 'yaml' });
            
            return yamlOutput;
        } catch (error) {
            console.error('Failed to generate Borgmatic config:', error.message);
            throw error;
        }
    }
}

module.exports = new DatabaseDiscoveryService();

