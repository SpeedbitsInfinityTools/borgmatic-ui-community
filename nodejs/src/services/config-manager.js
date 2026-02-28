const fs = require('fs-extra');
const path = require('path');

/**
 * Configuration Manager
 * Manages dynamic .env configuration updates
 */
class ConfigManager {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '../..');
        this.envFile = path.join(this.projectRoot, '.env');
        this.envExampleFile = path.join(this.projectRoot, '.env.example');
    }

    /**
     * Read current .env file
     */
    async readEnv() {
        try {
            if (!await fs.pathExists(this.envFile)) {
                // Create from example if doesn't exist
                if (await fs.pathExists(this.envExampleFile)) {
                    await fs.copy(this.envExampleFile, this.envFile);
                } else {
                    await fs.writeFile(this.envFile, '# Borgmatic UI Configuration\n');
                }
            }

            const content = await fs.readFile(this.envFile, 'utf8');
            const env = {};

            content.split('\n').forEach(line => {
                line = line.trim();
                if (!line || line.startsWith('#')) return;

                const [key, ...valueParts] = line.split('=');
                if (key) {
                    env[key.trim()] = valueParts.join('=').trim();
                }
            });

            return env;
        } catch (error) {
            console.error('Failed to read .env:', error.message);
            return {};
        }
    }

    /**
     * Update .env file with new values
     */
    async updateEnv(updates) {
        try {
            const current = await this.readEnv();
            const config = require('../config');

            // Include runtime config values (from environment variables) to prevent placeholder paths
            const runtime = {
                PORT: config.port,
                NODE_ENV: config.nodeEnv,
                ACCESS_TOKEN_EXPIRE_MINUTES: config.accessTokenExpireMinutes,
                CONFIG_DIR: config.configDir,
                DATA_DIR: config.dataDir,
                LOGS_DIR: config.logsDir,
                BACKUPS_DIR: config.backupsDir,
                ADMIN_CONFIG_PATH: config.adminConfigPath,
                BORGMATIC_CONFIG_PATH: config.borgmaticConfigPath,
                LOG_LEVEL: config.logLevel,
            };

            const merged = { ...current, ...runtime, ...updates };

            // Build new .env content
            let content = '# Borgmatic UI Configuration\n';
            content += `# Last updated: ${new Date().toISOString()}\n\n`;

            // Group by category
            const categories = {
                'SECURITY': ['SECRET_KEY', 'BORGMATIC_MODE'],
                'SERVER': ['PORT', 'NODE_ENV', 'ACCESS_TOKEN_EXPIRE_MINUTES', 'CORS_ORIGINS', 'DOMAIN'],
                'DIRECTOR': ['DIRECTOR_PORT', 'DIRECTOR_SSL_ENABLED', 'DIRECTOR_SSL_CERT', 'DIRECTOR_SSL_KEY', 'DIRECTOR_AUTO_APPROVE', 'DIRECTOR_REQUIRE_PHRASE'],
                'CLIENT': ['CLIENT_NAME', 'CLIENT_IDENTIFICATION_PHRASE', 'DIRECTOR_URL', 'DIRECTOR_PORT'],
                'PATHS': ['CONFIG_DIR', 'DATA_DIR', 'LOGS_DIR', 'BACKUPS_DIR', 'ADMIN_CONFIG_PATH'],
                'BORGMATIC': ['BORGMATIC_CONFIG_PATH', 'BORGMATIC_BACKUP_PATH', 'BACKUP_TIMEOUT'],
                'LOGGING': ['LOG_LEVEL']
            };

            for (const [category, keys] of Object.entries(categories)) {
                content += `# ${category}\n`;
                for (const key of keys) {
                    if (merged[key] !== undefined) {
                        content += `${key}=${merged[key]}\n`;
                    }
                }
                content += '\n';
            }

            // Add any remaining keys not in categories
            const categorizedKeys = new Set(Object.values(categories).flat());
            for (const [key, value] of Object.entries(merged)) {
                if (!categorizedKeys.has(key)) {
                    content += `${key}=${value}\n`;
                }
            }

            // Write to file
            await fs.writeFile(this.envFile, content, 'utf8');
            console.log('✅ .env file updated');

            return { success: true };
        } catch (error) {
            console.error('Failed to update .env:', error.message);
            throw error;
        }
    }

    /**
     * Configure CORS based on domain/URL settings
     */
    async configureCors(domains = []) {
        try {
            // Build CORS origins list
            const origins = new Set();

            // Always include localhost for development
            origins.add('http://localhost:5173');
            origins.add('http://localhost:8000');
            origins.add('http://localhost:3000');

            // Add configured domains
            domains.forEach(domain => {
                if (domain) {
                    // Add both http and https versions
                    origins.add(`http://${domain}`);
                    origins.add(`https://${domain}`);

                    // Remove port if present and add with common ports
                    const cleanDomain = domain.split(':')[0];
                    origins.add(`http://${cleanDomain}:8000`);
                    origins.add(`https://${cleanDomain}:8000`);
                    origins.add(`http://${cleanDomain}:5173`);
                }
            });

            const corsOrigins = Array.from(origins).join(',');

            await this.updateEnv({ CORS_ORIGINS: corsOrigins });

            console.log(`✅ CORS configured for: ${corsOrigins}`);
            return { success: true, origins: corsOrigins };
        } catch (error) {
            console.error('Failed to configure CORS:', error.message);
            throw error;
        }
    }

    /**
     * Get current configuration
     */
    async getConfig() {
        return await this.readEnv();
    }

    /**
     * Initialize configuration (create .env if missing)
     */
    async initialize() {
        try {
            if (!await fs.pathExists(this.envFile)) {
                console.log('📝 Creating .env file from template...');

                if (await fs.pathExists(this.envExampleFile)) {
                    await fs.copy(this.envExampleFile, this.envFile);
                } else {
                    await fs.writeFile(this.envFile, '# Borgmatic UI Configuration\n');
                }

                console.log('✅ .env file created');
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to initialize config:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ConfigManager();

