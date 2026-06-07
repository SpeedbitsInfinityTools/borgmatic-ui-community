const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const passwordManager = require('../../services/password-manager');
const configParser = require('../../services/config-parser');
const fs = require('fs-extra');
const {
    detectRepoVersion,
    getBorgCommand
} = require('../../services/borg-version-detector');
const { writeSSHKeyToFilesystem } = require('./helpers');

/**
 * Update/set passphrase for a repository
 * POST /api/repositories/:repoId/passphrase
 */
router.post('/:repoId/passphrase', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repoId } = req.params;
        const { passphrase, verify = true } = req.body;

        if (!passphrase) {
            return res.status(400).json({
                success: false,
                detail: 'Passphrase is required'
            });
        }

        // Find repository by ID (support both actual IDs and legacy IDs like "repo-legacy-1")
        const repositories = await configParser.getAllRepositoriesWithUsage();
        let repo = repositories.find(r => r.id === repoId);

        // If not found by actual ID, try legacy ID format
        if (!repo && repoId.startsWith('repo-legacy-')) {
            const legacyIndex = parseInt(repoId.replace('repo-legacy-', '')) - 1;
            if (legacyIndex >= 0 && legacyIndex < repositories.length) {
                repo = repositories[legacyIndex];
                console.log(`🔍 [Repos] Found repository by legacy ID: ${repoId} -> ${repo.path}`);
            }
        }

        if (!repo) {
            return res.status(404).json({
                success: false,
                detail: 'Repository not found'
            });
        }

        console.log(`🔑 [Repos] Setting passphrase for repository: ${repo.path}`);

        // Optionally verify passphrase by trying to list archives
        let tempKeyPath = null;
        if (verify) {
            try {
                const { execa } = require('execa');
                const env = {
                    ...process.env,
                    BORG_PASSPHRASE: passphrase
                };

                // Use stored borg_version (default to 1.x for existing repos without version stored)
                // This avoids the expensive version detection over SSH which can timeout
                const borgVersion = repo.borg_version || '1.x';
                console.log(`🔍 [Repos] Verifying passphrase for Borg ${borgVersion} repo...`);

                // Check if this is a remote SSH repository that needs SSH key setup
                const isSSH = repo.path.startsWith('ssh://');
                if (isSSH && repo.ssh_key_id) {
                    try {
                        const sshKeysAPI = require('../../services/ssh-keys');
                        const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);

                        if (sshKey && sshKey.private_key) {
                            // Write SSH key to temp file
                            const keyPassphrase = sshKey.is_encrypted && sshKey.passphrase ? sshKey.passphrase : null;
                            tempKeyPath = await writeSSHKeyToFilesystem(repo.ssh_key_id, sshKey.private_key, keyPassphrase);

                            // Extract port from SSH URL if present
                            const urlMatch = repo.path.match(/ssh:\/\/[^@]+@[^:\/]+(?::(\d+))?/);
                            const port = urlMatch?.[1] || '22';

                            // Set BORG_RSH to use the SSH key
                            env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=30`;
                            console.log(`🔑 [Repos] Using SSH key for verification: ${tempKeyPath}`);
                        }
                    } catch (sshError) {
                        console.warn(`⚠️  [Repos] Could not load SSH key: ${sshError.message}`);
                    }
                }

                const { command, args } = getBorgCommand(borgVersion, 'info', {
                    repoPath: repo.path,
                    extraArgs: ['--json'],
                });

                console.log(`🔍 [Repos] Executing verification: ${command} ${args.join(' ')}`);
                await execa(command, args, {
                    env,
                    timeout: 60000  // Increased timeout for remote repos
                });
                console.log(`✅ [Repos] Passphrase verified successfully`);
            } catch (verifyError) {
                const errorMsg = verifyError.stderr || verifyError.message || '';

                if (errorMsg.includes('passphrase') ||
                    errorMsg.includes('wrong key') ||
                    errorMsg.includes('Passphrase')) {
                    // Clean up temp key before returning
                    if (tempKeyPath) {
                        try { await fs.unlink(tempKeyPath); } catch (e) {}
                    }
                    return res.status(400).json({
                        success: false,
                        detail: 'Invalid passphrase. The passphrase does not match the repository encryption.',
                        error: 'passphrase_invalid'
                    });
                }

                // Other errors might be network/access issues, not passphrase problems
                console.warn(`⚠️  [Repos] Verification warning: ${errorMsg}`);
            } finally {
                // Clean up temp SSH key file
                if (tempKeyPath) {
                    try { await fs.unlink(tempKeyPath); } catch (e) {}
                }
            }
        }

        // Store the passphrase
        await passwordManager.storeRepositoryPassphrase(repo.path, passphrase);

        // Get actual encryption info now that we have the passphrase
        let encryptionInfo = null;
        try {
            const { execa } = require('execa');
            const env = {
                ...process.env,
                BORG_PASSPHRASE: passphrase
            };

            // Use detectRepoVersion to get the correct version and binary
            const versionResult = await detectRepoVersion(repo.path, passphrase);
            if (!versionResult.version) {
                throw new Error(versionResult.error || 'Could not detect Borg version');
            }

            const { command, args } = getBorgCommand(versionResult.version, 'info', {
                repoPath: repo.path,
                extraArgs: ['--json'],
            });

            console.log(`🔍 [Repos] Executing encryption info retrieval: ${command} ${args.join(' ')}`);
            const { stdout } = await execa(command, args, {
                env,
                timeout: 30000
            });

            const info = JSON.parse(stdout);
            encryptionInfo = {
                mode: info.encryption?.mode || 'unknown',
                keyfile: info.encryption?.keyfile || null
            };
            console.log(`📊 [Repos] Got encryption info: ${encryptionInfo.mode}`);
        } catch (infoError) {
            console.warn(`⚠️  [Repos] Could not get encryption info: ${infoError.message}`);
        }

        res.json({
            success: true,
            message: 'Passphrase updated successfully',
            encryption: encryptionInfo
        });
    } catch (error) {
        console.error('Failed to update passphrase:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update passphrase'
        });
    }
});

/**
 * Check if repository has stored passphrase
 * GET /api/repositories/:repoId/passphrase/status
 */
router.get('/:repoId/passphrase/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repoId } = req.params;

        // Find repository by ID (support both actual IDs and legacy IDs)
        const repositories = await configParser.getAllRepositoriesWithUsage();
        let repo = repositories.find(r => r.id === repoId);

        // If not found by actual ID, try legacy ID format
        if (!repo && repoId.startsWith('repo-legacy-')) {
            const legacyIndex = parseInt(repoId.replace('repo-legacy-', '')) - 1;
            if (legacyIndex >= 0 && legacyIndex < repositories.length) {
                repo = repositories[legacyIndex];
            }
        }

        if (!repo) {
            return res.status(404).json({
                success: false,
                detail: 'Repository not found'
            });
        }

        const passphrase = await passwordManager.getRepositoryPassphrase(repo.path);

        res.json({
            success: true,
            has_passphrase: !!passphrase,
            repository: repo.path
        });
    } catch (error) {
        console.error('Failed to check passphrase status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to check passphrase status'
        });
    }
});

/**
 * Verify stored passphrase actually works (runs borg info)
 * GET /api/repositories/:repoId/passphrase/verify
 *
 * Returns:
 * - needs_passphrase: true if no passphrase stored or verification failed
 * - is_valid: true if stored passphrase works
 * - encryption: encryption mode if verification succeeded
 */
router.get('/:repoId/passphrase/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repoId } = req.params;

        // Find repository by ID (support both actual IDs and legacy IDs)
        const repositories = await configParser.getAllRepositoriesWithUsage();
        let repo = repositories.find(r => r.id === repoId);

        // If not found by actual ID, try legacy ID format
        if (!repo && repoId.startsWith('repo-legacy-')) {
            const legacyIndex = parseInt(repoId.replace('repo-legacy-', '')) - 1;
            if (legacyIndex >= 0 && legacyIndex < repositories.length) {
                repo = repositories[legacyIndex];
            }
        }

        if (!repo) {
            return res.status(404).json({
                success: false,
                detail: 'Repository not found'
            });
        }

        // Check if repo has encryption
        const hasEncryption = repo.encryption && repo.encryption !== 'none' && repo.encryption !== 'unknown';

        // If no encryption, passphrase is not needed
        if (!hasEncryption && repo.encryption !== 'unknown') {
            return res.json({
                success: true,
                needs_passphrase: false,
                is_valid: true,
                encryption: repo.encryption || 'none',
                message: 'Repository is not encrypted'
            });
        }

        // Check if passphrase is stored
        const storedPassphrase = await passwordManager.getRepositoryPassphrase(repo.path);

        if (!storedPassphrase) {
            return res.json({
                success: true,
                needs_passphrase: true,
                is_valid: false,
                encryption: repo.encryption,
                message: 'No passphrase stored for this encrypted repository'
            });
        }

        // Verify passphrase by running borg info (using stored borg_version to avoid slow detection)
        let tempKeyPath = null;
        try {
            const { execa } = require('execa');
            const env = {
                ...process.env,
                BORG_PASSPHRASE: storedPassphrase
            };

            // Use stored borg_version (default to 1.x for existing repos without version stored)
            // This avoids the expensive version detection over SSH which can timeout
            const borgVersion = repo.borg_version || '1.x';
            console.log(`🔍 [Repos] Verifying stored passphrase for: ${repo.path} (Borg ${borgVersion})`);

            // Check if this is a remote SSH repository that needs SSH key setup
            const isSSH = repo.path.startsWith('ssh://');
            if (isSSH && repo.ssh_key_id) {
                try {
                    const sshKeysAPI = require('../../services/ssh-keys');
                    const sshKey = await sshKeysAPI.getSSHKey(repo.ssh_key_id);

                    if (sshKey && sshKey.private_key) {
                        // Write SSH key to temp file
                        const passphrase = sshKey.is_encrypted && sshKey.passphrase ? sshKey.passphrase : null;
                        tempKeyPath = await writeSSHKeyToFilesystem(repo.ssh_key_id, sshKey.private_key, passphrase);

                        // Extract port from SSH URL if present (ssh://user@host:port/path)
                        const urlMatch = repo.path.match(/ssh:\/\/[^@]+@[^:\/]+(?::(\d+))?/);
                        const port = urlMatch?.[1] || '22';

                        // Set BORG_RSH to use the SSH key
                        env.BORG_RSH = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -p ${port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=30`;
                        console.log(`🔑 [Repos] Using SSH key for verification: ${tempKeyPath}`);
                    }
                } catch (sshError) {
                    console.warn(`⚠️  [Repos] Could not load SSH key: ${sshError.message}`);
                    // Continue without SSH key - will likely fail but with better error message
                }
            }

            // Get the correct command for this Borg version
            // For Hetzner Storage Boxes, include --remote-path to specify remote Borg version
            const { command, args } = getBorgCommand(borgVersion, 'info', {
                repoPath: repo.path,
                extraArgs: ['--json'],
                remotePath: repo.hetzner_borg_version, // e.g., 'borg-1.4' for Hetzner
            });

            console.log(`🔍 [Repos] Executing verification: ${command} ${args.join(' ')}`);
            const result = await execa(command, args, {
                env,
                timeout: 60000  // Increased timeout for remote repos
            });

            // Parse result to get encryption info
            let encryptionMode = repo.encryption;
            try {
                const info = JSON.parse(result.stdout);
                encryptionMode = info.encryption?.mode || repo.encryption;
            } catch (parseErr) {
                // Ignore parse errors, use existing encryption info
            }

            console.log(`✅ [Repos] Passphrase verified successfully for: ${repo.path}`);
            return res.json({
                success: true,
                needs_passphrase: false,
                is_valid: true,
                encryption: encryptionMode,
                message: 'Stored passphrase is valid'
            });
        } catch (borgError) {
            console.warn(`❌ [Repos] Passphrase verification failed: ${borgError.message}`);

            // Check if it's a passphrase error vs other error
            const isPassphraseError = borgError.stderr?.includes('passphrase') ||
                borgError.stderr?.includes('Wrong passphrase') ||
                borgError.stderr?.includes('incorrect') ||
                borgError.message?.includes('passphrase');

            return res.json({
                success: true,
                needs_passphrase: true,
                is_valid: false,
                encryption: repo.encryption,
                message: isPassphraseError
                    ? 'Stored passphrase is incorrect'
                    : `Could not verify passphrase: ${borgError.message}`,
                error_type: isPassphraseError ? 'wrong_passphrase' : 'connection_error'
            });
        } finally {
            // Clean up temp SSH key file if created
            if (tempKeyPath) {
                try {
                    await fs.unlink(tempKeyPath);
                    console.log(`🧹 [Repos] Cleaned up temp SSH key: ${tempKeyPath}`);
                } catch (cleanupErr) {
                    // Ignore cleanup errors
                }
            }
        }
    } catch (error) {
        console.error('Failed to verify passphrase:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to verify passphrase: ' + error.message
        });
    }
});

module.exports = router;
