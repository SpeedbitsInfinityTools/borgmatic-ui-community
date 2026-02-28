const fs = require('fs-extra');
const path = require('path');
const yamlManager = require('./yaml-manager');
const crypto = require('crypto');
const config = require('../config');

/**
 * SSH Keys Service
 * Provides functions to retrieve SSH keys with decrypted private keys and passphrases
 */

/**
 * Decrypt private key using SECRET_KEY
 */
function decryptPrivateKey(encryptedPrivateKey) {
    try {
        // Use SECRET_KEY from config (which loads from env or file)
        const secretKey = config.secretKey || process.env.SECRET_KEY;
        if (!secretKey) {
            throw new Error('SECRET_KEY is required for decryption. Please set SECRET_KEY environment variable or ensure the secret key file exists.');
        }
        
        // Parse encrypted data: salt:iv:tag:encrypted
        const parts = encryptedPrivateKey.split(':');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted private key format');
        }
        
        const [saltHex, ivHex, tagHex, encrypted] = parts;
        
        // Validate hex string lengths
        if (saltHex.length !== 64 || ivHex.length !== 32 || tagHex.length !== 32) {
            throw new Error('Invalid encrypted private key format - invalid hex lengths');
        }
        
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        
        // Derive key using PBKDF2
        const key = crypto.pbkdf2Sync(secretKey, salt, 100000, 32, 'sha512');
        
        // Decrypt
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Failed to decrypt private key:', error.message);
        throw error;
    }
}

/**
 * Get SSH key by ID with decrypted private key and passphrase
 * @param {string} keyId - SSH key ID
 * @returns {Promise<Object|null>} SSH key with decrypted private_key and passphrase
 */
async function getSSHKey(keyId) {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'ssh-keys.yaml');
        if (!await fs.pathExists(dataPath)) {
            return null;
        }
        
        const data = await yamlManager.readYaml(dataPath);
        const sshKeys = data.ssh_keys || [];
        // Handle both string and number IDs (convert both to string for comparison)
        const keyIdStr = String(keyId);
        const sshKey = sshKeys.find(key => String(key.id) === keyIdStr);
        
        if (!sshKey) {
            return null;
        }
        
        // Decrypt private key
        const privateKey = decryptPrivateKey(sshKey.private_key);
        
        // Decrypt passphrase if present
        let passphrase = null;
        if (sshKey.is_encrypted && sshKey.passphrase_encrypted) {
            passphrase = decryptPrivateKey(sshKey.passphrase_encrypted);
        }
        
        return {
            id: sshKey.id,
            name: sshKey.name,
            description: sshKey.description,
            key_type: sshKey.key_type,
            public_key: sshKey.public_key,
            private_key: privateKey,
            is_encrypted: sshKey.is_encrypted || false,
            passphrase: passphrase,
            is_active: sshKey.is_active,
            created_at: sshKey.created_at,
            updated_at: sshKey.updated_at
        };
    } catch (error) {
        console.error('Failed to get SSH key:', error.message);
        throw error;
    }
}

module.exports = {
    getSSHKey
};

