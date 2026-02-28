const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const deploymentManager = require('../services/deployment-manager');
const templateManager = require('../services/template-manager');
const identityManager = require('../services/identity-manager');
const directorServer = require('../services/director-server');
const vaultManager = require('../services/vault-manager');

/**
 * Deployment Routes
 * For deploying templates to clients
 */

// Middleware to ensure Director mode
async function requireDirectorMode(req, res, next) {
    try {
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Director mode required for deployments'
            });
        }
        
        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            detail: 'Failed to verify mode'
        });
    }
}

/**
 * Deploy template to clients
 */
router.post('/deploy', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { 
            template_type, 
            template_id, 
            client_ids, 
            master_password, 
            repository_configs,
            ssh_keys 
        } = req.body;

        if (!template_type || !template_id || !client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
            return res.status(400).json({
                success: false,
                detail: 'template_type, template_id, and client_ids (array) are required'
            });
        }

        // Get template
        const template = await templateManager.getTemplate(template_type, template_id);
        if (!template) {
            return res.status(404).json({
                success: false,
                detail: 'Template not found'
            });
        }

        // If master_password provided, verify it
        if (master_password) {
            const isValid = await vaultManager.isInitialized();
            if (isValid) {
                const isCorrect = await vaultManager.verifyMasterPassword(master_password);
                if (!isCorrect) {
                    return res.status(401).json({
                        success: false,
                        detail: 'Invalid master password'
                    });
                }
            }
        }

        // Store repository passphrases in vault if provided
        if (master_password && repository_configs && Array.isArray(repository_configs)) {
            for (const repoConfig of repository_configs) {
                for (const clientId of client_ids) {
                    try {
                        await vaultManager.storePassphrase(
                            clientId,
                            repoConfig.repo_id || repoConfig.name,
                            repoConfig.name,
                            repoConfig.path,
                            repoConfig.passphrase,
                            master_password
                        );
                    } catch (error) {
                        console.error(`Failed to store passphrase for ${clientId}:`, error.message);
                    }
                }
            }
        }

        // Create deployment record
        const deployment = await deploymentManager.createDeployment(
            template_type,
            template_id,
            template.name,
            client_ids,
            req.user.username
        );

        // Send commands to clients asynchronously
        deployToClients(
            deployment.id, 
            template, 
            client_ids, 
            repository_configs
        ).catch(error => {
            console.error('Deployment error:', error.message);
        });

        res.json({
            success: true,
            data: { deployment },
            message: 'Deployment initiated'
        });
    } catch (error) {
        console.error('Failed to initiate deployment:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to initiate deployment'
        });
    }
});

/**
 * Actually deploy to clients (async function)
 */
async function deployToClients(deploymentId, template, clientIds, repositoryConfigs = []) {
    try {
        // Update deployment status
        await deploymentManager.updateDeploymentStatus(deploymentId, 'in_progress');

        // Fetch SSH keys from database if ssh_key_ids are present in repositoryConfigs
        const sshKeyIds = new Set();
        if (repositoryConfigs && repositoryConfigs.length > 0) {
            repositoryConfigs.forEach(repo => {
                if (repo.ssh_key_id) {
                    sshKeyIds.add(repo.ssh_key_id);
                }
            });
        }

        // Load SSH keys from YAML storage
        const loadedSSHKeys = [];
        if (sshKeyIds.size > 0) {
            try {
                const yamlManager = require('../services/yaml-manager');
                const fs = require('fs-extra');
                const path = require('path');
                
                const dataPath = path.join(process.cwd(), 'data', 'ssh-keys.yaml');
                if (await fs.pathExists(dataPath)) {
                    const data = await yamlManager.loadYaml(dataPath);
                    const allKeys = data.ssh_keys || [];
                    
                    // Filter only the SSH keys that are referenced in repositoryConfigs
                    for (const keyId of sshKeyIds) {
                        const key = allKeys.find(k => k.id === parseInt(keyId) || k.id === keyId);
                        if (key) {
                            loadedSSHKeys.push(key);
                        } else {
                            console.warn(`SSH key ${keyId} not found in storage`);
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load SSH keys:', error.message);
            }
        }

        // Send command to each client
        for (const clientId of clientIds) {
            try {
                // Prepare deployment data
                const deploymentData = {
                    template: template,
                    deployment_id: deploymentId
                };

                // Add repository configurations if present (for repository initialization)
                if (repositoryConfigs && repositoryConfigs.length > 0) {
                    deploymentData.repositories = repositoryConfigs.map(repoConfig => ({
                        ...repoConfig,
                        // Expand path patterns for this client
                        path: templateManager.expandPathPattern(repoConfig.path || repoConfig.path_pattern, {
                            client_id: clientId,
                            hostname: clientId // Will be replaced by actual hostname on client side
                        })
                    }));
                }

                // Add SSH keys if present (loaded from database)
                if (loadedSSHKeys.length > 0) {
                    deploymentData.ssh_keys = loadedSSHKeys;
                }

                const commandType = getCommandType(template.type);
                const result = await directorServer.sendCommandToClient(clientId, commandType, deploymentData);

                // Update deployment result
                await deploymentManager.updateDeploymentResult(deploymentId, clientId, {
                    status: result.success ? 'success' : 'failed',
                    message: result.message || (result.success ? 'Deployed successfully' : 'Deployment failed')
                });
            } catch (error) {
                console.error(`Failed to deploy to client ${clientId}:`, error.message);
                await deploymentManager.updateDeploymentResult(deploymentId, clientId, {
                    status: 'failed',
                    message: error.message || 'Deployment failed'
                });
            }
        }
    } catch (error) {
        console.error('Deployment process error:', error.message);
    }
}

/**
 * Map template type to command type
 */
function getCommandType(templateType) {
    switch (templateType) {
        case 'backup':
        case 'backups':
            return 'backup:create';
        case 'schedule':
        case 'schedules':
            return 'schedule:create';
        case 'repository':
        case 'repositories':
            return 'repo:init'; // Changed to init for repository initialization
        default:
            throw new Error(`Unknown template type: ${templateType}`);
    }
}

/**
 * Get all deployments
 */
router.get('/', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { status, template_type, client_id } = req.query;
        
        const deployments = await deploymentManager.getDeployments({
            status,
            template_type,
            client_id
        });

        res.json({
            success: true,
            data: {
                deployments: deployments,
                count: deployments.length
            }
        });
    } catch (error) {
        console.error('Failed to get deployments:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get deployments'
        });
    }
});

/**
 * Get single deployment
 */
router.get('/:deployment_id', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { deployment_id } = req.params;
        const deployment = await deploymentManager.getDeployment(deployment_id);

        if (!deployment) {
            return res.status(404).json({
                success: false,
                detail: 'Deployment not found'
            });
        }

        res.json({
            success: true,
            data: { deployment }
        });
    } catch (error) {
        console.error('Failed to get deployment:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get deployment'
        });
    }
});

/**
 * Delete deployment
 */
router.delete('/:deployment_id', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { deployment_id } = req.params;
        await deploymentManager.deleteDeployment(deployment_id);

        res.json({
            success: true,
            message: 'Deployment deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete deployment:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to delete deployment'
        });
    }
});

/**
 * Get deployment statistics
 */
router.get('/stats/summary', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const stats = await deploymentManager.getStats();

        res.json({
            success: true,
            data: { stats }
        });
    } catch (error) {
        console.error('Failed to get deployment stats:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get deployment stats'
        });
    }
});

module.exports = router;

