const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const yamlManager = require('../services/yaml-manager');
const config = require('../config');

/**
 * SSH Keys Management Routes
 * Handles SSH key generation, storage, and management
 * Uses YAML-based storage instead of database
 */

/**
 * Get all SSH keys
 * GET /api/ssh-keys
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const sshKeys = await getSSHKeys();
        
        res.json({
            success: true,
            ssh_keys: sshKeys.map(key => ({
                id: key.id,
                name: key.name,
                description: key.description,
                key_type: key.key_type,
                public_key: key.public_key,
                is_encrypted: key.is_encrypted || false,
                is_active: key.is_active,
                created_at: key.created_at,
                updated_at: key.updated_at
            }))
        });
    } catch (error) {
        console.error('Failed to get SSH keys:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve SSH keys'
        });
    }
});

/**
 * Create a new SSH key
 * POST /api/ssh-keys
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, description, key_type, public_key, private_key: rawPrivateKey, passphrase } = req.body;

        if (!name || !rawPrivateKey) {
            return res.status(400).json({
                success: false,
                detail: 'Name and private_key are required'
            });
        }

        // Normalize at the boundary: any key written to disk downstream MUST end
        // with a newline or libcrypto fails. Doing it here means the stored
        // (encrypted) copy is already correct, so future decryptions are too.
        const { normalizePrivateKeyText } = require('../services/ssh-keys');
        const private_key = normalizePrivateKeyText(rawPrivateKey);

        // Check if SSH key name already exists
        const existingKeys = await getSSHKeys();
        if (existingKeys.some(key => key.name === name)) {
            return res.status(400).json({
                success: false,
                detail: 'SSH key name already exists'
            });
        }

        // Validate private key format
        if (!isValidPrivateKey(private_key)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid private key format. Supported formats: OpenSSH, PEM RSA, PEM EC, PKCS#8'
            });
        }

        // Extract public key from private key if not provided
        let extractedPublicKey = public_key;
        let detectedKeyType = key_type;
        let isEncrypted = false;
        
        if (!extractedPublicKey) {
            try {
                // First, try without passphrase to detect if encrypted
                const extractionResult = await extractPublicKeyFromPrivate(private_key);
                extractedPublicKey = extractionResult.publicKey;
                detectedKeyType = extractionResult.keyType;
                console.log(`✅ Extracted public key from private key. Detected type: ${detectedKeyType}`);
            } catch (extractError) {
                // Check if key is encrypted (passphrase-protected)
                if (extractError.message && (extractError.message.includes('passphrase') || extractError.message.includes('encrypted'))) {
                    isEncrypted = true;
                    
                    // If passphrase provided, try extraction with passphrase
                    if (passphrase && passphrase.trim().length > 0) {
                        try {
                            const extractionResult = await extractPublicKeyFromPrivate(private_key, passphrase);
                            extractedPublicKey = extractionResult.publicKey;
                            detectedKeyType = extractionResult.keyType;
                            console.log(`✅ Extracted public key from encrypted private key using provided passphrase. Detected type: ${detectedKeyType}`);
                        } catch (passphraseError) {
                            return res.status(400).json({
                                success: false,
                                detail: `Failed to extract public key with provided passphrase: ${passphraseError.message}. Please verify the passphrase is correct.`
                            });
                        }
                    } else {
                        // Key is encrypted but no passphrase provided
                        return res.status(400).json({
                            success: false,
                            detail: 'Private key is encrypted with a passphrase. Please provide the passphrase to continue.',
                            requires_passphrase: true
                        });
                    }
                } else {
                    return res.status(400).json({
                        success: false,
                        detail: `Failed to extract public key from private key: ${extractError.message}. Please provide the public key separately.`
                    });
                }
            }
        }

        // Validate extracted/provided public key format
        if (!extractedPublicKey || !extractedPublicKey.trim()) {
            return res.status(400).json({
                success: false,
                detail: 'Failed to extract public key from private key. Please provide the public key manually or ensure the private key is valid.'
            });
        }
        
        if (!isValidPublicKey(extractedPublicKey)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid public key format. If you provided a public key, please check its format. Otherwise, the extracted public key is invalid.'
            });
        }

        // If public key was provided, validate it matches the private key
        if (public_key) {
            try {
                // Try to extract from private key (use passphrase if key is encrypted)
                let extractedFromPrivate;
                if (isEncrypted && passphrase) {
                    extractedFromPrivate = await extractPublicKeyFromPrivate(private_key, passphrase);
                } else {
                    extractedFromPrivate = await extractPublicKeyFromPrivate(private_key);
                }
                
                if (extractedFromPrivate.publicKey.trim() !== public_key.trim()) {
                    return res.status(400).json({
                        success: false,
                        detail: 'Provided public key does not match the private key. The public key will be extracted automatically from the private key.'
                    });
                }
                // Use provided key type if it matches, otherwise use detected
                if (key_type && key_type !== extractedFromPrivate.keyType) {
                    console.warn(`⚠️  Provided key_type (${key_type}) doesn't match detected type (${extractedFromPrivate.keyType}). Using detected type.`);
                }
                detectedKeyType = extractedFromPrivate.keyType;
            } catch (matchError) {
                // If extraction fails but public key was provided, warn but continue
                // This can happen if key is encrypted and no passphrase provided, or other issues
                console.warn(`⚠️  Could not verify public key matches private key: ${matchError.message}`);
                // If we already extracted a public key above, use that instead
                if (!extractedPublicKey) {
                    // If we couldn't extract and no public key was extracted above, this is an error
                    return res.status(400).json({
                        success: false,
                        detail: `Could not verify public key: ${matchError.message}. Please ensure the public key matches the private key.`
                    });
                }
            }
        }

        // Use detected key type if not provided
        if (!detectedKeyType) {
            detectedKeyType = detectKeyTypeFromPublicKey(extractedPublicKey);
        }

        // Encrypt private key
        const encryptedPrivateKey = encryptPrivateKey(private_key);
        
        // Encrypt passphrase if provided
        let encryptedPassphrase = null;
        if (isEncrypted && passphrase && passphrase.trim().length > 0) {
            encryptedPassphrase = encryptPrivateKey(passphrase);
            console.log(`🔐 Encrypted passphrase stored for SSH key: ${name}`);
        }

        // Create SSH key record
        const sshKey = {
            id: uuidv4(),
            name: name,
            description: description || null,
            key_type: detectedKeyType,
            public_key: extractedPublicKey,
            private_key: encryptedPrivateKey,
            is_encrypted: isEncrypted,
            passphrase_encrypted: encryptedPassphrase, // Encrypted passphrase if key is encrypted
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: null
        };

        // Add to storage
        existingKeys.push(sshKey);
        await saveSSHKeys(existingKeys);

        console.log(`SSH key created: ${name} (type: ${detectedKeyType}) by user ${req.user.username}`);
        if (!public_key) {
            console.log(`   ✓ Public key extracted automatically from private key`);
        }

        res.status(201).json({
            success: true,
            message: `SSH key created successfully${!public_key ? ' (public key extracted automatically)' : ''}`,
            ssh_key: {
                id: sshKey.id,
                name: sshKey.name,
                description: sshKey.description,
                key_type: sshKey.key_type,
                public_key: sshKey.public_key,
                is_active: sshKey.is_active
            }
        });
    } catch (error) {
        console.error('Failed to create SSH key:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            detail: `Failed to create SSH key: ${error.message}`,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * Generate a new SSH key pair
 * POST /api/ssh-keys/generate
 */
router.post('/generate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, key_type = 'rsa', description } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                detail: 'Name is required'
            });
        }

        // Check if SSH key name already exists
        const existingKeys = await getSSHKeys();
        if (existingKeys.some(key => key.name === name)) {
            return res.status(400).json({
                success: false,
                detail: 'SSH key name already exists'
            });
        }

        // Validate key type
        const validTypes = ['rsa', 'ed25519', 'ecdsa'];
        if (!validTypes.includes(key_type)) {
            return res.status(400).json({
                success: false,
                detail: `Invalid key type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Generate SSH key pair
        const keyResult = await generateSSHKeyPair(key_type);
        
        if (!keyResult.success) {
            return res.status(500).json({
                success: false,
                detail: `Failed to generate SSH key: ${keyResult.error}`
            });
        }

        // Encrypt private key
        const encryptedPrivateKey = encryptPrivateKey(keyResult.private_key);

        // Create SSH key record
        const sshKey = {
            id: uuidv4(),
            name: name,
            description: description || null,
            key_type: key_type,
            public_key: keyResult.public_key,
            private_key: encryptedPrivateKey,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: null
        };

        // Add to storage
        existingKeys.push(sshKey);
        await saveSSHKeys(existingKeys);

        console.log(`SSH key generated: ${name} (${key_type}) by user ${req.user.username}`);

        res.status(201).json({
            success: true,
            message: 'SSH key generated successfully',
            ssh_key: {
                id: sshKey.id,
                name: sshKey.name,
                description: sshKey.description,
                key_type: sshKey.key_type,
                public_key: sshKey.public_key,
                is_active: sshKey.is_active
            }
        });
    } catch (error) {
        console.error('Failed to generate SSH key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to generate SSH key'
        });
    }
});

/**
 * Get SSH key details
 * GET /api/ssh-keys/:keyId
 */
router.get('/:keyId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { keyId } = req.params;
        
        // Validate keyId to prevent path traversal
        if (!isValidKeyId(keyId)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid key ID format'
            });
        }
        
        const sshKeys = await getSSHKeys();
        const sshKey = sshKeys.find(key => key.id === keyId);

        if (!sshKey) {
            return res.status(404).json({
                success: false,
                detail: 'SSH key not found'
            });
        }

        res.json({
            success: true,
            ssh_key: {
                id: sshKey.id,
                name: sshKey.name,
                description: sshKey.description,
                key_type: sshKey.key_type,
                public_key: sshKey.public_key,
                is_encrypted: sshKey.is_encrypted || false,
                is_active: sshKey.is_active,
                created_at: sshKey.created_at,
                updated_at: sshKey.updated_at
            }
        });
    } catch (error) {
        console.error('Failed to get SSH key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve SSH key'
        });
    }
});

/**
 * Update SSH key
 * PUT /api/ssh-keys/:keyId
 */
router.put('/:keyId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { keyId } = req.params;
        
        // Validate keyId to prevent path traversal
        if (!isValidKeyId(keyId)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid key ID format'
            });
        }
        
        const { name, description, is_active } = req.body;

        const sshKeys = await getSSHKeys();
        const sshKeyIndex = sshKeys.findIndex(key => key.id === keyId);

        if (sshKeyIndex === -1) {
            return res.status(404).json({
                success: false,
                detail: 'SSH key not found'
            });
        }

        const sshKey = sshKeys[sshKeyIndex];

        // Update fields
        if (name !== undefined) {
            // Check if name already exists
            if (sshKeys.some(key => key.name === name && key.id !== keyId)) {
                return res.status(400).json({
                    success: false,
                    detail: 'SSH key name already exists'
                });
            }
            sshKey.name = name;
        }

        if (description !== undefined) {
            sshKey.description = description;
        }

        if (is_active !== undefined) {
            sshKey.is_active = is_active;
        }

        sshKey.updated_at = new Date().toISOString();

        // Save updated keys
        await saveSSHKeys(sshKeys);

        console.log(`SSH key updated: ${keyId} by user ${req.user.username}`);

        res.json({
            success: true,
            message: 'SSH key updated successfully'
        });
    } catch (error) {
        console.error('Failed to update SSH key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update SSH key'
        });
    }
});

/**
 * Delete SSH key
 * DELETE /api/ssh-keys/:keyId
 */
router.delete('/:keyId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { keyId } = req.params;
        
        // Validate keyId to prevent path traversal
        if (!isValidKeyId(keyId)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid key ID format'
            });
        }
        
        const sshKeys = await getSSHKeys();
        const sshKeyIndex = sshKeys.findIndex(key => key.id === keyId);

        if (sshKeyIndex === -1) {
            return res.status(404).json({
                success: false,
                detail: 'SSH key not found'
            });
        }

        const sshKey = sshKeys[sshKeyIndex];

        // Check if SSH key is used by any repositories
        const isUsed = await checkSSHKeyUsage(keyId);
        if (isUsed) {
            return res.status(400).json({
                success: false,
                detail: 'Cannot delete SSH key that is used by repositories. Please remove or update repositories first.'
            });
        }

        // Remove SSH key
        sshKeys.splice(sshKeyIndex, 1);
        await saveSSHKeys(sshKeys);

        console.log(`SSH key deleted: ${keyId} by user ${req.user.username}`);

        res.json({
            success: true,
            message: 'SSH key deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete SSH key:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to delete SSH key'
        });
    }
});

/**
 * Test SSH connection with the specified key
 * POST /api/ssh-keys/:keyId/test-connection
 */
router.post('/:keyId/test-connection', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { keyId } = req.params;
        const { host, username, port = 22 } = req.body;

        if (!host || !username) {
            return res.status(400).json({
                success: false,
                detail: 'Host and username are required'
            });
        }

        // Validate and sanitize input parameters
        if (!isValidHostname(host)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid hostname format'
            });
        }

        if (!isValidUsername(username)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid username format'
            });
        }

        if (!isValidPort(port)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid port number'
            });
        }

        // Validate keyId to prevent path traversal
        if (!isValidKeyId(keyId)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid key ID format'
            });
        }

        // Additional security checks for command injection
        if (containsShellMetacharacters(host) || containsShellMetacharacters(username)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid characters in host or username'
            });
        }

        const sshKeys = await getSSHKeys();
        const sshKey = sshKeys.find(key => key.id === keyId);

        if (!sshKey) {
            return res.status(404).json({
                success: false,
                detail: 'SSH key not found'
            });
        }

        // Test SSH connection
        const testResult = await testSSHKeyConnection(sshKey, host, username, port);

        res.json({
            success: true,
            connection_test: testResult
        });
    } catch (error) {
        console.error('Failed to test SSH connection:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to test SSH connection'
        });
    }
});

/**
 * Check if SSH key is encrypted
 * POST /api/ssh-keys/check-encryption
 */
router.post('/check-encryption', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { private_key } = req.body;
        
        if (!private_key) {
            return res.status(400).json({
                success: false,
                detail: 'Private key is required'
            });
        }

        // Validate private key format
        if (!isValidPrivateKey(private_key)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid private key format'
            });
        }

        // Try to extract public key without passphrase
        try {
            await extractPublicKeyFromPrivate(private_key);
            // If successful, key is not encrypted
            res.json({
                success: true,
                requires_passphrase: false
            });
        } catch (extractError) {
            // Check if error indicates encryption
            if (extractError.message && (extractError.message.includes('passphrase') || extractError.message.includes('encrypted'))) {
                res.json({
                    success: true,
                    requires_passphrase: true
                });
            } else {
                res.status(400).json({
                    success: false,
                    detail: `Failed to check encryption: ${extractError.message}`
                });
            }
        }
    } catch (error) {
        console.error('Failed to check encryption:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to check encryption'
        });
    }
});

/**
 * Get SSH key types
 * GET /api/ssh-keys/types
 */
router.get('/types', authenticateToken, (req, res) => {
    res.json({
        success: true,
        key_types: [
            {
                type: 'rsa',
                name: 'RSA',
                description: 'RSA key (recommended for compatibility)',
                default_bits: 4096
            },
            {
                type: 'ed25519',
                name: 'Ed25519',
                description: 'Ed25519 key (recommended for security)',
                default_bits: 256
            },
            {
                type: 'ecdsa',
                name: 'ECDSA',
                description: 'ECDSA key (good balance of security and compatibility)',
                default_bits: 521
            }
        ]
    });
});

/**
 * Get SSH keys from YAML storage
 */
async function getSSHKeys() {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'ssh-keys.yaml');
        if (await fs.pathExists(dataPath)) {
            const data = await yamlManager.readYaml(dataPath);
            return data.ssh_keys || [];
        }
        return [];
    } catch (error) {
        console.error('Failed to load SSH keys:', error.message);
        return [];
    }
}

/**
 * Save SSH keys to YAML storage
 */
async function saveSSHKeys(sshKeys) {
    try {
        const dataDir = path.join(process.cwd(), 'data');
        await fs.ensureDir(dataDir);
        
        const dataPath = path.join(dataDir, 'ssh-keys.yaml');
        const data = { ssh_keys: sshKeys };
        
        await yamlManager.writeYaml(dataPath, data);
    } catch (error) {
        console.error('Failed to save SSH keys:', error.message);
        throw error;
    }
}

/**
 * Encrypt private key
 */
function encryptPrivateKey(privateKey) {
    try {
        // Use SECRET_KEY from config (which loads from env or file)
        const secretKey = config.secretKey || process.env.SECRET_KEY;
        if (!secretKey) {
            throw new Error('SECRET_KEY is required for encryption. Please set SECRET_KEY environment variable or ensure the secret key file exists.');
        }
        
        // Generate random salt for each encryption
        const salt = crypto.randomBytes(32);
        
        // Derive key using PBKDF2 with random salt
        const key = crypto.pbkdf2Sync(secretKey, salt, 100000, 32, 'sha512');
        
        // Generate random IV
        const iv = crypto.randomBytes(16);
        
        // Use secure cipher with proper IV
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Get authentication tag
        const tag = cipher.getAuthTag();
        
        // Return: salt:iv:tag:encrypted
        return salt.toString('hex') + ':' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Failed to encrypt private key:', error.message);
        throw error;
    }
}

/**
 * Decrypt private key
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
        
        // Validate hex string lengths to prevent buffer overflow
        if (saltHex.length !== 64 || ivHex.length !== 32 || tagHex.length !== 32) {
            throw new Error('Invalid encrypted private key format - invalid hex lengths');
        }
        
        // Validate hex string format
        if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(tagHex)) {
            throw new Error('Invalid encrypted private key format - invalid hex characters');
        }
        
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        
        // Derive key using same parameters as encryption
        const key = crypto.pbkdf2Sync(secretKey, salt, 100000, 32, 'sha512');
        
        // Create decipher with authentication
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
 * Generate SSH key pair using ssh-keygen
 */
async function generateSSHKeyPair(keyType) {
    let tempDir = null;
    
    try {
        // Create secure temporary directory
        tempDir = await fs.mkdtemp(path.join(process.cwd(), 'ssh-gen-'));
        const keyFile = path.join(tempDir, `id_${keyType}`);
        
        // Build ssh-keygen command with secure options
        const cmd = [
            'ssh-keygen', 
            '-t', keyType, 
            '-f', keyFile, 
            '-N', '',  // No passphrase
            '-C', 'borgmatic-ui-generated'  // Comment
        ];
        
        // Execute command
        const result = await execa(cmd[0], cmd.slice(1), { timeout: 30000 });
        
        if (!result.success) {
            return {
                success: false,
                error: result.stderr || 'Unknown error'
            };
        }
        
        // Read generated keys
        const publicKey = await fs.readFile(`${keyFile}.pub`, 'utf8');
        const privateKey = await fs.readFile(keyFile, 'utf8');
        
        return {
            success: true,
            public_key: publicKey.trim(),
            private_key: privateKey.trim()
        };
    } catch (error) {
        console.error('Failed to generate SSH key pair:', error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Secure cleanup of temporary files
        if (tempDir) {
            await secureCleanup(tempDir);
        }
    }
}

/**
 * Hetzner Storage Boxes don't expose a normal shell — they answer SSH commands
 * with a restricted command interpreter (no `echo`, no `bash`, etc.) and abort
 * with "Command not found. Use 'help' to get a list of available commands."
 * which is exit code 8.
 *
 * We detect Hetzner from the standard hostname pattern + port 23, or fall back
 * to recognizing the response text after the command runs (so corporate
 * jump hosts and other restricted shells also get a meaningful result).
 */
function looksLikeHetznerStorageBox(host, port) {
    if (!host) return false;
    // Avoid false positives: port 23 alone is not enough (users can run normal
    // SSH daemons on custom ports). Prefer hostname pattern checks.
    return /\.your-storagebox\.de$/i.test(host) || /storagebox/i.test(host);
}

function looksLikeRestrictedShellResponse(text) {
    if (!text) return false;
    return (
        /Command not found\./i.test(text) ||
        /Use 'help' to get a list of available commands/i.test(text) ||
        /This service allows sftp connections only/i.test(text)
    );
}

/**
 * Build an actionable hint for an SSH/SFTP test failure, especially for
 * Hetzner Storage Boxes where exit code 255 carries no useful info on its own.
 * Returns null if there's nothing useful to add.
 */
function buildHetznerSSHHint({ host, port, exitCode, stderr, isHetzner }) {
    const err = String(stderr || '');
    const lines = [];

    if (/Permission denied/i.test(err)) {
        lines.push(
            '• The server rejected the SSH key — make sure THIS exact public key is installed on the target.',
        );
        if (isHetzner) {
            lines.push(
                "  For Hetzner Storage Boxes the public key must be uploaded via the Robot UI (Storagebox → 'SSH-Keys') or via:",
                '    cat key.pub | ssh -p23 user@host install-ssh-key',
            );
        }
    }

    if (/Connection timed out/i.test(err) || /No route to host/i.test(err)) {
        lines.push(
            '• Could not reach the host — verify outbound TCP is open from this server',
            isHetzner
                ? `    (Hetzner Storage Boxes listen on ports 22 and 23; some firewalls block 23.)`
                : `    (default SSH port 22).`,
        );
    }

    if (/Could not resolve hostname/i.test(err)) {
        lines.push(`• DNS lookup for "${host}" failed from this server.`);
    }

    if (/Host key verification failed/i.test(err)) {
        lines.push('• Host key changed — remove the stale entry from your known_hosts and retry.');
    }

    if (/no matching .* found/i.test(err) || /no mutual signature algorithm/i.test(err)) {
        lines.push(
            '• Older host/key algorithm required by the server. If this is a Hetzner Storage Box,',
            '  retry from a host with a more recent OpenSSH or add legacy algorithms to /etc/ssh/ssh_config.',
        );
    }

    // Fallback explanation for the bare "exit code 255" case.
    if (lines.length === 0 && Number(exitCode) === 255) {
        if (isHetzner) {
            lines.push(
                'Exit code 255 from ssh/sftp means the connection itself failed before login — common causes for Hetzner:',
                '  • The public key is not registered on this Storagebox',
                '  • Outbound TCP to port 23 is blocked from this server',
                '  • A required host or key algorithm is disabled in the local sshd/ssh_config',
                'Run the same command from this server with `-vvv` to see exactly which step fails.',
            );
        } else {
            lines.push(
                'Exit code 255 means SSH could not establish a session. Run with `-vvv` from this server to diagnose.',
            );
        }
    }

    return lines.length ? lines.join('\n') : null;
}

/**
 * Test SSH connection using the specified key
 */
async function testSSHKeyConnection(sshKey, host, username, port) {
    let tempDir = null;

    try {
        // Decrypt private key
        const privateKey = decryptPrivateKey(sshKey.private_key);

        // Decrypt passphrase if key is encrypted
        let passphrase = null;
        if (sshKey.is_encrypted && sshKey.passphrase_encrypted) {
            passphrase = decryptPrivateKey(sshKey.passphrase_encrypted);
        }

        // Create secure temporary key file
        const { tempDir: dir, tempFile } = await createSecureTempFile(privateKey, 'ssh-test-');
        tempDir = dir;

        const isHetzner = looksLikeHetznerStorageBox(host, port);
        const parsedPort = Number(port);
        const effectivePort = Number.isFinite(parsedPort) && parsedPort > 0
            ? parsedPort
            : (isHetzner ? 23 : 22);

        // For Hetzner Storage Boxes the only reliable test is via SFTP — they
        // reject any shell command. For everything else we run a cheap `echo`
        // over a regular SSH session and additionally probe for borg.
        const cmd = isHetzner
            ? [
                'sftp',
                '-i', tempFile,
                '-oStrictHostKeyChecking=accept-new',
                '-oConnectTimeout=10',
                '-oUserKnownHostsFile=/dev/null',
                '-oBatchMode=no',
                '-P', effectivePort.toString(),
                `${username}@${host}`,
            ]
            : [
                'ssh', '-i', tempFile,
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'LogLevel=ERROR',
                '-p', effectivePort.toString(),
                `${username}@${host}`,
                'echo "SSH connection successful"',
            ];
        
        // If key is encrypted, we need to provide the passphrase
        // BatchMode=yes prevents passphrase prompts, so we remove it for encrypted keys
        // Instead, we'll use sshpass if available, or expect script
        const env = { ...process.env };
        let useSshpass = false;

        if (passphrase) {
            // Check if sshpass is available for encrypted keys
            try {
                await execa('which', ['sshpass'], { timeout: 2000 });
                useSshpass = true;
            } catch {
                // sshpass not available, will try SSH_ASKPASS as fallback
                useSshpass = false;
            }

            if (useSshpass) {
                // Use sshpass with passphrase flag (-P) for encrypted keys
                // sshpass -P prompts for passphrase, but we can use -e with env var
                // However, sshpass -P reads from stdin, so we'll use expect-like approach
                // Actually, sshpass -p 'pass' works but exposes password in process list
                // Better: use SSHPASS env var with sshpass -e
                env.SSHPASS = passphrase;
                // Prepend sshpass -e to command
                cmd.unshift('-e');
                cmd.unshift('sshpass');
            } else {
                // Fallback: Use SSH_ASKPASS (less reliable in non-interactive environments)
                const askpassScript = path.join(dir, 'askpass.sh');
                await fs.writeFile(askpassScript, `#!/bin/sh\necho "${passphrase.replace(/"/g, '\\"')}"\n`, { mode: 0o700 });
                env.SSH_ASKPASS = askpassScript;
                env.DISPLAY = ':0'; // Required for SSH_ASKPASS
                env.SSH_ASKPASS_REQUIRE = 'force'; // Force use of SSH_ASKPASS
                // Remove BatchMode for encrypted keys to allow passphrase prompt
            }
        } else if (!isHetzner) {
            // For non-encrypted keys, use BatchMode=yes for faster failure.
            // SFTP uses different option syntax (-oFoo=Bar), so we only inject
            // BatchMode for the SSH path; SFTP gets BatchMode=no in its initial
            // option list (it shouldn't prompt anyway).
            cmd.splice(3, 0, '-o', 'BatchMode=yes');
        }

        // Additional security: validate final command construction
        const targetHost = `${username}@${host}`;
        if (containsShellMetacharacters(targetHost)) {
            throw new Error('Invalid characters detected in host/username combination');
        }

        // For SFTP we can't pass an inline command — feed `pwd\nbye\n` via stdin.
        // We use reject: false so a Hetzner restricted shell exit code doesn't
        // throw before we can inspect the actual response.
        const execOpts = { timeout: 15000, env, reject: false };
        if (isHetzner) execOpts.input = 'pwd\nbye\n';
        const result = await execa(cmd[0], cmd.slice(1), execOpts);

        const output = (result.stdout || '').trim();
        const stderr = (result.stderr || '').trim();
        const exitCode = result.exitCode ?? 0;

        // Restricted-shell servers (Hetzner Storage Box, some jump hosts) reply
        // with "Command not found. Use 'help' to ..." when we run `echo`. That
        // means *authentication succeeded* — it's the remote shell rejecting the
        // test command, not the SSH transport failing. Treat it as success.
        const restrictedShell = !isHetzner && (
            looksLikeRestrictedShellResponse(stderr) ||
            looksLikeRestrictedShellResponse(output)
        );

        if (exitCode === 0 || restrictedShell) {
            // SSH connection successful. For Hetzner / restricted shells we can't
            // probe borg over the wire; report success and let the caller decide.
            let borgCheck;

            if (isHetzner) {
                borgCheck = {
                    installed: true,
                    version: 'Hetzner pre-installed (borg-1.1, borg-1.2, borg-1.4)',
                    error: null,
                };
            } else if (restrictedShell) {
                borgCheck = {
                    installed: false,
                    version: null,
                    error: 'Authentication succeeded but the remote shell is restricted — borg cannot be probed.',
                };
            } else {
                borgCheck = { installed: false, version: null, error: null };
                try {
                    // Build borg check command (same SSH setup)
                    const borgCmd = [...cmd]; // Copy the command
                    // Replace the echo command with borg version check
                    borgCmd[borgCmd.length - 1] = 'borg --version 2>/dev/null || echo "BORG_NOT_FOUND"';

                    const borgResult = await execa(borgCmd[0], borgCmd.slice(1), { timeout: 15000, env });
                    const borgOutput = borgResult.stdout?.trim() || '';

                    if (borgOutput.includes('BORG_NOT_FOUND') || borgOutput === '') {
                        borgCheck = {
                            installed: false,
                            version: null,
                            error: 'Borg is not installed on the remote server. Install with: apt install borgbackup'
                        };
                    } else if (borgOutput.toLowerCase().includes('borg')) {
                        borgCheck = {
                            installed: true,
                            version: borgOutput,
                            error: null
                        };
                    } else {
                        borgCheck = {
                            installed: false,
                            version: null,
                            error: 'Could not determine borg status'
                        };
                    }
                } catch (borgError) {
                    borgCheck = {
                        installed: false,
                        version: null,
                        error: `Failed to check borg: ${borgError.message}`
                    };
                }
            }
            
            const message = isHetzner
                ? 'Hetzner Storage Box connection successful (SFTP)'
                : restrictedShell
                  ? "Authentication succeeded — but the remote refuses shell commands (restricted shell). For Hetzner Storage Boxes, configure the repository as type 'Hetzner'."
                  : 'SSH connection successful';

            return {
                success: true,
                message,
                output: output || 'Connection established successfully',
                borg: borgCheck,
                hetzner: isHetzner || undefined,
                restricted_shell: restrictedShell || undefined,
            };
        } else {
            // Build a helpful error for common failure modes — especially for
            // Hetzner Storage Boxes where exit code 255 from sftp/ssh tells us
            // almost nothing on its own.
            const rawError = stderr || output || 'SSH connection failed';
            const hint = buildHetznerSSHHint({
                host,
                port: effectivePort,
                exitCode,
                stderr,
                isHetzner,
            });
            return {
                success: false,
                error: hint ? `${rawError}\n\n${hint}` : rawError,
                return_code: exitCode,
            };
        }
    } catch (error) {
        console.error('Failed to test SSH connection:', error.message);
        console.error('SSH error details:', {
            message: error.message,
            stderr: error.stderr,
            stdout: error.stdout,
            exitCode: error.exitCode
        });
        const isHetzner = looksLikeHetznerStorageBox(host, port);
        const parsedPort = Number(port);
        const effectivePort = Number.isFinite(parsedPort) && parsedPort > 0
            ? parsedPort
            : (isHetzner ? 23 : 22);
        const hint = buildHetznerSSHHint({
            host,
            port: effectivePort,
            exitCode: error.exitCode,
            stderr: error.stderr,
            isHetzner,
        });
        const baseError = error.stderr || error.message || 'SSH connection failed';
        return {
            success: false,
            error: hint ? `${baseError}\n\n${hint}` : baseError,
            return_code: error.exitCode || -1,
            details: error.stdout || ''
        };
    } finally {
        // Secure cleanup of temporary files
        if (tempDir) {
            await secureCleanup(tempDir);
        }
    }
}

/**
 * Check if SSH key is used by any repositories
 */
async function checkSSHKeyUsage(keyId) {
    try {
        // This would check if the SSH key is referenced in any repository configurations
        // For now, we'll implement a simple check
        const borgmaticConfig = require('../services/borgmatic-config');
        const config = await borgmaticConfig.loadConfig();
        
        // Check if key is used in any repository SSH configurations
        // Support both new flat format and old nested format
        const repositories = config.repositories || config.location?.repositories || [];
        for (const repo of repositories) {
            if (repo.ssh_key_id === keyId) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('Failed to check SSH key usage:', error.message);
        return false;
    }
}

/**
 * Validate SSH public key format
 */
function isValidPublicKey(publicKey) {
    // Check for valid SSH public key formats
    const validFormats = [
        /^ssh-rsa\s+[A-Za-z0-9+/]+=*\s*.*$/,
        /^ssh-ed25519\s+[A-Za-z0-9+/]+=*\s*.*$/,
        /^ecdsa-sha2-nistp256\s+[A-Za-z0-9+/]+=*\s*.*$/,
        /^ecdsa-sha2-nistp384\s+[A-Za-z0-9+/]+=*\s*.*$/,
        /^ecdsa-sha2-nistp521\s+[A-Za-z0-9+/]+=*\s*.*$/
    ];
    
    return validFormats.some(format => format.test(publicKey.trim()));
}

/**
 * Validate SSH private key format
 */
function isValidPrivateKey(privateKey) {
    // Check for valid SSH private key headers
    const validHeaders = [
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        '-----BEGIN RSA PRIVATE KEY-----',
        '-----BEGIN EC PRIVATE KEY-----',
        '-----BEGIN PRIVATE KEY-----'
    ];
    
    const trimmed = privateKey.trim();
    return validHeaders.some(header => trimmed.startsWith(header));
}

/**
 * Extract public key from private key using ssh-keygen
 * @param {string} privateKey - Private key content
 * @param {string} passphrase - Optional passphrase for encrypted keys
 * @returns {Promise<{publicKey: string, keyType: string}>} Extracted public key and detected key type
 */
async function extractPublicKeyFromPrivate(privateKey, passphrase = null) {
    const fs = require('fs-extra');
    const path = require('path');
    const { execa } = require('execa');
    const os = require('os');
    const { normalizePrivateKeyText } = require('../services/ssh-keys');

    // Create temporary file for private key
    const tempDir = os.tmpdir();
    const tempKeyFile = path.join(tempDir, `ssh-extract-${Date.now()}-${Math.random().toString(36).substring(7)}`);

    try {
        // Write private key to temp file with secure permissions. ALWAYS normalize
        // first: ssh-keygen / libcrypto require a trailing newline after the
        // -----END ... KEY----- line and silently fail with
        //   `error in libcrypto`
        // otherwise. Short ed25519 keys are especially prone to losing it through
        // textarea / JSON / trim() boundaries.
        await fs.writeFile(tempKeyFile, normalizePrivateKeyText(privateKey), { mode: 0o600 });
        
        // Extract public key using ssh-keygen -y
        // -y: Read a private OpenSSH format file and print an OpenSSH public key to stdout
        // -P: Provide passphrase (if key is encrypted)
        let publicKey;
        try {
            const sshKeygenArgs = ['-y', '-f', tempKeyFile];
            const execOptions = {
                timeout: 10000
            };
            
            // If passphrase provided, use it via stdin
            if (passphrase) {
                // ssh-keygen -y reads passphrase from stdin when key is encrypted
                // Use input option to pass passphrase securely
                const { stdout } = await execa('ssh-keygen', sshKeygenArgs, {
                    ...execOptions,
                    input: passphrase + '\n'
                });
                publicKey = stdout.trim();
            } else {
                // Try without passphrase first
                const { stdout } = await execa('ssh-keygen', sshKeygenArgs, execOptions);
                publicKey = stdout.trim();
            }
        } catch (extractError) {
            // Check for common error messages
            const errorMsg = extractError.stderr || extractError.message || '';
            if ((errorMsg.includes('passphrase') || errorMsg.includes('encrypted') || errorMsg.includes('incorrect passphrase')) && !passphrase) {
                throw new Error('Private key is encrypted with a passphrase');
            }
            if (errorMsg.includes('incorrect passphrase') && passphrase) {
                throw new Error('Incorrect passphrase provided');
            }
            if (errorMsg.includes('invalid format') || errorMsg.includes('not a private key')) {
                throw new Error('Invalid private key format');
            }
            throw new Error(`Failed to extract public key: ${errorMsg}`);
        }
        
        // Detect key type from public key
        const keyType = detectKeyTypeFromPublicKey(publicKey);
        
        return {
            publicKey: publicKey,
            keyType: keyType
        };
    } finally {
        // Always clean up temp file
        try {
            await fs.remove(tempKeyFile);
        } catch (cleanupError) {
            console.warn(`⚠️  Failed to cleanup temp key file ${tempKeyFile}:`, cleanupError.message);
        }
    }
}

/**
 * Detect key type from public key string
 * @param {string} publicKey - Public key content (e.g., "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5...")
 * @returns {string} Key type (rsa, ed25519, ecdsa)
 */
function detectKeyTypeFromPublicKey(publicKey) {
    const trimmed = publicKey.trim();
    
    if (trimmed.startsWith('ssh-rsa')) {
        return 'rsa';
    } else if (trimmed.startsWith('ssh-ed25519')) {
        return 'ed25519';
    } else if (trimmed.startsWith('ecdsa-sha2-nistp256')) {
        return 'ecdsa';
    } else if (trimmed.startsWith('ecdsa-sha2-nistp384')) {
        return 'ecdsa';
    } else if (trimmed.startsWith('ecdsa-sha2-nistp521')) {
        return 'ecdsa';
    }
    
    // Default fallback
    console.warn(`⚠️  Could not detect key type from public key, defaulting to 'rsa'`);
    return 'rsa';
}

/**
 * Validate hostname format
 */
function isValidHostname(hostname) {
    // More restrictive hostname validation
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // Additional length check
    if (hostname.length > 253) {
        return false;
    }
    
    return hostnameRegex.test(hostname) || ipRegex.test(hostname);
}

/**
 * Validate username format
 */
function isValidUsername(username) {
    // More restrictive username validation
    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    return usernameRegex.test(username) && username.length >= 1 && username.length <= 32;
}

/**
 * Validate key ID format (UUID)
 */
function isValidKeyId(keyId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(keyId);
}

/**
 * Check for shell metacharacters that could be used for command injection
 */
function containsShellMetacharacters(input) {
    // Comprehensive list of dangerous shell metacharacters
    const dangerousChars = /[;&|`$(){}[\]\\'":!*?~#%^+=<>]/;
    return dangerousChars.test(input);
}

/**
 * Validate port number
 */
function isValidPort(port) {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Secure temporary file creation with proper cleanup
 */
async function createSecureTempFile(content, prefix = 'ssh-temp-') {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), prefix));
    const tempFile = path.join(tempDir, 'key');
    
    try {
        await fs.writeFile(tempFile, content, { mode: 0o600 });
        return { tempDir, tempFile };
    } catch (error) {
        // Clean up on error
        await fs.remove(tempDir);
        throw error;
    }
}

/**
 * Secure cleanup of temporary files
 */
async function secureCleanup(tempDir) {
    try {
        if (tempDir && await fs.pathExists(tempDir)) {
            // Overwrite files with random data before deletion
            const files = await fs.readdir(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    // Overwrite with random data
                    const randomData = crypto.randomBytes(stats.size);
                    await fs.writeFile(filePath, randomData);
                }
            }
            await fs.remove(tempDir);
        }
    } catch (error) {
        console.error('Failed to secure cleanup:', error.message);
        // Force remove even if secure cleanup fails
        try {
            await fs.remove(tempDir);
        } catch (cleanupError) {
            console.error('Failed to cleanup temp directory:', cleanupError.message);
        }
    }
}

module.exports = router;
