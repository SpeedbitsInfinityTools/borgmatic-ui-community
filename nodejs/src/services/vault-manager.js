const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

/**
 * Vault Manager - Securely store and manage client repository passphrases
 * 
 * Uses AES-256-GCM encryption with a master password.
 * The master password is never stored - only used to derive encryption keys.
 */
class VaultManager {
    constructor() {
        this.vaultFile = path.join(config.dataDir, 'vault.json');
        this.saltFile = path.join(config.dataDir, 'vault.salt');
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.iterations = 100000; // PBKDF2 iterations
    }

    /**
     * Check if vault exists and is initialized
     */
    async isInitialized() {
        return await fs.pathExists(this.vaultFile) && await fs.pathExists(this.saltFile);
    }

    /**
     * Initialize vault with master password
     */
    async initialize(masterPassword) {
        if (!masterPassword || masterPassword.length < 8) {
            throw new Error('Master password must be at least 8 characters');
        }

        // Generate random salt for key derivation
        const salt = crypto.randomBytes(32);
        await fs.writeFile(this.saltFile, salt);
        await fs.chmod(this.saltFile, 0o600);

        // Create empty vault structure
        const vault = {
            version: 1,
            created_at: new Date().toISOString(),
            clients: {}
        };

        await fs.writeJson(this.vaultFile, vault, { spaces: 2 });
        await fs.chmod(this.vaultFile, 0o600);

        console.log('✅ Vault initialized with master password');
    }

    /**
     * Derive encryption key from master password and salt
     */
    async deriveKey(masterPassword) {
        if (!await fs.pathExists(this.saltFile)) {
            throw new Error('Vault not initialized. Please set master password first.');
        }

        const salt = await fs.readFile(this.saltFile);
        
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(masterPassword, salt, this.iterations, this.keyLength, 'sha512', (err, key) => {
                if (err) reject(err);
                else resolve(key);
            });
        });
    }

    /**
     * Encrypt data with master password
     */
    async encrypt(data, masterPassword) {
        const key = await this.deriveKey(masterPassword);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        // Return iv + authTag + encrypted data
        return {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            data: encrypted
        };
    }

    /**
     * Decrypt data with master password
     */
    async decrypt(encrypted, masterPassword) {
        const key = await this.deriveKey(masterPassword);
        const iv = Buffer.from(encrypted.iv, 'hex');
        const authTag = Buffer.from(encrypted.authTag, 'hex');
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Verify master password is correct
     */
    async verifyMasterPassword(masterPassword) {
        try {
            // Try to derive key - if salt doesn't exist, vault isn't initialized
            await this.deriveKey(masterPassword);
            
            // If vault has any encrypted data, try to decrypt it to verify password
            if (await fs.pathExists(this.vaultFile)) {
                const vault = await fs.readJson(this.vaultFile);
                
                // If vault has clients with passphrases, try to decrypt one
                for (const clientId in vault.clients) {
                    for (const repoId in vault.clients[clientId].repositories) {
                        const repo = vault.clients[clientId].repositories[repoId];
                        if (repo.passphrase_encrypted) {
                            try {
                                await this.decrypt(repo.passphrase_encrypted, masterPassword);
                                return true; // Successfully decrypted, password is correct
                            } catch (err) {
                                return false; // Decryption failed, password is wrong
                            }
                        }
                    }
                }
            }
            
            // No encrypted data to verify against, password is valid if derivation worked
            return true;
        } catch (err) {
            console.error('Master password verification failed:', err.message);
            return false;
        }
    }

    /**
     * Store passphrase for a client's repository
     */
    async storePassphrase(clientId, repoId, repoName, repoPath, passphrase, masterPassword) {
        // Verify master password
        const isValid = await this.verifyMasterPassword(masterPassword);
        if (!isValid) {
            throw new Error('Invalid master password');
        }

        // Encrypt passphrase
        const encrypted = await this.encrypt(passphrase, masterPassword);

        // Load vault
        let vault = { clients: {} };
        if (await fs.pathExists(this.vaultFile)) {
            vault = await fs.readJson(this.vaultFile);
        }

        // Ensure client entry exists
        if (!vault.clients[clientId]) {
            vault.clients[clientId] = {
                client_id: clientId,
                repositories: {}
            };
        }

        // Store encrypted passphrase
        vault.clients[clientId].repositories[repoId] = {
            repo_id: repoId,
            name: repoName,
            path: repoPath,
            passphrase_encrypted: encrypted,
            stored_at: new Date().toISOString()
        };

        // Save vault
        await fs.writeJson(this.vaultFile, vault, { spaces: 2 });
        await fs.chmod(this.vaultFile, 0o600);

        console.log(`🔐 Stored passphrase for ${clientId}/${repoName} in vault`);
    }

    /**
     * Retrieve passphrase for a client's repository
     */
    async getPassphrase(clientId, repoId, masterPassword) {
        // Verify master password
        const isValid = await this.verifyMasterPassword(masterPassword);
        if (!isValid) {
            throw new Error('Invalid master password');
        }

        // Load vault
        if (!await fs.pathExists(this.vaultFile)) {
            throw new Error('Vault not found');
        }

        const vault = await fs.readJson(this.vaultFile);

        if (!vault.clients[clientId] || !vault.clients[clientId].repositories[repoId]) {
            throw new Error(`Passphrase not found for ${clientId}/${repoId}`);
        }

        const encrypted = vault.clients[clientId].repositories[repoId].passphrase_encrypted;
        return await this.decrypt(encrypted, masterPassword);
    }

    /**
     * Get all passphrases for a client
     */
    async getClientPassphrases(clientId, masterPassword) {
        // Verify master password
        const isValid = await this.verifyMasterPassword(masterPassword);
        if (!isValid) {
            throw new Error('Invalid master password');
        }

        // Load vault
        if (!await fs.pathExists(this.vaultFile)) {
            return [];
        }

        const vault = await fs.readJson(this.vaultFile);

        if (!vault.clients[clientId]) {
            return [];
        }

        const passphrases = [];
        for (const repoId in vault.clients[clientId].repositories) {
            const repo = vault.clients[clientId].repositories[repoId];
            const passphrase = await this.decrypt(repo.passphrase_encrypted, masterPassword);
            
            passphrases.push({
                repo_id: repo.repo_id,
                name: repo.name,
                path: repo.path,
                passphrase: passphrase,
                stored_at: repo.stored_at
            });
        }

        return passphrases;
    }

    /**
     * Get all clients and their repositories (without passphrases)
     */
    async getAllClients() {
        if (!await fs.pathExists(this.vaultFile)) {
            return [];
        }

        const vault = await fs.readJson(this.vaultFile);
        const clients = [];

        for (const clientId in vault.clients) {
            const client = vault.clients[clientId];
            const repositories = [];

            for (const repoId in client.repositories) {
                const repo = client.repositories[repoId];
                repositories.push({
                    repo_id: repo.repo_id,
                    name: repo.name,
                    path: repo.path,
                    stored_at: repo.stored_at,
                    has_passphrase: !!repo.passphrase_encrypted
                });
            }

            clients.push({
                client_id: clientId,
                repository_count: repositories.length,
                repositories: repositories
            });
        }

        return clients;
    }

    /**
     * Change master password (re-encrypts all passphrases)
     */
    async changeMasterPassword(oldPassword, newPassword) {
        if (!newPassword || newPassword.length < 8) {
            throw new Error('New master password must be at least 8 characters');
        }

        // Verify old password
        const isValid = await this.verifyMasterPassword(oldPassword);
        if (!isValid) {
            throw new Error('Invalid current master password');
        }

        // Load vault
        if (!await fs.pathExists(this.vaultFile)) {
            throw new Error('Vault not found');
        }

        const vault = await fs.readJson(this.vaultFile);

        // Decrypt all passphrases with old password and re-encrypt with new password
        for (const clientId in vault.clients) {
            for (const repoId in vault.clients[clientId].repositories) {
                const repo = vault.clients[clientId].repositories[repoId];
                
                if (repo.passphrase_encrypted) {
                    // Decrypt with old password
                    const passphrase = await this.decrypt(repo.passphrase_encrypted, oldPassword);
                    
                    // Re-encrypt with new password
                    repo.passphrase_encrypted = await this.encrypt(passphrase, newPassword);
                }
            }
        }

        // Generate new salt
        const newSalt = crypto.randomBytes(32);
        await fs.writeFile(this.saltFile, newSalt);
        await fs.chmod(this.saltFile, 0o600);

        // Save vault with re-encrypted data
        await fs.writeJson(this.vaultFile, vault, { spaces: 2 });
        await fs.chmod(this.vaultFile, 0o600);

        console.log('🔐 Master password changed and all passphrases re-encrypted');
    }

    /**
     * Delete a client's repository passphrase
     */
    async deletePassphrase(clientId, repoId) {
        if (!await fs.pathExists(this.vaultFile)) {
            throw new Error('Vault not found');
        }

        const vault = await fs.readJson(this.vaultFile);

        if (vault.clients[clientId] && vault.clients[clientId].repositories[repoId]) {
            delete vault.clients[clientId].repositories[repoId];
            
            // Remove client if no repositories left
            if (Object.keys(vault.clients[clientId].repositories).length === 0) {
                delete vault.clients[clientId];
            }

            await fs.writeJson(this.vaultFile, vault, { spaces: 2 });
            console.log(`🗑️  Deleted passphrase for ${clientId}/${repoId}`);
        }
    }

    /**
     * Delete all passphrases for a client
     */
    async deleteClient(clientId) {
        if (!await fs.pathExists(this.vaultFile)) {
            throw new Error('Vault not found');
        }

        const vault = await fs.readJson(this.vaultFile);

        if (vault.clients[clientId]) {
            delete vault.clients[clientId];
            await fs.writeJson(this.vaultFile, vault, { spaces: 2 });
            console.log(`🗑️  Deleted all passphrases for client ${clientId}`);
        }
    }
}

module.exports = new VaultManager();

