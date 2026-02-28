const crypto = require('crypto');
const config = require('../config');

/**
 * Credential Encryption Service
 * Encrypts/decrypts sensitive credentials using SECRET_KEY
 */
class CredentialEncryption {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.secretKey = config.secretKey || process.env.SECRET_KEY || null;
        if (!this.secretKey) {
            throw new Error('SECRET_KEY is required for credential encryption');
        }
    }

    /**
     * Derive encryption key from SECRET_KEY
     */
    _getKey() {
        // Use SHA-256 to derive a 32-byte key from SECRET_KEY
        return crypto.createHash('sha256').update(this.secretKey).digest();
    }

    /**
     * Encrypt sensitive data
     * @param {string} plaintext - Data to encrypt
     * @returns {string} Encrypted data (iv:authTag:encrypted)
     */
    encrypt(plaintext) {
        if (!plaintext) return null;
        
        try {
            const key = this._getKey();
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const authTag = cipher.getAuthTag();
            
            // Return format: iv:authTag:encrypted (all hex)
            return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
        } catch (error) {
            console.error('Encryption error:', error.message);
            throw new Error('Failed to encrypt credential');
        }
    }

    /**
     * Decrypt sensitive data
     * @param {string} encryptedData - Encrypted data (iv:authTag:encrypted)
     * @returns {string} Decrypted plaintext
     */
    decrypt(encryptedData) {
        if (!encryptedData) return null;
        
        try {
            const parts = encryptedData.split(':');
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted data format');
            }
            
            const [ivHex, authTagHex, encryptedHex] = parts;
            const key = this._getKey();
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error.message);
            throw new Error('Failed to decrypt credential');
        }
    }

    /**
     * Encrypt SSH key
     */
    encryptSSHKey(privateKey) {
        return this.encrypt(privateKey);
    }

    /**
     * Decrypt SSH key
     */
    decryptSSHKey(encryptedKey) {
        return this.decrypt(encryptedKey);
    }

    /**
     * Encrypt S3 credentials
     */
    encryptS3Credentials(accessKey, secretKey) {
        return {
            access_key: this.encrypt(accessKey),
            secret_key: this.encrypt(secretKey)
        };
    }

    /**
     * Decrypt S3 credentials
     */
    decryptS3Credentials(encryptedAccessKey, encryptedSecretKey) {
        return {
            access_key: this.decrypt(encryptedAccessKey),
            secret_key: this.decrypt(encryptedSecretKey)
        };
    }
}

module.exports = new CredentialEncryption();

