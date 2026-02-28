const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Identity Manager Service
 * Handles Ed25519 keypair generation and client/director identity management
 */
class IdentityManager {
    constructor() {
        this.config = require('../config');
        this.identityFile = path.join(this.config.dataDir, 'identity.json');
    }

    /**
     * Initialize identity (generate if doesn't exist)
     */
    async initialize() {
        try {
            const mode = this.config.mode;

            if (!mode) {
                console.log('⚠️ Operating mode not configured');
                return { success: true, mode: 'not_configured' };
            }

            // Check if identity exists
            if (await fs.pathExists(this.identityFile)) {
                const identity = await this.getIdentity();
                console.log(`✅ Identity loaded: ${identity.client_name || identity.mode}`);
                return { success: true, identity };
            }

            // Generate new identity
            console.log('🔑 Generating new identity...');
            const identity = await this.generateIdentity(mode);
            console.log(`✅ Identity created: ${identity.client_id}`);

            return { success: true, identity };
        } catch (error) {
            console.error('Failed to initialize identity:', error.message);
            throw error;
        }
    }

    /**
     * Generate Ed25519 keypair and identity
     */
    async generateIdentity(mode = 'client') {
        try {
            // Generate Ed25519 keypair
            const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                    cipher: 'aes-256-cbc',
                    passphrase: this.config.secretKey || 'default-passphrase'
                }
            });

            // Create identity object
            const identity = {
                version: '1.0.0',
                mode: mode,
                client_id: uuidv4(),
                created_at: new Date().toISOString(),
                public_key: publicKey,
                private_key: privateKey, // Encrypted with SECRET_KEY
            };

            // Add mode-specific fields
            if (mode === 'client') {
                identity.client_name = this.config.client.name || `Client-${identity.client_id.slice(0, 8)}`;
                identity.connection_token = ''; // Will be set by user from Director's token
                identity.director_url = ''; // Full URL with protocol and port
                identity.last_connected = null;
            } else if (mode === 'director') {
                identity.director_name = `Director-${identity.client_id.slice(0, 8)}`;
                identity.listen_port = this.config.port; // Socket.IO uses HTTP server port, not director.port
                identity.ssl_enabled = this.config.director.sslEnabled;
                // Generate connection token for clients to use
                identity.connection_token = crypto.randomBytes(32).toString('hex');
                // Do not log full secrets
                console.log(`🔐 Generated connection token: ${identity.connection_token.substring(0, 6)}...`);
            }

            // Save identity
            await fs.ensureDir(path.dirname(this.identityFile));
            await fs.writeJson(this.identityFile, identity, { spaces: 2 });

            console.log(`🔑 Generated Ed25519 keypair`);
            console.log(`🆔 Client ID: ${identity.client_id}`);
            console.log(`🔓 Public Key: ${publicKey.substring(0, 50)}...`);

            return identity;
        } catch (error) {
            console.error('Failed to generate identity:', error.message);
            throw error;
        }
    }

    /**
     * Get current identity
     */
    async getIdentity() {
        try {
            if (!await fs.pathExists(this.identityFile)) {
                return null;
            }

            const identity = await fs.readJson(this.identityFile);
            return identity;
        } catch (error) {
            console.error('Failed to get identity:', error.message);
            return null;
        }
    }

    /**
     * Update identity fields
     */
    async updateIdentity(updates) {
        try {
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found');
            }

            // Merge updates
            const updatedIdentity = { ...identity, ...updates };
            updatedIdentity.updated_at = new Date().toISOString();

            // Save
            await fs.writeJson(this.identityFile, updatedIdentity, { spaces: 2 });
            console.log(`✅ Identity updated`);

            return updatedIdentity;
        } catch (error) {
            console.error('Failed to update identity:', error.message);
            throw error;
        }
    }

    /**
     * Sign data with private key
     */
    signData(data) {
        try {
            const identity = require(this.identityFile);
            const privateKey = crypto.createPrivateKey({
                key: identity.private_key,
                format: 'pem',
                type: 'pkcs8',
                passphrase: this.config.secretKey || 'default-passphrase'
            });

            const signature = crypto.sign(null, Buffer.from(data), privateKey);
            return signature.toString('base64');
        } catch (error) {
            console.error('Failed to sign data:', error.message);
            throw error;
        }
    }

    /**
     * Verify signature with public key
     */
    verifySignature(data, signature, publicKeyPem) {
        try {
            const publicKey = crypto.createPublicKey({
                key: publicKeyPem,
                format: 'pem',
                type: 'spki'
            });

            const isValid = crypto.verify(
                null,
                Buffer.from(data),
                publicKey,
                Buffer.from(signature, 'base64')
            );

            return isValid;
        } catch (error) {
            console.error('Failed to verify signature:', error.message);
            return false;
        }
    }

    /**
     * Get public key fingerprint (for display)
     */
    getPublicKeyFingerprint(publicKeyPem = null) {
        try {
            const pem = publicKeyPem || require(this.identityFile).public_key;
            const hash = crypto.createHash('sha256').update(pem).digest('hex');

            // Format as SSH fingerprint style
            return hash.match(/.{1,2}/g).join(':').substring(0, 47) + '...';
        } catch (error) {
            console.error('Failed to get fingerprint:', error.message);
            return null;
        }
    }

    /**
     * Delete identity (reset)
     */
    async deleteIdentity() {
        try {
            if (await fs.pathExists(this.identityFile)) {
                await fs.remove(this.identityFile);
                console.log('🗑️ Identity deleted');
            }
            return { success: true };
        } catch (error) {
            console.error('Failed to delete identity:', error.message);
            throw error;
        }
    }

    /**
     * Get identity status (for UI)
     */
    async getStatus() {
        try {
            // Read mode from file (not cached config) to get the latest value
            let mode = this.config.mode;
            const modeConfigFile = path.join(this.config.dataDir, 'mode.json');
            if (await fs.pathExists(modeConfigFile)) {
                try {
                    const modeConfig = await fs.readJson(modeConfigFile);
                    mode = modeConfig.mode;
                } catch (err) {
                    console.warn('Failed to read mode.json, using config value:', err.message);
                }
            }

            const identity = await this.getIdentity();

            // Get live connection status for client mode
            let connectionStatus = null;
            if (mode === 'client' && identity) {
                try {
                    const directorClient = require('./director-client');
                    const connInfo = directorClient.getConnectionInfo();
                    connectionStatus = {
                        is_connected: connInfo.isConnected,
                        is_authenticated: connInfo.isAuthenticated,
                        reconnect_attempts: connInfo.reconnectAttempts
                    };
                } catch (err) {
                    console.warn('Failed to get director-client connection info:', err.message);
                }
            }

            return {
                mode: mode || 'not_configured',
                has_identity: !!identity,
                identity: identity ? {
                    client_id: identity.client_id,
                    client_name: identity.client_name || identity.director_name,
                    public_key: identity.public_key,
                    public_key_fingerprint: this.getPublicKeyFingerprint(identity.public_key),
                    created_at: identity.created_at,
                    connection_token: identity.connection_token, // Both director and client use this
                    // Client-specific
                    director_url: identity.director_url,
                    approved: identity.approved,
                    last_connected: identity.last_connected,
                    connection_status: connectionStatus, // Live connection status
                    // Director-specific
                    listen_port: identity.listen_port,
                } : null
            };
        } catch (error) {
            console.error('Failed to get status:', error.message);
            return {
                mode: 'error',
                has_identity: false,
                error: error.message
            };
        }
    }
}

module.exports = new IdentityManager();

