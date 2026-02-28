const express = require('express');
const router = express.Router();
const passwordManager = require('../services/password-manager');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get available password methods
 */
router.get('/methods', authenticateToken, (req, res) => {
    try {
        const methods = passwordManager.getCredentialMethods();
        res.json(methods);
    } catch (error) {
        console.error('Failed to get password methods:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get password methods',
            error: error.message 
        });
    }
});

/**
 * Get password method recommendations
 */
router.get('/recommendations', authenticateToken, (req, res) => {
    try {
        const recommendations = passwordManager.getPasswordMethodRecommendations();
        res.json(recommendations);
    } catch (error) {
        console.error('Failed to get password recommendations:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get password recommendations',
            error: error.message 
        });
    }
});

/**
 * Generate secure passphrase
 */
router.post('/generate', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { length = 32, includeSpecial = true } = req.body;
        const passphrase = passwordManager.generateSecurePassphrase(length, includeSpecial);
        
        res.json({
            passphrase,
            length: passphrase.length,
            strength: 'Very Strong',
            method: 'cryptographically_secure'
        });
    } catch (error) {
        console.error('Failed to generate passphrase:', error.message);
        res.status(500).json({ 
            detail: 'Failed to generate passphrase',
            error: error.message 
        });
    }
});

/**
 * Validate password configuration
 */
router.post('/validate', authenticateToken, (req, res) => {
    try {
        const { method, config } = req.body;
        
        if (!method) {
            return res.status(400).json({ 
                detail: 'Password method is required' 
            });
        }

        const validation = passwordManager.validatePasswordConfig(method, config);
        res.json(validation);
    } catch (error) {
        console.error('Failed to validate password config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to validate password configuration',
            error: error.message 
        });
    }
});

/**
 * Generate password configuration
 */
router.post('/generate-config', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { method, config } = req.body;
        
        if (!method) {
            return res.status(400).json({ 
                detail: 'Password method is required' 
            });
        }

        const passwordConfig = passwordManager.generatePasswordConfig(method, config);
        res.json({
            method,
            config: passwordConfig,
            yamlExample: passwordConfig
        });
    } catch (error) {
        console.error('Failed to generate password config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to generate password configuration',
            error: error.message 
        });
    }
});

/**
 * Get security analysis for password method
 */
router.get('/security/:method', authenticateToken, (req, res) => {
    try {
        const { method } = req.params;
        const analysis = passwordManager.getSecurityAnalysis(method);
        
        res.json({
            method,
            ...analysis
        });
    } catch (error) {
        console.error('Failed to get security analysis:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get security analysis',
            error: error.message 
        });
    }
});

/**
 * Create file-based credential
 */
router.post('/create-file', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { credentialPath, passphrase } = req.body;
        
        if (!credentialPath || !passphrase) {
            return res.status(400).json({ 
                detail: 'Credential path and passphrase are required' 
            });
        }

        const result = await passwordManager.createFileCredential(credentialPath, passphrase);
        res.json(result);
    } catch (error) {
        console.error('Failed to create file credential:', error.message);
        res.status(500).json({ 
            detail: 'Failed to create file credential',
            error: error.message 
        });
    }
});

/**
 * Create systemd credential
 */
router.post('/create-systemd', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { credentialName, passphrase } = req.body;
        
        if (!credentialName || !passphrase) {
            return res.status(400).json({ 
                detail: 'Credential name and passphrase are required' 
            });
        }

        const result = await passwordManager.createSystemdCredential(credentialName, passphrase);
        res.json(result);
    } catch (error) {
        console.error('Failed to create systemd credential:', error.message);
        res.status(500).json({ 
            detail: 'Failed to create systemd credential',
            error: error.message 
        });
    }
});

/**
 * Create container secret
 */
router.post('/create-container', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { secretName, passphrase, secretsDir } = req.body;
        
        if (!secretName || !passphrase) {
            return res.status(400).json({ 
                detail: 'Secret name and passphrase are required' 
            });
        }

        const result = await passwordManager.createContainerSecret(secretName, passphrase, secretsDir);
        res.json(result);
    } catch (error) {
        console.error('Failed to create container secret:', error.message);
        res.status(500).json({ 
            detail: 'Failed to create container secret',
            error: error.message 
        });
    }
});

/**
 * Test KeePassXC credential
 */
router.post('/test-keepassxc', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { databasePath, entryTitle } = req.body;
        
        if (!databasePath || !entryTitle) {
            return res.status(400).json({ 
                detail: 'Database path and entry title are required' 
            });
        }

        const result = await passwordManager.testKeepassxcCredential(databasePath, entryTitle);
        res.json(result);
    } catch (error) {
        console.error('Failed to test KeePassXC credential:', error.message);
        res.status(500).json({ 
            detail: 'Failed to test KeePassXC credential',
            error: error.message 
        });
    }
});

/**
 * Test external command
 */
router.post('/test-command', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { command } = req.body;
        
        if (!command) {
            return res.status(400).json({ 
                detail: 'Command is required' 
            });
        }

        const result = await passwordManager.testExternalCommand(command);
        res.json(result);
    } catch (error) {
        console.error('Failed to test external command:', error.message);
        res.status(500).json({ 
            detail: 'Failed to test external command',
            error: error.message 
        });
    }
});

/**
 * Get password method comparison
 */
router.get('/comparison', authenticateToken, (req, res) => {
    try {
        const methods = passwordManager.getCredentialMethods();
        const comparison = Object.keys(methods).map(method => ({
            method,
            ...methods[method],
            security: passwordManager.getSecurityAnalysis(method).security
        }));

        res.json(comparison);
    } catch (error) {
        console.error('Failed to get password comparison:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get password comparison',
            error: error.message 
        });
    }
});

module.exports = router;
