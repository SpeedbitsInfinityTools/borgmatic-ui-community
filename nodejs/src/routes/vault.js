const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const vaultManager = require('../services/vault-manager');
const identityManager = require('../services/identity-manager');

/**
 * Vault Management Routes
 * For securely storing client repository passphrases
 */

// Middleware to ensure Director mode
async function requireDirectorMode(req, res, next) {
    try {
        const identity = await identityManager.getIdentity();
        
        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Director mode required for vault management'
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
 * Check if vault is initialized
 */
router.get('/status', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const initialized = await vaultManager.isInitialized();
        
        res.json({
            success: true,
            data: {
                initialized,
                message: initialized 
                    ? 'Vault is initialized' 
                    : 'Vault not initialized. Please set master password.'
            }
        });
    } catch (error) {
        console.error('Failed to check vault status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to check vault status'
        });
    }
});

/**
 * Initialize vault with master password
 */
router.post('/initialize', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { master_password, confirm_password } = req.body;

        if (!master_password || !confirm_password) {
            return res.status(400).json({
                success: false,
                detail: 'Master password and confirmation are required'
            });
        }

        if (master_password !== confirm_password) {
            return res.status(400).json({
                success: false,
                detail: 'Passwords do not match'
            });
        }

        if (master_password.length < 8) {
            return res.status(400).json({
                success: false,
                detail: 'Master password must be at least 8 characters'
            });
        }

        // Check if already initialized
        const initialized = await vaultManager.isInitialized();
        if (initialized) {
            return res.status(400).json({
                success: false,
                detail: 'Vault is already initialized'
            });
        }

        await vaultManager.initialize(master_password);

        res.json({
            success: true,
            message: 'Vault initialized successfully'
        });
    } catch (error) {
        console.error('Failed to initialize vault:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to initialize vault'
        });
    }
});

/**
 * Verify master password
 */
router.post('/verify', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { master_password } = req.body;

        if (!master_password) {
            return res.status(400).json({
                success: false,
                detail: 'Master password is required'
            });
        }

        const isValid = await vaultManager.verifyMasterPassword(master_password);

        if (isValid) {
            res.json({
                success: true,
                message: 'Master password verified'
            });
        } else {
            res.status(401).json({
                success: false,
                detail: 'Invalid master password'
            });
        }
    } catch (error) {
        console.error('Failed to verify master password:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to verify master password'
        });
    }
});

/**
 * Store passphrase for a client's repository
 */
router.post('/store', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { 
            client_id, 
            repo_id, 
            repo_name, 
            repo_path, 
            passphrase, 
            master_password 
        } = req.body;

        if (!client_id || !repo_id || !repo_name || !repo_path || !passphrase || !master_password) {
            return res.status(400).json({
                success: false,
                detail: 'All fields are required'
            });
        }

        await vaultManager.storePassphrase(
            client_id, 
            repo_id, 
            repo_name, 
            repo_path, 
            passphrase, 
            master_password
        );

        res.json({
            success: true,
            message: `Passphrase stored for ${repo_name}`
        });
    } catch (error) {
        console.error('Failed to store passphrase:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to store passphrase'
        });
    }
});

/**
 * Get passphrase for a client's repository
 */
router.post('/get', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { client_id, repo_id, master_password } = req.body;

        if (!client_id || !repo_id || !master_password) {
            return res.status(400).json({
                success: false,
                detail: 'Client ID, repo ID, and master password are required'
            });
        }

        const passphrase = await vaultManager.getPassphrase(client_id, repo_id, master_password);

        res.json({
            success: true,
            data: { passphrase }
        });
    } catch (error) {
        console.error('Failed to get passphrase:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to get passphrase'
        });
    }
});

/**
 * Get all passphrases for a client
 */
router.post('/client/:clientId', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { master_password } = req.body;

        if (!master_password) {
            return res.status(400).json({
                success: false,
                detail: 'Master password is required'
            });
        }

        const passphrases = await vaultManager.getClientPassphrases(clientId, master_password);

        res.json({
            success: true,
            data: { passphrases }
        });
    } catch (error) {
        console.error(`Failed to get passphrases for client ${req.params.clientId}:`, error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to get client passphrases'
        });
    }
});

/**
 * Get all clients (without passphrases)
 */
router.get('/clients', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const clients = await vaultManager.getAllClients();

        res.json({
            success: true,
            data: { clients }
        });
    } catch (error) {
        console.error('Failed to get vault clients:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get vault clients'
        });
    }
});

/**
 * Change master password
 */
router.post('/change-password', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password) {
            return res.status(400).json({
                success: false,
                detail: 'Current password, new password, and confirmation are required'
            });
        }

        if (new_password !== confirm_password) {
            return res.status(400).json({
                success: false,
                detail: 'New passwords do not match'
            });
        }

        if (new_password.length < 8) {
            return res.status(400).json({
                success: false,
                detail: 'New password must be at least 8 characters'
            });
        }

        await vaultManager.changeMasterPassword(current_password, new_password);

        res.json({
            success: true,
            message: 'Master password changed successfully'
        });
    } catch (error) {
        console.error('Failed to change master password:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to change master password'
        });
    }
});

/**
 * Delete passphrase for a client's repository
 */
router.delete('/client/:clientId/repo/:repoId', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { clientId, repoId } = req.params;

        await vaultManager.deletePassphrase(clientId, repoId);

        res.json({
            success: true,
            message: 'Passphrase deleted successfully'
        });
    } catch (error) {
        console.error(`Failed to delete passphrase for ${req.params.clientId}/${req.params.repoId}:`, error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to delete passphrase'
        });
    }
});

/**
 * Delete all passphrases for a client
 */
router.delete('/client/:clientId', authenticateToken, requireAdmin, requireDirectorMode, async (req, res) => {
    try {
        const { clientId } = req.params;

        await vaultManager.deleteClient(clientId);

        res.json({
            success: true,
            message: `All passphrases for client ${clientId} deleted successfully`
        });
    } catch (error) {
        console.error(`Failed to delete client ${req.params.clientId}:`, error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to delete client'
        });
    }
});

module.exports = router;

