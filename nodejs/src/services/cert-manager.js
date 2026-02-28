const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');

/**
 * Certificate Manager
 * Auto-generates self-signed SSL certificates for WebSocket security
 */
class CertManager {
    constructor() {
        this.sslDir = path.join(config.dataDir, 'ssl');
        this.certFile = path.join(this.sslDir, 'director-cert.pem');
        this.keyFile = path.join(this.sslDir, 'director-key.pem');
    }

    /**
     * Initialize SSL certificates (auto-generate if missing)
     */
    async initialize() {
        try {
            await fs.ensureDir(this.sslDir);
            await fs.chmod(this.sslDir, 0o700);

            // Check if certificates exist
            const certExists = await fs.pathExists(this.certFile);
            const keyExists = await fs.pathExists(this.keyFile);

            if (certExists && keyExists) {
                // Verify certificates are valid
                const isValid = await this.verifyCertificates();
                if (isValid) {
                    console.log('✅ SSL certificates found and valid');
                    return { success: true, generated: false };
                } else {
                    console.log('⚠️  Existing certificates invalid, regenerating...');
                }
            }

            // Generate new certificates
            console.log('🔐 Generating self-signed SSL certificates...');
            await this.generateCertificates();
            console.log('✅ SSL certificates generated successfully');

            return { success: true, generated: true };
        } catch (error) {
            console.error('Failed to initialize certificates:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate self-signed SSL certificates
     */
    async generateCertificates() {
        try {
            const hostname = require('os').hostname();
            const commonName = process.env.DOMAIN || hostname;

            // Generate private key and self-signed certificate
            const opensslCmd = `openssl req -x509 -newkey rsa:4096 \
                -keyout "${this.keyFile}" \
                -out "${this.certFile}" \
                -days 365 \
                -nodes \
                -subj "/CN=${commonName}/O=Borgmatic UI/C=US" \
                2>&1`;

            const output = execSync(opensslCmd, { encoding: 'utf8' });
            
            // Set secure permissions
            await fs.chmod(this.keyFile, 0o600);
            await fs.chmod(this.certFile, 0o644);

            // Update config to use these certificates
            await this.updateConfig();

            console.log(`📜 Certificate generated for: ${commonName}`);
            console.log(`🔑 Private key: ${this.keyFile}`);
            console.log(`📄 Certificate: ${this.certFile}`);
            console.log(`⏰ Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`);

            return { success: true };
        } catch (error) {
            console.error('Failed to generate certificates:', error.message);
            throw error;
        }
    }

    /**
     * Verify existing certificates
     */
    async verifyCertificates() {
        try {
            // Check if openssl is available
            execSync('which openssl', { encoding: 'utf8' });

            // Verify certificate
            const verifyCmd = `openssl x509 -in "${this.certFile}" -noout -checkend 86400 2>&1`;
            execSync(verifyCmd, { encoding: 'utf8' });

            // Check if key matches cert
            const certModulus = execSync(`openssl x509 -noout -modulus -in "${this.certFile}"`, { encoding: 'utf8' });
            const keyModulus = execSync(`openssl rsa -noout -modulus -in "${this.keyFile}"`, { encoding: 'utf8' });

            return certModulus === keyModulus;
        } catch (error) {
            return false;
        }
    }

    /**
     * Update environment configuration with certificate paths
     */
    async updateConfig() {
        try {
            const configManager = require('./config-manager');
            await configManager.updateEnv({
                DIRECTOR_SSL_ENABLED: 'true',
                DIRECTOR_SSL_CERT: this.certFile,
                DIRECTOR_SSL_KEY: this.keyFile
            });

            // Update runtime config
            config.director.sslEnabled = true;
            config.director.sslCert = this.certFile;
            config.director.sslKey = this.keyFile;
        } catch (error) {
            console.warn('⚠️  Could not update config:', error.message);
        }
    }

    /**
     * Get certificate info
     */
    async getCertificateInfo() {
        try {
            if (!await fs.pathExists(this.certFile)) {
                return null;
            }

            const certInfo = execSync(`openssl x509 -in "${this.certFile}" -noout -subject -issuer -dates`, { encoding: 'utf8' });
            const lines = certInfo.split('\n');

            return {
                path: this.certFile,
                exists: true,
                subject: lines[0]?.replace('subject=', '').trim(),
                issuer: lines[1]?.replace('issuer=', '').trim(),
                notBefore: lines[2]?.replace('notBefore=', '').trim(),
                notAfter: lines[3]?.replace('notAfter=', '').trim(),
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Regenerate certificates (e.g., when domain changes)
     */
    async regenerateCertificates() {
        try {
            console.log('🔄 Regenerating SSL certificates...');
            
            // Backup old certificates
            if (await fs.pathExists(this.certFile)) {
                await fs.move(this.certFile, `${this.certFile}.backup`, { overwrite: true });
            }
            if (await fs.pathExists(this.keyFile)) {
                await fs.move(this.keyFile, `${this.keyFile}.backup`, { overwrite: true });
            }

            // Generate new certificates
            await this.generateCertificates();
            
            console.log('✅ Certificates regenerated');
            return { success: true };
        } catch (error) {
            console.error('Failed to regenerate certificates:', error.message);
            
            // Restore backups
            try {
                if (await fs.pathExists(`${this.certFile}.backup`)) {
                    await fs.move(`${this.certFile}.backup`, this.certFile, { overwrite: true });
                }
                if (await fs.pathExists(`${this.keyFile}.backup`)) {
                    await fs.move(`${this.keyFile}.backup`, this.keyFile, { overwrite: true });
                }
            } catch (restoreError) {
                console.error('Failed to restore backup certificates:', restoreError.message);
            }

            throw error;
        }
    }
}

module.exports = new CertManager();

