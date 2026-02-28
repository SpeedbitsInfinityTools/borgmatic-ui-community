const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execa } = require('execa');

/**
 * Password Manager Service
 * Handles all borgmatic password and credential methods
 * Based on: https://torsion.org/borgmatic/docs/how-to/provide-your-passwords/
 */
class PasswordManager {
    constructor() {
        // Serialize credential writes to prevent corruption under concurrent operations.
        // IMPORTANT: Never expose secrets in logs.
        this._writeQueue = Promise.resolve();
        this.credentialMethods = {
            'direct': {
                name: 'Direct Passphrase',
                description: 'Store passphrase directly in configuration',
                security: 'Medium',
                convenience: 'High',
                example: 'encryption_passphrase: yourpassphrase'
            },
            'environment': {
                name: 'Environment Variable',
                description: 'Read from environment variable',
                security: 'Low',
                convenience: 'High',
                example: 'encryption_passphrase: ${YOUR_PASSPHRASE}'
            },
            'file': {
                name: 'File-based Credentials',
                description: 'Read from file on filesystem',
                security: 'High',
                convenience: 'Medium',
                example: 'encryption_passphrase: "{credential file /credentials/borgmatic.txt}"'
            },
            'systemd': {
                name: 'systemd Credentials',
                description: 'Read from systemd encrypted credentials',
                security: 'Very High',
                convenience: 'Medium',
                example: 'encryption_passphrase: "{credential systemd borgmatic.pw}"'
            },
            'container': {
                name: 'Container Secrets',
                description: 'Read from Docker/Podman secrets',
                security: 'High',
                convenience: 'High',
                example: 'encryption_passphrase: "{credential container borgmatic_passphrase}"'
            },
            'keepassxc': {
                name: 'KeePassXC',
                description: 'Read from KeePassXC password manager',
                security: 'Very High',
                convenience: 'Low',
                example: 'encryption_passphrase: "{credential keepassxc /etc/keys.kdbx borgmatic}"'
            },
            'passcommand': {
                name: 'External Command',
                description: 'Execute command to get passphrase',
                security: 'High',
                convenience: 'Medium',
                example: 'encryption_passcommand: pass path/to/borg-passphrase'
            }
        };
    }

    _normalizeRepoKey(repositoryPath) {
        if (typeof repositoryPath !== 'string') return '';
        let p = repositoryPath.trim();
        // Normalize trailing slash (except root)
        if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
        return p;
    }

    /**
     * Get available credential methods
     */
    getCredentialMethods() {
        return this.credentialMethods;
    }

    /**
     * Generate secure passphrase
     */
    generateSecurePassphrase(length = 32, includeSpecial = true) {
        let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        
        if (includeSpecial) {
            alphabet += '!@#$%^&*()_+-=[]{}|;:,.<>?';
        }

        return Array.from({ length }, () => 
            alphabet[crypto.randomInt(0, alphabet.length)]
        ).join('');
    }

    /**
     * Derive a fixed 32-byte key from the instance SECRET_KEY
     * (The config module guarantees a persisted secretKey exists in normal operation.)
     */
    _getKey() {
        const config = require('../config');
        const secretKey = config.secretKey || process.env.SECRET_KEY;
        if (!secretKey) {
            throw new Error('SECRET_KEY is required to encrypt/decrypt credentials');
        }
        return crypto.createHash('sha256').update(secretKey).digest(); // 32 bytes
    }

    /**
     * Encrypt plaintext with AES-256-GCM
     * Returns JSON string (v2 format) with iv/tag/payload in base64
     */
    _encryptV2(plaintext) {
        const key = this._getKey();
        const iv = crypto.randomBytes(12); // recommended length for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            v: 2,
            alg: 'aes-256-gcm',
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            payload: ciphertext.toString('base64'),
        });
    }

    /**
     * Decrypt v2 JSON envelope
     */
    _decryptV2(envelopeJson) {
        const key = this._getKey();
        const env = JSON.parse(envelopeJson);
        if (!env || env.v !== 2 || env.alg !== 'aes-256-gcm' || !env.iv || !env.tag || !env.payload) {
            throw new Error('Invalid credentials envelope');
        }
        const iv = Buffer.from(env.iv, 'base64');
        const tag = Buffer.from(env.tag, 'base64');
        const payload = Buffer.from(env.payload, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
        return plaintext.toString('utf8');
    }

    /**
     * Read and decrypt the credentials file
     */
    async _readCredentials() {
        try {
            const config = require('../config');
            const credentialsFile = path.join(config.dataDir, 'passphrases.json');
            
            if (!await fs.pathExists(credentialsFile)) {
                // Return default structure
                return {
                    repositories: {},
                    ssh_keys: {},
                    databases: {},
                    cloud_storage: {}
                };
            }
            
            const raw = await fs.readFile(credentialsFile, 'utf8');

            let decryptedJson = null;

            // v2 format (JSON envelope)
            if (raw.trim().startsWith('{')) {
                decryptedJson = this._decryptV2(raw.trim());
            } else {
                // Legacy format (hex string encrypted via deprecated createCipher/createDecipher)
                // Keep for backwards compatibility / migration, but do NOT allow insecure defaults.
                const secretKey = config.secretKey || process.env.SECRET_KEY;
                if (!secretKey) {
                    throw new Error('SECRET_KEY is required to decrypt legacy credentials');
                }
                const decipher = crypto.createDecipher('aes-256-cbc', secretKey);
                decryptedJson = decipher.update(raw, 'hex', 'utf8') + decipher.final('utf8');

                // Migrate legacy -> v2 on successful decrypt
                try {
                    const parsed = JSON.parse(decryptedJson);
                    await this._writeCredentials(parsed);
                } catch (_) {
                    // ignore migration if JSON parse fails
                }
            }

            const credentials = JSON.parse(decryptedJson);
            
            // Ensure all sections exist (migration from old format)
            if (!credentials.repositories) {
                // Old format: flat key-value pairs, migrate them to repositories
                const oldCreds = { ...credentials };
                credentials.repositories = oldCreds;
                credentials.ssh_keys = {};
                credentials.databases = {};
                credentials.cloud_storage = {};
            } else {
                // Ensure all sections exist
                credentials.ssh_keys = credentials.ssh_keys || {};
                credentials.databases = credentials.databases || {};
                credentials.cloud_storage = credentials.cloud_storage || {};
            }
            
            return credentials;
        } catch (error) {
            console.error('Failed to read credentials:', error.message);
            return {
                repositories: {},
                ssh_keys: {},
                databases: {},
                cloud_storage: {}
            };
        }
    }

    /**
     * Write and encrypt the credentials file (with mutex for atomic operations)
     */
    async _writeCredentials(credentials) {
        const run = async () => {
            const config = require('../config');
            const credentialsFile = path.join(config.dataDir, 'passphrases.json');
            const tempFile = `${credentialsFile}.tmp.${process.pid}.${Date.now()}`;

            const plaintext = JSON.stringify(credentials, null, 2);
            const encryptedEnvelope = this._encryptV2(plaintext);
            await fs.ensureDir(path.dirname(credentialsFile));

            // Write to temp file first, then rename atomically
            await fs.writeFile(tempFile, encryptedEnvelope, { mode: 0o600 });
            await fs.rename(tempFile, credentialsFile);

            return { success: true };
        };

        // Chain onto the queue; keep the queue alive even if a write fails.
        const op = this._writeQueue.then(run);
        this._writeQueue = op.catch(() => {});
        return op;
    }

    /**
     * Atomic read-modify-write operation
     * Ensures the entire operation (read, modify, write) is serialized to prevent race conditions.
     * @param {Function} modifier - Function that receives credentials and modifies them in place
     * @returns {Promise<{success: boolean}>}
     */
    async _atomicUpdate(modifier) {
        const run = async () => {
            const config = require('../config');
            const credentialsFile = path.join(config.dataDir, 'passphrases.json');
            const tempFile = `${credentialsFile}.tmp.${process.pid}.${Date.now()}`;

            // Read inside the queue to prevent race conditions
            const credentials = await this._readCredentials();
            
            // Apply the modification
            await modifier(credentials);
            
            // Write atomically
            const plaintext = JSON.stringify(credentials, null, 2);
            const encryptedEnvelope = this._encryptV2(plaintext);
            await fs.ensureDir(path.dirname(credentialsFile));
            await fs.writeFile(tempFile, encryptedEnvelope, { mode: 0o600 });
            await fs.rename(tempFile, credentialsFile);

            return { success: true };
        };

        // Chain onto the queue; keep the queue alive even if a write fails.
        const op = this._writeQueue.then(run);
        this._writeQueue = op.catch(() => {});
        return op;
    }

    /**
     * Store repository passphrase securely
     */
    async storeRepositoryPassphrase(repositoryPath, passphrase) {
        try {
            const repoKey = this._normalizeRepoKey(repositoryPath);
            await this._atomicUpdate((credentials) => {
                credentials.repositories[repoKey] = passphrase;
            });
            
            console.log(`✅ Passphrase stored for repository: ${repoKey}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to store passphrase:', error.message);
            throw error;
        }
    }

    /**
     * Get repository passphrase
     */
    async getRepositoryPassphrase(repositoryPath) {
        try {
            const repoKey = this._normalizeRepoKey(repositoryPath);
            const credentials = await this._readCredentials();
            return credentials.repositories[repoKey] || null;
        } catch (error) {
            console.error('Failed to get passphrase:', error.message);
            return null;
        }
    }

    /**
     * Store SSH key credentials
     */
    async storeSSHKey(keyName, privateKey, passphrase = null) {
        try {
            await this._atomicUpdate((credentials) => {
                credentials.ssh_keys[keyName] = {
                    private_key: privateKey,
                    passphrase: passphrase,
                    created_at: new Date().toISOString()
                };
            });
            
            console.log(`✅ SSH key stored: ${keyName}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to store SSH key:', error.message);
            throw error;
        }
    }

    /**
     * Get SSH key credentials
     */
    async getSSHKey(keyName) {
        try {
            const credentials = await this._readCredentials();
            return credentials.ssh_keys[keyName] || null;
        } catch (error) {
            console.error('Failed to get SSH key:', error.message);
            return null;
        }
    }

    /**
     * Store database credentials
     */
    async storeDatabaseCredentials(dbName, type, credentialsData) {
        try {
            await this._atomicUpdate((credentials) => {
                credentials.databases[dbName] = {
                    type: type, // postgresql, mysql, sqlite, mongodb
                    credentials: JSON.stringify(credentialsData),
                    created_at: new Date().toISOString()
                };
            });
            
            console.log(`✅ Database credentials stored: ${dbName} (${type})`);
            return { success: true };
        } catch (error) {
            console.error('Failed to store database credentials:', error.message);
            throw error;
        }
    }

    /**
     * Get database credentials
     */
    async getDatabaseCredentials(dbName) {
        try {
            const credentials = await this._readCredentials();
            const dbCreds = credentials.databases[dbName];
            if (dbCreds) {
                return {
                    type: dbCreds.type,
                    credentials: JSON.parse(dbCreds.credentials),
                    created_at: dbCreds.created_at
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to get database credentials:', error.message);
            return null;
        }
    }

    /**
     * Store cloud storage credentials (S3, Azure, GCS, rclone, etc.)
     */
    async storeCloudStorageCredentials(storageName, type, credentialsData) {
        try {
            await this._atomicUpdate((credentials) => {
                credentials.cloud_storage[storageName] = {
                    type: type, // s3, azure, gcs, sftp, rclone, etc.
                    credentials: JSON.stringify(credentialsData),
                    created_at: new Date().toISOString()
                };
            });
            
            console.log(`✅ Cloud storage credentials stored: ${storageName} (${type})`);
            return { success: true };
        } catch (error) {
            console.error('Failed to store cloud storage credentials:', error.message);
            throw error;
        }
    }

    /**
     * Get cloud storage credentials
     */
    async getCloudStorageCredentials(storageName) {
        try {
            const credentials = await this._readCredentials();
            const storageCreds = credentials.cloud_storage[storageName];
            if (storageCreds) {
                return {
                    type: storageCreds.type,
                    credentials: JSON.parse(storageCreds.credentials),
                    created_at: storageCreds.created_at
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to get cloud storage credentials:', error.message);
            return null;
        }
    }

    /**
     * Create file-based credential
     */
    async createFileCredential(credentialPath, passphrase) {
        try {
            await fs.ensureDir(path.dirname(credentialPath));
            await fs.writeFile(credentialPath, passphrase, 'utf8');
            
            // Set secure permissions (readable only by owner)
            await fs.chmod(credentialPath, 0o600);
            
            return {
                success: true,
                path: credentialPath,
                method: 'file',
                configValue: `{credential file ${credentialPath}}`
            };
        } catch (error) {
            console.error('Failed to create file credential:', error.message);
            throw error;
        }
    }

    /**
     * Create systemd credential
     */
    async createSystemdCredential(credentialName, passphrase) {
        try {
            const credentialPath = `/etc/credstore.encrypted/${credentialName}`;
            
            // Create the credential using systemd-creds
            const { stdout, stderr } = await execa('systemd-creds', [
                'encrypt',
                '--name', credentialName,
                '-',
                credentialPath
            ], {
                input: passphrase
            });

            if (stderr) {
                throw new Error(`systemd-creds error: ${stderr}`);
            }

            return {
                success: true,
                path: credentialPath,
                method: 'systemd',
                configValue: `{credential systemd ${credentialName}}`,
                systemdCommand: `systemd-ask-password -n | systemd-creds encrypt - ${credentialPath}`
            };
        } catch (error) {
            console.error('Failed to create systemd credential:', error.message);
            throw error;
        }
    }

    /**
     * Create container secret
     */
    async createContainerSecret(secretName, passphrase, secretsDir = '/run/secrets') {
        try {
            const secretPath = path.join(secretsDir, secretName);
            await fs.ensureDir(path.dirname(secretPath));
            await fs.writeFile(secretPath, passphrase, 'utf8');
            
            // Set secure permissions
            await fs.chmod(secretPath, 0o600);
            
            return {
                success: true,
                path: secretPath,
                method: 'container',
                configValue: `{credential container ${secretName}}`
            };
        } catch (error) {
            console.error('Failed to create container secret:', error.message);
            throw error;
        }
    }

    /**
     * Test KeePassXC credential
     */
    async testKeepassxcCredential(databasePath, entryTitle) {
        try {
            const { stdout, stderr } = await execa('keepassxc-cli', [
                'show',
                databasePath,
                entryTitle,
                '--password'
            ]);

            if (stderr && !stderr.includes('Password:')) {
                throw new Error(`KeePassXC error: ${stderr}`);
            }

            return {
                success: true,
                method: 'keepassxc',
                configValue: `{credential keepassxc ${databasePath} ${entryTitle}}`
            };
        } catch (error) {
            console.error('Failed to test KeePassXC credential:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test external command
     */
    async testExternalCommand(command) {
        try {
            const { stdout, stderr } = await execa('sh', ['-c', command]);
            
            if (stderr) {
                throw new Error(`Command error: ${stderr}`);
            }

            return {
                success: true,
                method: 'passcommand',
                configValue: command,
                output: stdout.trim()
            };
        } catch (error) {
            console.error('Failed to test external command:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get password method recommendations
     */
    getPasswordMethodRecommendations() {
        return {
            'development': {
                recommended: 'direct',
                alternatives: ['environment', 'file'],
                reason: 'Simple setup for development'
            },
            'production': {
                recommended: 'systemd',
                alternatives: ['file', 'container'],
                reason: 'High security with system integration'
            },
            'containerized': {
                recommended: 'container',
                alternatives: ['file', 'environment'],
                reason: 'Native container secret management'
            },
            'password_manager': {
                recommended: 'keepassxc',
                alternatives: ['passcommand'],
                reason: 'Integration with existing password manager'
            },
            'simple': {
                recommended: 'file',
                alternatives: ['direct', 'environment'],
                reason: 'Good balance of security and simplicity'
            }
        };
    }

    /**
     * Validate password configuration
     */
    validatePasswordConfig(method, config) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: []
        };

        switch (method) {
            case 'direct':
                if (!config.passphrase || config.passphrase.length < 8) {
                    validation.isValid = false;
                    validation.errors.push('Passphrase must be at least 8 characters');
                }
                break;

            case 'environment':
                if (!config.environmentVariable) {
                    validation.isValid = false;
                    validation.errors.push('Environment variable name is required');
                }
                break;

            case 'file':
                if (!config.filePath) {
                    validation.isValid = false;
                    validation.errors.push('File path is required');
                }
                break;

            case 'systemd':
                if (!config.credentialName) {
                    validation.isValid = false;
                    validation.errors.push('Credential name is required');
                }
                break;

            case 'container':
                if (!config.secretName) {
                    validation.isValid = false;
                    validation.errors.push('Secret name is required');
                }
                break;

            case 'keepassxc':
                if (!config.databasePath || !config.entryTitle) {
                    validation.isValid = false;
                    validation.errors.push('Database path and entry title are required');
                }
                break;

            case 'passcommand':
                if (!config.command) {
                    validation.isValid = false;
                    validation.errors.push('Command is required');
                }
                break;
        }

        return validation;
    }

    /**
     * Generate configuration for password method
     */
    generatePasswordConfig(method, config) {
        switch (method) {
            case 'direct':
                return `encryption_passphrase: ${config.passphrase}`;

            case 'environment':
                return `encryption_passphrase: \${${config.environmentVariable}}`;

            case 'file':
                return `encryption_passphrase: "{credential file ${config.filePath}}"`;

            case 'systemd':
                return `encryption_passphrase: "{credential systemd ${config.credentialName}}"`;

            case 'container':
                return `encryption_passphrase: "{credential container ${config.secretName}}"`;

            case 'keepassxc':
                return `encryption_passphrase: "{credential keepassxc ${config.databasePath} ${config.entryTitle}}"`;

            case 'passcommand':
                return `encryption_passcommand: ${config.command}`;

            default:
                throw new Error(`Unknown password method: ${method}`);
        }
    }

    /**
     * Get security analysis for password method
     */
    getSecurityAnalysis(method) {
        const analyses = {
            'direct': {
                security: 'Medium',
                risks: ['Configuration file contains plaintext password', 'File permissions must be secure'],
                mitigations: ['Use secure file permissions (600)', 'Restrict access to configuration file']
            },
            'environment': {
                security: 'Low',
                risks: ['Environment variables visible in process list', 'May be logged in shell history'],
                mitigations: ['Use secure environment setup', 'Avoid logging environment variables']
            },
            'file': {
                security: 'High',
                risks: ['File permissions must be secure', 'File location must be protected'],
                mitigations: ['Use secure file permissions (600)', 'Store in protected directory']
            },
            'systemd': {
                security: 'Very High',
                risks: ['Requires systemd integration', 'Credential store must be secure'],
                mitigations: ['Use systemd encrypted credentials', 'Secure credential store directory']
            },
            'container': {
                security: 'High',
                risks: ['Container secret management required', 'Secrets directory must be secure'],
                mitigations: ['Use container secret management', 'Secure secrets directory']
            },
            'keepassxc': {
                security: 'Very High',
                risks: ['Requires KeePassXC setup', 'Database must be secure'],
                mitigations: ['Use strong KeePassXC database password', 'Secure database file location']
            },
            'passcommand': {
                security: 'High',
                risks: ['External command security', 'Command output must be secure'],
                mitigations: ['Use secure external commands', 'Validate command output']
            }
        };

        return analyses[method] || {
            security: 'Unknown',
            risks: ['Unknown method'],
            mitigations: ['Contact administrator']
        };
    }
}

module.exports = new PasswordManager();
