const express = require('express');
const router = express.Router();
const borgmaticConfig = require('../../services/borgmatic-config');
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const configParser = require('../../services/config-parser');
const repositoryCredentials = require('../../services/repository-credentials');
const fs = require('fs-extra');
const path = require('path');
const { constructS3Path, writeSSHKeyToFilesystem } = require('./helpers');

router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repositories = await borgmaticConfig.getRepositoriesWithStatus();
        const repoIndex = parseInt(req.params.id) - 1;

        if (repoIndex < 0 || repoIndex >= repositories.length) {
            return res.status(404).json({ detail: 'Repository not found' });
        }

        const repo = repositories[repoIndex];
        res.json({
            success: true,
            data: {
                id: parseInt(req.params.id),
                name: repo.label || `Repository ${req.params.id}`,
                path: repo.path,
                encryption: repo.encryption || 'none',
                compression: 'lz4',
                is_active: repo.is_active,
                created_at: new Date().toISOString(),
                updated_at: null
            }
        });
    } catch (error) {
        console.error('Failed to get repository:', error.message);
        res.status(500).json({ detail: 'Failed to get repository' });
    }
});

router.put('/by-path/:path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const oldRepoPath = decodeURIComponent(req.params.path);
        console.log(`📝 PUT /api/repositories/by-path - Path: ${oldRepoPath}`);

        const {
            name,
            compression,
            read_only,
            // Credentials (editable)
            ssh_key_id,
            ssh_auth_method,
            ssh_password,
            s3_endpoint,
            s3_bucket,
            s3_path,
            s3_region,
            s3_access_key,
            s3_secret_key,
            passphrase
        } = req.body;

        // Get unused repositories
        const unusedRepos = await configParser.getUnusedRepositories();
        let unusedIndex = unusedRepos.findIndex(r => path.normalize(r.path) === path.normalize(oldRepoPath));

        // If repository not in unused list, check if it's a discovered repository
        let existingRepo;
        if (unusedIndex === -1) {
            // Check if this is a discovered repository (exists in configs but not in unused list)
            const allRepos = await configParser.getAllRepositoriesWithUsage();
            const discoveredRepo = allRepos.find(r => path.normalize(r.path) === path.normalize(oldRepoPath) && r.isDiscovered);

            if (discoveredRepo) {
                // Add discovered repository to unused list so it can be edited
                console.log(`📝 Adding discovered repository to unused list: ${oldRepoPath}`);
                existingRepo = {
                    name: discoveredRepo.name || 'Discovered automatically - not named yet',
                    path: discoveredRepo.path,
                    label: discoveredRepo.label || discoveredRepo.name,
                    encryption: discoveredRepo.encryption,
                    compression: discoveredRepo.compression || 'lz4',
                    repository_type: discoveredRepo.repository_type || 'local',
                    read_only: discoveredRepo.read_only ?? false,
                    rclone_remote: discoveredRepo.rclone_remote,
                    rclone_path: discoveredRepo.rclone_path,
                    created_at: discoveredRepo.created_at || new Date().toISOString()
                };

                unusedRepos.push(existingRepo);
                await configParser.saveUnusedRepositories(unusedRepos);
                unusedIndex = unusedRepos.length - 1;
                console.log(`✅ Discovered repository added to unused list`);
            } else {
                console.error(`❌ Repository not found: ${oldRepoPath}`);
                return res.status(404).json({ detail: 'Repository not found' });
            }
        } else {
            existingRepo = unusedRepos[unusedIndex];
        }
        const repoType = existingRepo.repository_type || 'local';

        // Validate name
        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ detail: 'Invalid repository name' });
            }
            if (name.length > 255) {
                return res.status(400).json({ detail: 'Repository name too long (max 255 characters)' });
            }
            if (/[:\n\r\t]/.test(name)) {
                return res.status(400).json({ detail: 'Repository name contains invalid characters' });
            }
        }

        // Only update editable fields - path, encryption, repository_type cannot be changed
        const updates = {
            ...existingRepo,
            updated_at: new Date().toISOString()
        };

        // Update name if provided
        if (name !== undefined) {
            updates.name = name;
            updates.label = name;
        }

        // Update compression if provided
        if (compression !== undefined) {
            updates.compression = compression;
        }

        // Update read_only mode if provided
        if (read_only !== undefined) {
            updates.read_only = read_only;
        }

        // Update credentials if provided (but don't change path/type)
        if (repoType === 'ssh' || repoType === 'sftp') {
            // Determine auth method: use provided, or infer from provided credentials, or keep existing
            let authMethod;
            if (ssh_auth_method) {
                authMethod = ssh_auth_method;
            } else if (ssh_key_id !== undefined && ssh_key_id !== null) {
                authMethod = 'key';
            } else if (ssh_password && ssh_password.trim().length > 0) {
                authMethod = 'password';
            } else {
                authMethod = existingRepo.ssh_auth_method || (existingRepo.ssh_key_id ? 'key' : 'password');
            }

            updates.ssh_auth_method = authMethod;

            if (authMethod === 'key') {
                if (ssh_key_id !== undefined && ssh_key_id !== null) {
                    updates.ssh_key_id = ssh_key_id;
                }
            } else if (authMethod === 'password') {
                // Validate password if provided
                if (ssh_password !== undefined) {
                    if (!ssh_password || ssh_password.trim().length === 0) {
                        return res.status(400).json({
                            detail: 'SSH password cannot be empty when using password authentication'
                        });
                    }
                }
            }
        } else if (repoType === 's3') {
            // Update S3 fields if provided
            if (s3_endpoint !== undefined) updates.s3_endpoint = s3_endpoint;
            if (s3_bucket !== undefined) updates.s3_bucket = s3_bucket;
            if (s3_path !== undefined) updates.s3_path = s3_path;
            if (s3_region !== undefined) updates.s3_region = s3_region;

            // If S3 credentials are provided, reconstruct path with new credentials
            if (s3_access_key && s3_secret_key && s3_bucket) {
                const actualS3Bucket = s3_bucket || existingRepo.s3_bucket || '';
                const actualS3Path = s3_path || existingRepo.s3_path || '/backups';
                const actualS3Endpoint = s3_endpoint || existingRepo.s3_endpoint;
                updates.path = constructS3Path(
                    s3_access_key,
                    s3_secret_key,
                    actualS3Bucket,
                    actualS3Path,
                    actualS3Endpoint
                );
            }
        }

        // Store encrypted credentials if provided
        const actualRepoPath = updates.path || oldRepoPath;

        if (repoType === 'ssh' || repoType === 'sftp') {
            // Determine auth method: use provided, or infer from provided credentials, or keep existing
            let authMethod;
            if (ssh_auth_method) {
                authMethod = ssh_auth_method;
            } else if (ssh_key_id !== undefined && ssh_key_id !== null) {
                authMethod = 'key';
            } else if (ssh_password && ssh_password.trim().length > 0) {
                authMethod = 'password';
            } else {
                authMethod = existingRepo.ssh_auth_method || (existingRepo.ssh_key_id ? 'key' : 'password');
            }

            if (authMethod === 'key' && ssh_key_id !== undefined && ssh_key_id !== null) {
                const sshKeysAPI = require('../../services/ssh-keys');
                const sshKey = await sshKeysAPI.getSSHKey(ssh_key_id);
                if (!sshKey || !sshKey.private_key) {
                    return res.status(400).json({
                        detail: 'SSH key not found or invalid'
                    });
                }
                // Store encrypted credentials
                await repositoryCredentials.storeSSHKey(actualRepoPath, ssh_key_id, sshKey.private_key);

                // Write to filesystem for borgmatic to use
                await writeSSHKeyToFilesystem(ssh_key_id, sshKey.private_key);

                // Clear password if switching from password to key
                const existingPassword = await repositoryCredentials.getSSHPassword(actualRepoPath);
                if (existingPassword) {
                    const creds = await repositoryCredentials.readCredentials();
                    if (creds[actualRepoPath] && creds[actualRepoPath].ssh_password_encrypted) {
                        delete creds[actualRepoPath].ssh_password_encrypted;
                        await repositoryCredentials.writeCredentials(creds);
                    }
                }
            } else if (authMethod === 'password' && ssh_password && ssh_password.trim().length > 0) {
                // Store encrypted SSH password
                await repositoryCredentials.storeSSHPassword(actualRepoPath, ssh_password);

                // Clear SSH key if switching from key to password
                const existingKey = await repositoryCredentials.getSSHKey(actualRepoPath);
                if (existingKey) {
                    const creds = await repositoryCredentials.readCredentials();
                    if (creds[actualRepoPath]) {
                        delete creds[actualRepoPath].ssh_key_id;
                        delete creds[actualRepoPath].ssh_key_encrypted;
                        await repositoryCredentials.writeCredentials(creds);
                    }
                }
            }
        } else if (repoType === 's3') {
            if (s3_access_key && s3_secret_key) {
                await repositoryCredentials.storeS3Credentials(actualRepoPath, {
                    access_key: s3_access_key,
                    secret_key: s3_secret_key,
                    endpoint: s3_endpoint || existingRepo.s3_endpoint,
                    region: s3_region || existingRepo.s3_region,
                    bucket: s3_bucket || existingRepo.s3_bucket,
                    path: s3_path || existingRepo.s3_path
                });
            }
        }

        // Store passphrase if provided
        if (passphrase && existingRepo.encryption && existingRepo.encryption !== 'none') {
            await passwordManager.storeRepositoryPassphrase(actualRepoPath, passphrase);
        }

        // Migrate credentials if path changed (only for S3 when credentials are updated)
        if (updates.path && updates.path !== oldRepoPath) {
            await repositoryCredentials.updateRepositoryPath(oldRepoPath, updates.path);
        }

        // Update in unused repositories list
        unusedRepos[unusedIndex] = updates;
        await configParser.saveUnusedRepositories(unusedRepos);

        // Refresh config parser
        await configParser.refresh();

        console.log(`✅ Repository updated successfully`);

        res.json({
            success: true,
            message: 'Repository updated successfully',
            data: {
                ...updates,
                updated_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to update repository:', error);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({ detail: `Failed to update repository: ${error.message}` });
    }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        console.warn(`⚠️ DEPRECATED: PUT /api/repositories/:id endpoint used. Please migrate to PUT /api/repositories/by-path/:path`);
        console.log(`📝 PUT /api/repositories/${req.params.id} - Request body:`, JSON.stringify(req.body));

        const { name, path: repoPath, compression } = req.body;

        // Get ALL repositories with usage info to find the one being edited
        const allRepos = await configParser.getAllRepositoriesWithUsage();
        const repoIndex = parseInt(req.params.id) - 1;

        console.log(`📋 Found ${allRepos.length} total repositories, accessing index ${repoIndex}`);

        if (repoIndex < 0 || repoIndex >= allRepos.length) {
            console.error(`❌ Repository index ${repoIndex} out of bounds`);
            return res.status(404).json({ detail: 'Repository not found' });
        }

        const repo = allRepos[repoIndex];
        console.log(`📦 Current repository:`, { path: repo.path, label: repo.label, name: repo.name });

        // Now find this repository in the unused list by PATH (not index)
        const unusedRepos = await configParser.getUnusedRepositories();
        const unusedIndex = unusedRepos.findIndex(r => path.normalize(r.path) === path.normalize(repo.path));

        if (unusedIndex === -1) {
            console.error(`❌ Repository not found in unused list: ${repo.path}`);
            return res.status(404).json({ detail: 'Repository not found in unused list' });
        }

        console.log(`📍 Found repository in unused list at index ${unusedIndex}`);

        // Update the repository at the CORRECT index in unused list
        const updates = { ...unusedRepos[unusedIndex] }; // Start with the current unused repo data
        if (name !== undefined) {
            updates.label = name;
            updates.name = name;
        }
        if (repoPath !== undefined) updates.path = repoPath;
        if (compression !== undefined) updates.compression = compression;

        console.log(`💾 Updating repository in repositories-unused.yaml at index ${unusedIndex}`);

        // Update in the unused repositories list at the CORRECT index
        unusedRepos[unusedIndex] = updates;
        await configParser.saveUnusedRepositories(unusedRepos);

        // Refresh the config parser so it re-reads the file
        await configParser.refresh();

        console.log(`✅ Repository updated successfully`);

        res.json({
            success: true,
            message: 'Repository updated successfully',
            data: {
                id: parseInt(req.params.id),
                name: updates.name || updates.label,
                label: updates.label,
                path: updates.path,
                compression: updates.compression,
                is_active: repo.is_active,
                updated_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to update repository:', error);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({ detail: `Failed to update repository: ${error.message}` });
    }
});

router.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;
        const repositories = await borgmaticConfig.getRepositoriesWithStatus();
        const repoIndex = parseInt(req.params.id) - 1;

        if (repoIndex < 0 || repoIndex >= repositories.length) {
            return res.status(404).json({ detail: 'Repository not found' });
        }

        const repo = repositories[repoIndex];

        // Toggle the repository status
        await borgmaticConfig.toggleRepositoryActive(repo.path, is_active);

        res.json({
            success: true,
            message: `Repository ${is_active ? 'activated' : 'deactivated'} successfully`,
            data: {
                id: parseInt(req.params.id),
                name: repo.label,
                path: repo.path,
                is_active
            }
        });
    } catch (error) {
        console.error('Failed to toggle repository status:', error.message);
        res.status(500).json({ detail: 'Failed to toggle repository status' });
    }
});

module.exports = router;
