const yamlManager = require('./yaml-manager');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Encryption Manager Service
 * Handles encryption types, passphrases, and key management for borgmatic repositories
 */
class EncryptionManager {
    constructor() {
        this.encryptionTypes = {
            'none': {
                name: 'No Encryption',
                description: 'Repository will not be encrypted (not recommended)',
                requiresPassphrase: false,
                keyLocation: 'none'
            },
            'repokey': {
                name: 'Repository Key',
                description: 'Encryption key stored in repository',
                requiresPassphrase: true,
                keyLocation: 'repository'
            },
            'keyfile': {
                name: 'Keyfile',
                description: 'Encryption key stored in separate keyfile',
                requiresPassphrase: true,
                keyLocation: 'keyfile'
            },
            'repokey-blake2': {
                name: 'Repository Key (Blake2)',
                description: 'Repository key with Blake2 hash algorithm (recommended)',
                requiresPassphrase: true,
                keyLocation: 'repository'
            },
            'keyfile-blake2': {
                name: 'Keyfile (Blake2)',
                description: 'Keyfile with Blake2 hash algorithm',
                requiresPassphrase: true,
                keyLocation: 'keyfile'
            }
        };
    }

    /**
     * Get available encryption types
     */
    getEncryptionTypes() {
        return this.encryptionTypes;
    }

    /**
     * Get encryption type information
     */
    getEncryptionTypeInfo(encryptionType) {
        return this.encryptionTypes[encryptionType] || null;
    }

    /**
     * Validate encryption configuration
     */
    validateEncryptionConfig(encryptionType, passphrase = null) {
        const typeInfo = this.getEncryptionTypeInfo(encryptionType);
        
        if (!typeInfo) {
            return {
                isValid: false,
                error: `Invalid encryption type: ${encryptionType}`
            };
        }

        if (typeInfo.requiresPassphrase && !passphrase) {
            return {
                isValid: false,
                error: `Encryption type '${encryptionType}' requires a passphrase`
            };
        }

        if (passphrase && passphrase.length < 8) {
            return {
                isValid: false,
                error: 'Passphrase must be at least 8 characters long'
            };
        }

        return {
            isValid: true,
            typeInfo
        };
    }

    /**
     * Generate secure passphrase
     */
    generateSecurePassphrase(length = 32) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        return Array.from({ length }, () => 
            alphabet[crypto.randomInt(0, alphabet.length)]
        ).join('');
    }

    /**
     * Get encryption recommendations
     */
    getEncryptionRecommendations() {
        return {
            recommended: 'repokey-blake2',
            alternatives: ['repokey', 'keyfile-blake2'],
            notRecommended: ['none'],
            reasons: {
                'repokey-blake2': 'Best security with Blake2 algorithm (recommended)',
                repokey: 'Good balance of security and convenience',
                keyfile: 'Good for shared repositories, key stored separately',
                'keyfile-blake2': 'Enhanced security with separate keyfile',
                none: 'No security - not recommended for sensitive data'
            }
        };
    }

    /**
     * Get encryption status for repository
     */
    async getRepositoryEncryptionStatus(repositoryPath) {
        try {
            const config = await yamlManager.readYaml(path.join(config.configDir, 'borgmatic.yaml'));
            
            if (!config.location || !config.location.repositories) {
                return null;
            }

            const repository = config.location.repositories.find(repo => repo.path === repositoryPath);
            
            if (!repository) {
                return null;
            }

            const encryptionType = repository.encryption || 'none';
            const typeInfo = this.getEncryptionTypeInfo(encryptionType);
            
            return {
                path: repositoryPath,
                encryptionType,
                typeInfo,
                hasPassphrase: !!config.storage?.encryption_passphrase,
                isEncrypted: encryptionType !== 'none',
                keyLocation: typeInfo?.keyLocation || 'none'
            };
        } catch (error) {
            console.error('Failed to get repository encryption status:', error.message);
            return null;
        }
    }

    /**
     * Update repository encryption
     */
    async updateRepositoryEncryption(repositoryPath, encryptionType, passphrase = null) {
        try {
            // Validate encryption configuration
            const validation = this.validateEncryptionConfig(encryptionType, passphrase);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            const config = await yamlManager.readYaml(path.join(config.configDir, 'borgmatic.yaml'));
            
            if (!config.location || !config.location.repositories) {
                throw new Error('No repositories configured');
            }

            const repoIndex = config.location.repositories.findIndex(repo => repo.path === repositoryPath);
            if (repoIndex === -1) {
                throw new Error('Repository not found');
            }

            // Update repository encryption
            if (encryptionType === 'none') {
                // Remove encryption field for no encryption
                delete config.location.repositories[repoIndex].encryption;
            } else {
                config.location.repositories[repoIndex].encryption = encryptionType;
            }

            // Update storage passphrase if provided and encryption is not 'none'
            if (passphrase && encryptionType !== 'none') {
                if (!config.storage) {
                    config.storage = {};
                }
                config.storage.encryption_passphrase = passphrase;
            } else if (encryptionType === 'none') {
                // Remove passphrase for no encryption
                if (config.storage && config.storage.encryption_passphrase) {
                    delete config.storage.encryption_passphrase;
                }
            }

            // Save configuration
            await yamlManager.writeYaml(path.join(config.configDir, 'borgmatic.yaml'), config);
            
            return {
                success: true,
                repositoryPath,
                encryptionType,
                hasPassphrase: !!passphrase && encryptionType !== 'none'
            };
        } catch (error) {
            console.error('Failed to update repository encryption:', error.message);
            throw error;
        }
    }

    /**
     * Get encryption summary for all repositories
     */
    async getEncryptionSummary() {
        try {
            const config = await yamlManager.readYaml(path.join(config.configDir, 'borgmatic.yaml'));
            
            if (!config.location || !config.location.repositories) {
                return {
                    repositories: [],
                    summary: {
                        total: 0,
                        encrypted: 0,
                        unencrypted: 0,
                        hasPassphrase: false
                    }
                };
            }

            const repositories = await Promise.all(
                config.location.repositories.map(async (repo) => {
                    const status = await this.getRepositoryEncryptionStatus(repo.path);
                    return status;
                })
            );

            const summary = {
                total: repositories.length,
                encrypted: repositories.filter(r => r && r.isEncrypted).length,
                unencrypted: repositories.filter(r => r && !r.isEncrypted).length,
                hasPassphrase: !!config.storage?.encryption_passphrase
            };

            return {
                repositories: repositories.filter(r => r !== null),
                summary
            };
        } catch (error) {
            console.error('Failed to get encryption summary:', error.message);
            return {
                repositories: [],
                summary: {
                    total: 0,
                    encrypted: 0,
                    unencrypted: 0,
                    hasPassphrase: false
                }
            };
        }
    }

    /**
     * Check if repository is encrypted
     */
    isRepositoryEncrypted(encryptionType) {
        return encryptionType && encryptionType !== 'none';
    }

    /**
     * Get encryption security level
     */
    getEncryptionSecurityLevel(encryptionType) {
        const securityLevels = {
            'none': 0,
            'repokey': 3,
            'keyfile': 4,
            'repokey-blake2': 5,
            'keyfile-blake2': 5
        };

        return securityLevels[encryptionType] || 0;
    }

    /**
     * Get encryption comparison
     */
    getEncryptionComparison() {
        return {
            'none': {
                security: 'None',
                convenience: 'High',
                keyRecovery: 'N/A',
                recommended: false
            },
            'repokey': {
                security: 'High',
                convenience: 'High',
                keyRecovery: 'Difficult',
                recommended: true
            },
            'keyfile': {
                security: 'High',
                convenience: 'Medium',
                keyRecovery: 'Possible',
                recommended: true
            },
            'repokey-blake2': {
                security: 'Very High',
                convenience: 'High',
                keyRecovery: 'Difficult',
                recommended: true
            },
            'keyfile-blake2': {
                security: 'Very High',
                convenience: 'Medium',
                keyRecovery: 'Possible',
                recommended: true
            }
        };
    }
}

module.exports = new EncryptionManager();
