const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const credentialEncryption = require('./credential-encryption');

/**
 * Repository Credentials Storage Service
 * Stores encrypted credentials for repositories in a separate JSON file
 */
class RepositoryCredentials {
    constructor() {
        this.credentialsFile = path.join(config.dataDir, 'repository-credentials.json');
    }

    /**
     * Read credentials file
     */
    async _readCredentials() {
        try {
            if (await fs.pathExists(this.credentialsFile)) {
                const content = await fs.readFile(this.credentialsFile, 'utf8');
                return JSON.parse(content);
            }
            return {};
        } catch (error) {
            console.error('Failed to read credentials file:', error.message);
            return {};
        }
    }
    
    /**
     * Read credentials file (public method for internal operations)
     */
    async readCredentials() {
        return this._readCredentials();
    }
    
    /**
     * Write credentials file (public method for internal operations)
     */
    async writeCredentials(credentials) {
        return this._writeCredentials(credentials);
    }

    /**
     * Write credentials file
     */
    async _writeCredentials(credentials) {
        try {
            await fs.ensureDir(path.dirname(this.credentialsFile));
            await fs.writeFile(this.credentialsFile, JSON.stringify(credentials, null, 2));
            await fs.chmod(this.credentialsFile, 0o600); // Secure permissions
        } catch (error) {
            console.error('Failed to write credentials file:', error.message);
            throw error;
        }
    }

    /**
     * Store SSH password for repository
     * @param {string} repoPath - Repository path (used as key)
     * @param {string} password - SSH password (will be encrypted)
     */
    async storeSSHPassword(repoPath, password) {
        const credentials = await this._readCredentials();
        if (!credentials[repoPath]) {
            credentials[repoPath] = {};
        }
        credentials[repoPath].ssh_password_encrypted = credentialEncryption.encrypt(password);
        await this._writeCredentials(credentials);
        console.log(`✅ Stored encrypted SSH password for ${repoPath}`);
    }

    /**
     * Get SSH password for repository
     * @param {string} repoPath - Repository path
     * @returns {string|null} - Decrypted password or null if not found
     */
    async getSSHPassword(repoPath) {
        const credentials = await this._readCredentials();
        const repoCreds = credentials[repoPath];
        if (!repoCreds || !repoCreds.ssh_password_encrypted) {
            return null;
        }
        try {
            return credentialEncryption.decrypt(repoCreds.ssh_password_encrypted);
        } catch (error) {
            console.error(`Failed to decrypt SSH password for ${repoPath}:`, error.message);
            return null;
        }
    }

    /**
     * Store SSH key for repository
     * @param {string} repoPath - Repository path (used as key)
     * @param {string} sshKeyId - SSH key ID
     * @param {string} privateKey - Private key (will be encrypted)
     */
    async storeSSHKey(repoPath, sshKeyId, privateKey) {
        const credentials = await this._readCredentials();
        if (!credentials[repoPath]) {
            credentials[repoPath] = {};
        }
        credentials[repoPath].ssh_key_id = sshKeyId;
        credentials[repoPath].ssh_key_encrypted = credentialEncryption.encryptSSHKey(privateKey);
        await this._writeCredentials(credentials);
    }

    /**
     * Get SSH key for repository
     * @param {string} repoPath - Repository path
     * @returns {Object|null} { ssh_key_id, private_key }
     */
    async getSSHKey(repoPath) {
        const credentials = await this._readCredentials();
        const repoCreds = credentials[repoPath];
        if (!repoCreds || !repoCreds.ssh_key_encrypted) {
            return null;
        }
        return {
            ssh_key_id: repoCreds.ssh_key_id,
            private_key: credentialEncryption.decryptSSHKey(repoCreds.ssh_key_encrypted)
        };
    }

    /**
     * Store S3 credentials for repository
     * @param {string} repoPath - Repository path
     * @param {Object} s3Creds - { access_key, secret_key, endpoint, region, bucket, path }
     */
    async storeS3Credentials(repoPath, s3Creds) {
        const credentials = await this._readCredentials();
        if (!credentials[repoPath]) {
            credentials[repoPath] = {};
        }
        credentials[repoPath].s3_credentials = {
            access_key_encrypted: credentialEncryption.encrypt(s3Creds.access_key),
            secret_key_encrypted: credentialEncryption.encrypt(s3Creds.secret_key),
            endpoint: s3Creds.endpoint, // Not sensitive
            region: s3Creds.region, // Not sensitive
            bucket: s3Creds.bucket, // Not sensitive
            path: s3Creds.path // Not sensitive
        };
        await this._writeCredentials(credentials);
    }

    /**
     * Get S3 credentials for repository
     * @param {string} repoPath - Repository path
     * @returns {Object|null} Decrypted S3 credentials
     */
    async getS3Credentials(repoPath) {
        const credentials = await this._readCredentials();
        const repoCreds = credentials[repoPath];
        if (!repoCreds || !repoCreds.s3_credentials) {
            return null;
        }
        const s3Creds = repoCreds.s3_credentials;
        return {
            access_key: credentialEncryption.decrypt(s3Creds.access_key_encrypted),
            secret_key: credentialEncryption.decrypt(s3Creds.secret_key_encrypted),
            endpoint: s3Creds.endpoint,
            region: s3Creds.region,
            bucket: s3Creds.bucket,
            path: s3Creds.path
        };
    }

    /**
     * Delete credentials for repository
     * @param {string} repoPath - Repository path
     */
    async deleteCredentials(repoPath) {
        const credentials = await this._readCredentials();
        if (credentials[repoPath]) {
            delete credentials[repoPath];
            await this._writeCredentials(credentials);
        }
    }

    /**
     * Update repository path (migrate credentials)
     * @param {string} oldPath - Old repository path
     * @param {string} newPath - New repository path
     */
    async updateRepositoryPath(oldPath, newPath) {
        const credentials = await this._readCredentials();
        if (credentials[oldPath]) {
            credentials[newPath] = credentials[oldPath];
            delete credentials[oldPath];
            await this._writeCredentials(credentials);
        }
    }
}

module.exports = new RepositoryCredentials();

