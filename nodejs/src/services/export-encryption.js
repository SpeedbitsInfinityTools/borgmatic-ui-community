/**
 * Export Encryption Service
 * 
 * Handles encryption and decryption of configuration exports using:
 * - Node.js built-in scrypt for key derivation (memory-hard, no native modules)
 * - AES-256-GCM for authenticated encryption
 */

const crypto = require('crypto');

// Encryption parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const SALT_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// Scrypt parameters (OWASP recommendations for interactive logins)
// N=2^17 (131072), r=8, p=1 provides good security with reasonable performance
const SCRYPT_CONFIG = {
    N: 131072,   // CPU/memory cost parameter (2^17)
    r: 8,        // Block size
    p: 1,        // Parallelization parameter
    maxmem: 256 * 1024 * 1024, // 256 MB max memory
};

/**
 * Derive encryption key from password using scrypt
 */
function deriveKey(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            password,
            salt,
            KEY_LENGTH,
            {
                N: SCRYPT_CONFIG.N,
                r: SCRYPT_CONFIG.r,
                p: SCRYPT_CONFIG.p,
                maxmem: SCRYPT_CONFIG.maxmem,
            },
            (err, derivedKey) => {
                if (err) reject(err);
                else resolve(derivedKey);
            }
        );
    });
}

/**
 * Encrypt content with a master password
 * 
 * @param {string} content - The content to encrypt (usually YAML/JSON)
 * @param {string} masterPassword - User's master password
 * @returns {Object} Encrypted data with metadata
 */
async function encryptExport(content, masterPassword) {
    // Generate cryptographically secure random values
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from password
    const key = await deriveKey(masterPassword, salt);

    // Encrypt with AES-256-GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(content, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        version: '2.0',
        algorithm: ALGORITHM,
        kdf: 'scrypt',
        kdf_params: {
            N: SCRYPT_CONFIG.N,
            r: SCRYPT_CONFIG.r,
            p: SCRYPT_CONFIG.p,
        },
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        auth_tag: authTag.toString('base64'),
        payload: encrypted.toString('base64'),
    };
}

/**
 * Decrypt content with a master password
 * 
 * @param {Object} encryptedData - The encrypted data object
 * @param {string} masterPassword - User's master password
 * @returns {string} Decrypted content
 * @throws {Error} If decryption fails (wrong password or tampered data)
 */
async function decryptExport(encryptedData, masterPassword) {
    try {
        // Validate encrypted data structure
        if (!encryptedData.salt || !encryptedData.iv || !encryptedData.auth_tag || !encryptedData.payload) {
            throw new Error('Invalid encrypted data structure');
        }

        // Decode from base64
        const salt = Buffer.from(encryptedData.salt, 'base64');
        const iv = Buffer.from(encryptedData.iv, 'base64');
        const authTag = Buffer.from(encryptedData.auth_tag, 'base64');
        const payload = Buffer.from(encryptedData.payload, 'base64');

        // Get scrypt parameters from encrypted data or use defaults
        const kdfParams = encryptedData.kdf_params || SCRYPT_CONFIG;

        // Derive key from password
        const key = await new Promise((resolve, reject) => {
            crypto.scrypt(
                masterPassword,
                salt,
                KEY_LENGTH,
                {
                    N: kdfParams.N || SCRYPT_CONFIG.N,
                    r: kdfParams.r || SCRYPT_CONFIG.r,
                    p: kdfParams.p || SCRYPT_CONFIG.p,
                    maxmem: SCRYPT_CONFIG.maxmem,
                },
                (err, derivedKey) => {
                    if (err) reject(err);
                    else resolve(derivedKey);
                }
            );
        });

        // Decrypt with AES-256-GCM
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(payload);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (error) {
        if (error.message.includes('Unsupported state') ||
            error.message.includes('bad decrypt') ||
            error.code === 'ERR_CRYPTO_CIPHER_AUTH_TAG_FAILED') {
            throw new Error('Decryption failed: incorrect password or corrupted data');
        }
        throw error;
    }
}

/**
 * Check password strength
 * 
 * @param {string} password - Password to check
 * @returns {Object} Strength assessment
 */
function checkPasswordStrength(password) {
    let score = 0;
    const feedback = [];

    // Length check
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (password.length < 8) feedback.push('Use at least 8 characters');

    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;

    // Determine strength level
    let strength;
    if (score <= 2) {
        strength = 'weak';
    } else if (score <= 4) {
        strength = 'medium';
    } else if (score <= 6) {
        strength = 'strong';
    } else {
        strength = 'very_strong';
    }

    return {
        score,
        max_score: 7,
        strength,
        feedback,
        acceptable: score >= 4, // Minimum for encrypted exports
    };
}

module.exports = {
    encryptExport,
    decryptExport,
    checkPasswordStrength,
};
