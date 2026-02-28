const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Deployment Manager
 * Tracks template deployments to clients
 */
class DeploymentManager {
    constructor() {
        this.deploymentsFile = path.join(config.dataDir, 'deployments.json');
    }

    /**
     * Initialize deployments storage
     */
    async initialize() {
        try {
            if (!await fs.pathExists(this.deploymentsFile)) {
                await fs.writeJson(this.deploymentsFile, { deployments: [] }, { spaces: 2 });
            }
            console.log('✅ Deployment manager initialized');
        } catch (error) {
            console.error('Failed to initialize deployment manager:', error.message);
            throw error;
        }
    }

    /**
     * Read deployments
     */
    async _readDeployments() {
        try {
            const data = await fs.readJson(this.deploymentsFile);
            return data.deployments || [];
        } catch (error) {
            console.error('Failed to read deployments:', error.message);
            return [];
        }
    }

    /**
     * Write deployments
     */
    async _writeDeployments(deployments) {
        try {
            await fs.writeJson(this.deploymentsFile, { deployments }, { spaces: 2 });
        } catch (error) {
            console.error('Failed to write deployments:', error.message);
            throw error;
        }
    }

    /**
     * Create deployment record
     */
    async createDeployment(templateType, templateId, templateName, clientIds, deployedBy) {
        try {
            const deployment = {
                id: uuidv4(),
                template_type: templateType,
                template_id: templateId,
                template_name: templateName,
                client_ids: clientIds,
                deployed_by: deployedBy,
                status: 'pending', // pending, in_progress, completed, failed, partial
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                results: {} // { client_id: { status, message, timestamp } }
            };

            const deployments = await this._readDeployments();
            deployments.push(deployment);
            await this._writeDeployments(deployments);

            console.log(`📦 Deployment created: ${deployment.id}`);
            return deployment;
        } catch (error) {
            console.error('Failed to create deployment:', error.message);
            throw error;
        }
    }

    /**
     * Update deployment status
     */
    async updateDeploymentStatus(deploymentId, status) {
        try {
            const deployments = await this._readDeployments();
            const deployment = deployments.find(d => d.id === deploymentId);

            if (!deployment) {
                throw new Error('Deployment not found');
            }

            deployment.status = status;
            deployment.updated_at = new Date().toISOString();

            await this._writeDeployments(deployments);
            return deployment;
        } catch (error) {
            console.error('Failed to update deployment status:', error.message);
            throw error;
        }
    }

    /**
     * Update deployment result for specific client
     */
    async updateDeploymentResult(deploymentId, clientId, result) {
        try {
            const deployments = await this._readDeployments();
            const deployment = deployments.find(d => d.id === deploymentId);

            if (!deployment) {
                throw new Error('Deployment not found');
            }

            deployment.results[clientId] = {
                status: result.status,
                message: result.message || '',
                timestamp: new Date().toISOString()
            };

            deployment.updated_at = new Date().toISOString();

            // Auto-update deployment status based on results
            const totalClients = deployment.client_ids.length;
            const completedResults = Object.keys(deployment.results).length;
            const successfulResults = Object.values(deployment.results).filter(r => r.status === 'success').length;
            const failedResults = Object.values(deployment.results).filter(r => r.status === 'failed').length;

            if (completedResults === totalClients) {
                if (successfulResults === totalClients) {
                    deployment.status = 'completed';
                } else if (failedResults === totalClients) {
                    deployment.status = 'failed';
                } else {
                    deployment.status = 'partial';
                }
            } else {
                deployment.status = 'in_progress';
            }

            await this._writeDeployments(deployments);
            return deployment;
        } catch (error) {
            console.error('Failed to update deployment result:', error.message);
            throw error;
        }
    }

    /**
     * Get all deployments
     */
    async getDeployments(filters = {}) {
        try {
            let deployments = await this._readDeployments();

            // Filter by status
            if (filters.status) {
                deployments = deployments.filter(d => d.status === filters.status);
            }

            // Filter by template type
            if (filters.template_type) {
                deployments = deployments.filter(d => d.template_type === filters.template_type);
            }

            // Filter by client
            if (filters.client_id) {
                deployments = deployments.filter(d => 
                    d.client_ids.includes(filters.client_id)
                );
            }

            // Sort by created date (newest first)
            deployments.sort((a, b) => 
                new Date(b.created_at) - new Date(a.created_at)
            );

            return deployments;
        } catch (error) {
            console.error('Failed to get deployments:', error.message);
            return [];
        }
    }

    /**
     * Get single deployment
     */
    async getDeployment(deploymentId) {
        try {
            const deployments = await this._readDeployments();
            return deployments.find(d => d.id === deploymentId) || null;
        } catch (error) {
            console.error('Failed to get deployment:', error.message);
            return null;
        }
    }

    /**
     * Delete deployment
     */
    async deleteDeployment(deploymentId) {
        try {
            let deployments = await this._readDeployments();
            const index = deployments.findIndex(d => d.id === deploymentId);

            if (index === -1) {
                throw new Error('Deployment not found');
            }

            deployments.splice(index, 1);
            await this._writeDeployments(deployments);

            console.log(`🗑️ Deployment deleted: ${deploymentId}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete deployment:', error.message);
            throw error;
        }
    }

    /**
     * Get deployment statistics
     */
    async getStats() {
        try {
            const deployments = await this._readDeployments();
            
            return {
                total: deployments.length,
                pending: deployments.filter(d => d.status === 'pending').length,
                in_progress: deployments.filter(d => d.status === 'in_progress').length,
                completed: deployments.filter(d => d.status === 'completed').length,
                failed: deployments.filter(d => d.status === 'failed').length,
                partial: deployments.filter(d => d.status === 'partial').length
            };
        } catch (error) {
            console.error('Failed to get deployment stats:', error.message);
            return {
                total: 0,
                pending: 0,
                in_progress: 0,
                completed: 0,
                failed: 0,
                partial: 0
            };
        }
    }
}

module.exports = new DeploymentManager();

