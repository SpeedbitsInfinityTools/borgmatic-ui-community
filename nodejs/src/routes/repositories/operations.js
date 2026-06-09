const express = require('express');
const router = express.Router();
const configParser = require('../../services/config-parser');
const borgmaticCLI = require('../../services/borgmatic-cli');
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const repositoryCredentials = require('../../services/repository-credentials');
const { writeSSHKeyToFilesystem } = require('./helpers');
const path = require('path');
const fs = require('fs-extra');
const { buildBorgPasswordSshArgs } = require('../../utils/ssh-password-auth');

router.post('/:id/check', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repoId = req.params.id;
        console.log(`🔍 [operations.js] Checking repository with ID: ${repoId}`);
        
        // Get all repositories using the new system
        const allRepositories = await configParser.getAllRepositoriesWithUsage();
        
        // Find repository by ID (could be numeric index, string ID, or repo-legacy-X format)
        let repo = null;
        
        // Handle repo-legacy-X format (from /list endpoint)
        const legacyMatch = repoId.match(/^repo-legacy-(\d+)$/);
        if (legacyMatch) {
            const repoIndex = parseInt(legacyMatch[1]) - 1;
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
            }
        }
        
        // Try numeric index (legacy support)
        if (!repo && !isNaN(repoId)) {
            const repoIndex = parseInt(repoId) - 1;
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
            }
        }
        
        // If not found by index, try to find by ID field or path
        if (!repo) {
            repo = allRepositories.find(r => 
                r.id === repoId || 
                r.id?.toString() === repoId ||
                path.normalize(r.path) === path.normalize(repoId)
            );
        }
        
        if (!repo) {
            console.error(`❌ [operations.js] Repository not found: ${repoId}`);
            console.error(`❌ [operations.js] Available repos: ${allRepositories.map(r => r.path).join(', ')}`);
            return res.status(404).json({ detail: 'Repository not found' });
        }
        
        console.log(`✅ [operations.js] Found repository: ${repo.name} at ${repo.path}`);
        
        // Get passphrase for the repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
            if (passphrase) {
                console.log(`🔑 [operations.js] Found passphrase for repository`);
            }
        } catch (passphraseError) {
            console.warn(`⚠️  [operations.js] Could not get passphrase: ${passphraseError.message}`);
        }
        
        // Prepare environment variables
        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }
        
        // Handle SSH authentication for SSH/SFTP/Hetzner repositories
        let tempKeyPath = null;
        if (repo.repository_type === 'ssh' || repo.repository_type === 'sftp' || repo.repository_type === 'hetzner') {
            try {
                const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');
                console.log(`🔐 [operations.js] SSH/Hetzner repository detected (type: ${repo.repository_type}), auth method: ${authMethod}`);
                
                if (authMethod === 'key' && repo.ssh_key_id) {
                    // Get SSH key and write to temporary file
                    const sshKeysAPI = require('../../services/ssh-keys');
                    const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
                    
                    if (sshKey && sshKey.private_key) {
                        tempKeyPath = await writeSSHKeyToFilesystem(repo.ssh_key_id, sshKey.private_key, sshKey.passphrase || null);
                        
                        // Extract connection details from SSH path
                        const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        if (sshMatch) {
                            const port = sshMatch[3] || '22';
                            env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new`;
                            console.log(`🔑 [operations.js] Using SSH key authentication`);
                        }
                    }
                } else if (authMethod === 'password') {
                    // Get SSH password
                    const sshPassword = await repositoryCredentials.getSSHPassword(repo.path);
                    if (sshPassword) {
                        // Extract connection details from SSH path
                        const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        if (sshMatch) {
                            const port = sshMatch[3] || '22';
                            env.SSHPASS = sshPassword;
                            // Pin to password-only auth (see browsing.js
                            // PASSWORD_AUTH_SSH_FLAGS rationale: avoids the
                            // /root/.ssh-keys-offered-first fail2ban trap).
                            env.BORG_RSH = `sshpass -e ssh -p ${port} ${buildBorgPasswordSshArgs()} -o StrictHostKeyChecking=accept-new`;
                            console.log(`🔐 [operations.js] Using SSH password authentication`);
                        }
                    }
                }
            } catch (sshError) {
                console.error(`❌ [operations.js] Failed to setup SSH authentication: ${sshError.message}`);
                // Continue anyway - borg might prompt for credentials
            }
        }
        
        try {
            // Determine Borg version to use
            // For Hetzner, always use Borg 1.x (Hetzner only supports 1.x)
            const borgVersion = repo.repository_type === 'hetzner' ? '1.x' : (repo.borg_version || '1.x');
            
            // For Hetzner, use the specified remote Borg version
            const remotePath = repo.repository_type === 'hetzner' ? (repo.hetzner_borg_version || 'borg-1.4') : undefined;
            
            console.log(`🔧 [operations.js] Using Borg ${borgVersion}${remotePath ? `, remote-path: ${remotePath}` : ''}`);
            
            // Check repository
            const result = await borgmaticCLI.checkRepository(repo.path, {
                env,
                timeout: 3600000, // 1 hour timeout for check operations
                borgVersion,
                remotePath,
            });
            
            // Clean up temp key file
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => {});
            }
            
            if (result.success) {
                res.json({
                    success: true,
                    message: 'Repository check completed successfully',
                    output: result.stdout
                });
            } else {
                console.error(`❌ [operations.js] Repository check failed: ${result.error}`);
                res.status(500).json({
                    success: false,
                    message: 'Repository check failed',
                    error: result.error || result.stderr || 'Unknown error',
                    stdout: result.stdout
                });
            }
        } catch (checkError) {
            // Clean up temp key file on error
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => {});
            }
            throw checkError;
        }
    } catch (error) {
        console.error('❌ [operations.js] Failed to check repository:', error.message);
        console.error('❌ [operations.js] Error stack:', error.stack);
        res.status(500).json({ 
            detail: 'Failed to check repository: ' + error.message,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.post('/:id/compact', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repoId = req.params.id;
        console.log(`🔍 [operations.js] Compacting repository with ID: ${repoId}`);
        
        // Get all repositories using the new system
        const allRepositories = await configParser.getAllRepositoriesWithUsage();
        
        // Find repository by ID (could be numeric index, string ID, or repo-legacy-X format)
        let repo = null;
        
        // Handle repo-legacy-X format (from /list endpoint)
        const legacyMatch = repoId.match(/^repo-legacy-(\d+)$/);
        if (legacyMatch) {
            const repoIndex = parseInt(legacyMatch[1]) - 1;
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
            }
        }
        
        // Try numeric index (legacy support)
        if (!repo && !isNaN(repoId)) {
            const repoIndex = parseInt(repoId) - 1;
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
            }
        }
        
        // If not found by index, try to find by ID field or path
        if (!repo) {
            repo = allRepositories.find(r => 
                r.id === repoId || 
                r.id?.toString() === repoId ||
                path.normalize(r.path) === path.normalize(repoId)
            );
        }
        
        if (!repo) {
            console.error(`❌ [operations.js] Repository not found: ${repoId}`);
            return res.status(404).json({ detail: 'Repository not found' });
        }
        
        console.log(`✅ [operations.js] Found repository: ${repo.name} at ${repo.path}`);
        
        // Get passphrase for the repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
            if (passphrase) {
                console.log(`🔑 [operations.js] Found passphrase for repository`);
            }
        } catch (passphraseError) {
            console.warn(`⚠️  [operations.js] Could not get passphrase: ${passphraseError.message}`);
        }
        
        // Prepare environment variables
        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }
        
        // Handle SSH authentication for SSH/SFTP/Hetzner repositories
        let tempKeyPath = null;
        if (repo.repository_type === 'ssh' || repo.repository_type === 'sftp' || repo.repository_type === 'hetzner') {
            try {
                const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');
                console.log(`🔐 [operations.js] SSH/Hetzner repository detected (type: ${repo.repository_type}), auth method: ${authMethod}`);
                
                if (authMethod === 'key' && repo.ssh_key_id) {
                    // Get SSH key and write to temporary file
                    const sshKeysAPI = require('../../services/ssh-keys');
                    const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
                    
                    if (sshKey && sshKey.private_key) {
                        tempKeyPath = await writeSSHKeyToFilesystem(repo.ssh_key_id, sshKey.private_key, sshKey.passphrase || null);
                        
                        // Extract connection details from SSH path
                        const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        if (sshMatch) {
                            const port = sshMatch[3] || '22';
                            env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new`;
                            console.log(`🔑 [operations.js] Using SSH key authentication`);
                        }
                    }
                } else if (authMethod === 'password') {
                    // Get SSH password
                    const sshPassword = await repositoryCredentials.getSSHPassword(repo.path);
                    if (sshPassword) {
                        // Extract connection details from SSH path
                        const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        if (sshMatch) {
                            const port = sshMatch[3] || '22';
                            env.SSHPASS = sshPassword;
                            // Pin to password-only auth (see browsing.js
                            // PASSWORD_AUTH_SSH_FLAGS rationale: avoids the
                            // /root/.ssh-keys-offered-first fail2ban trap).
                            env.BORG_RSH = `sshpass -e ssh -p ${port} ${buildBorgPasswordSshArgs()} -o StrictHostKeyChecking=accept-new`;
                            console.log(`🔐 [operations.js] Using SSH password authentication`);
                        }
                    }
                }
            } catch (sshError) {
                console.error(`❌ [operations.js] Failed to setup SSH authentication: ${sshError.message}`);
                // Continue anyway - borg might prompt for credentials
            }
        }
        
        try {
            // Determine Borg version to use
            // For Hetzner, always use Borg 1.x (Hetzner only supports 1.x)
            const borgVersion = repo.repository_type === 'hetzner' ? '1.x' : (repo.borg_version || '1.x');
            
            // For Hetzner, use the specified remote Borg version
            const remotePath = repo.repository_type === 'hetzner' ? (repo.hetzner_borg_version || 'borg-1.4') : undefined;
            
            console.log(`🔧 [operations.js] Using Borg ${borgVersion}${remotePath ? `, remote-path: ${remotePath}` : ''}`);
            
            // Compact repository
            const result = await borgmaticCLI.compactRepository(repo.path, {
                env,
                timeout: 3600000, // 1 hour timeout for compact operations
                borgVersion,
                remotePath,
            });
            
            // Clean up temp key file
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => {});
            }
            
            if (result.success) {
                res.json({
                    success: true,
                    message: 'Repository compaction completed successfully',
                    output: result.stdout
                });
            } else {
                console.error(`❌ [operations.js] Repository compaction failed: ${result.error}`);
                res.status(500).json({
                    success: false,
                    message: 'Repository compaction failed',
                    error: result.error || result.stderr || 'Unknown error',
                    stdout: result.stdout
                });
            }
        } catch (compactError) {
            // Clean up temp key file on error
            if (tempKeyPath) {
                await fs.remove(tempKeyPath).catch(() => {});
            }
            throw compactError;
        }
    } catch (error) {
        console.error('❌ [operations.js] Failed to compact repository:', error.message);
        console.error('❌ [operations.js] Error stack:', error.stack);
        res.status(500).json({ 
            detail: 'Failed to compact repository: ' + error.message,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.get('/:id/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const repoId = req.params.id;
        console.log(`🔍 [Stats] Getting stats for repository with ID: ${repoId}`);
        
        // Get all repositories using the new system
        const allRepositories = await configParser.getAllRepositoriesWithUsage();
        
        // Find repository by ID (could be numeric index, synthetic ID, or path)
        let repo = null;
        
        // Check for synthetic ID format: repo-legacy-{index} or repo-discovered-{index}
        const syntheticIdMatch = repoId.match(/^repo-(legacy|discovered)-(\d+)$/);
        if (syntheticIdMatch) {
            const repoIndex = parseInt(syntheticIdMatch[2]) - 1; // Convert 1-based to 0-based
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
                console.log(`✅ [Stats] Found by synthetic ID at index ${repoIndex}`);
            }
        }
        
        // Try numeric index (legacy support)
        if (!repo && !isNaN(repoId)) {
            const repoIndex = parseInt(repoId) - 1;
            if (repoIndex >= 0 && repoIndex < allRepositories.length) {
                repo = allRepositories[repoIndex];
            }
        }
        
        // If not found by index, try to find by ID field or path
        if (!repo) {
            repo = allRepositories.find(r => 
                r.id === repoId || 
                r.id?.toString() === repoId ||
                path.normalize(r.path) === path.normalize(repoId)
            );
        }
        
        // Try URL-decoded path match
        if (!repo) {
            const decodedId = decodeURIComponent(repoId);
            repo = allRepositories.find(r => r.path === decodedId);
        }
        
        if (!repo) {
            console.error(`❌ [Stats] Repository not found: ${repoId}`);
            console.log(`📋 [Stats] Available repos: ${allRepositories.map(r => r.path).join(', ')}`);
            return res.status(404).json({ detail: 'Repository not found' });
        }
        
        console.log(`✅ [Stats] Found repository: ${repo.name} at ${repo.path}`);
        
        // Get passphrase for the repository
        let passphrase = null;
        try {
            passphrase = await passwordManager.getRepositoryPassphrase(repo.path);
            if (passphrase) {
                console.log(`🔑 [Stats] Found passphrase for repository`);
            }
        } catch (passphraseError) {
            console.warn(`⚠️  [Stats] Could not get passphrase: ${passphraseError.message}`);
        }
        
        // Prepare environment variables
        const env = { ...process.env };
        if (passphrase) {
            env.BORG_PASSPHRASE = passphrase;
        }
        
        // Set up SSH authentication if needed
        const isSSHRepo = repo.path.startsWith('ssh://');
        const isHetznerRepo = repo.repository_type === 'hetzner';
        if ((isSSHRepo || isHetznerRepo) && repo) {
            const authMethod = repo.ssh_auth_method || (repo.ssh_key_id ? 'key' : 'password');
            
            if (authMethod === 'key' && repo.ssh_key_id) {
                try {
                    const sshKeysAPI = require('../../services/ssh-keys');
                    const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);
                    
                    if (sshKey && sshKey.private_key) {
                        const config = require('../../config');
                        const sshKeyDir = path.join(config.dataDir || '/app/data', 'ssh-keys');
                        await fs.ensureDir(sshKeyDir);
                        
                        const tempKeyPath = path.join(sshKeyDir, `stats_key_${Date.now()}`);
                        await fs.writeFile(tempKeyPath, sshKey.private_key, { mode: 0o600 });
                        
                        const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:\/]+)(?::(\d+))?(.*)$/);
                        const port = sshMatch?.[3] || '22';
                        // BatchMode=yes prevents ssh from prompting for passwords or
                        // host-key confirmation (would hang the request indefinitely).
                        // ConnectTimeout caps the TCP handshake at a few seconds so
                        // unreachable hosts fail fast instead of stalling the page.
                        env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2`;
                        console.log(`🔑 [Stats] Using SSH key authentication`);
                    }
                } catch (sshError) {
                    console.warn(`⚠️  [Stats] Failed to set up SSH key auth:`, sshError.message);
                }
            }
        }
        
        // Get Borg version and path
        const borgVersion = repo.borg_version || '1.x';
        const { getBorgCommand, getBorgPath } = require('../../services/borg-version-detector');
        const borgPath = getBorgPath(borgVersion);
        const { execa } = require('execa');
        
        let archiveCount = 0;
        let totalSize = null;
        let lastArchive = null;
        
        // Get archive list using borg list --json
        try {
            const listCmd = getBorgCommand(borgVersion, 'list', {
                repoPath: repo.path,
                extraArgs: ['--json'],
                remotePath: repo.hetzner_borg_version,
            });
            
            console.log(`📊 [Stats] Running borg list for ${repo.path}...`);
            const listResult = await execa(listCmd.command, listCmd.args, {
                env,
                timeout: 60000,
                reject: false
            });
            
            if (listResult.stdout && listResult.stdout.trim()) {
                const listInfo = JSON.parse(listResult.stdout);
                if (Array.isArray(listInfo.archives)) {
                    archiveCount = listInfo.archives.length;
                    // Get last archive date
                    if (archiveCount > 0) {
                        const sorted = listInfo.archives.sort((a, b) => 
                            new Date(b.start || b.time).getTime() - new Date(a.start || a.time).getTime()
                        );
                        const rawTs = sorted[0].start || sorted[0].time;
                        lastArchive = rawTs && !/[Zz]$/.test(rawTs) && !/[+-]\d{2}:\d{2}$/.test(rawTs)
                            ? rawTs + 'Z' : rawTs;
                    }
                    console.log(`📦 [Stats] Archive count: ${archiveCount}, last: ${lastArchive}`);
                }
            }
        } catch (listError) {
            console.warn(`⚠️  [Stats] Could not get archive list:`, listError.message);
        }
        
        // Get repo size using borg info --json
        try {
            const infoCmd = getBorgCommand(borgVersion, 'info', {
                repoPath: repo.path,
                extraArgs: ['--json'],
                remotePath: repo.hetzner_borg_version,
            });
            
            console.log(`📊 [Stats] Running borg info for ${repo.path}...`);
            const infoResult = await execa(infoCmd.command, infoCmd.args, {
                env,
                timeout: 60000,
                reject: false
            });
            
            if (infoResult.stdout && infoResult.stdout.trim()) {
                const info = JSON.parse(infoResult.stdout);
                const cacheStats = info.cache?.stats;
                if (cacheStats) {
                    const sizeBytes = cacheStats.unique_size || cacheStats.unique_csize || 0;
                    if (sizeBytes > 0) {
                        // Format bytes to human readable
                        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                        let size = sizeBytes;
                        let unitIndex = 0;
                        while (size >= 1024 && unitIndex < units.length - 1) {
                            size /= 1024;
                            unitIndex++;
                        }
                        totalSize = `${size.toFixed(2)} ${units[unitIndex]}`;
                        console.log(`📏 [Stats] Total size: ${totalSize}`);
                    }
                }
            }
        } catch (infoError) {
            console.warn(`⚠️  [Stats] Could not get repo info:`, infoError.message);
        }
        
        res.json({
            success: true,
            data: {
                total_size: totalSize,
                archive_count: archiveCount,
                last_backup: lastArchive
            }
        });
    } catch (error) {
        console.error('❌ [Stats] Failed to get repository stats:', error.message);
        console.error('❌ [Stats] Error stack:', error.stack);
        res.status(500).json({ 
            detail: 'Failed to get repository stats: ' + error.message,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;
