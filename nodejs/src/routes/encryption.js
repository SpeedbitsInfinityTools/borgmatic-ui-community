const express = require('express');
const router = express.Router();
const encryptionManager = require('../services/encryption-manager');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Get available encryption types
 */
router.get('/types', authenticateToken, (req, res) => {
    try {
        const types = encryptionManager.getEncryptionTypes();
        res.json(types);
    } catch (error) {
        console.error('Failed to get encryption types:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get encryption types',
            error: error.message 
        });
    }
});

/**
 * Get encryption recommendations
 */
router.get('/recommendations', authenticateToken, (req, res) => {
    try {
        const recommendations = encryptionManager.getEncryptionRecommendations();
        res.json(recommendations);
    } catch (error) {
        console.error('Failed to get encryption recommendations:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get encryption recommendations',
            error: error.message 
        });
    }
});

/**
 * Get encryption comparison
 */
router.get('/comparison', authenticateToken, (req, res) => {
    try {
        const comparison = encryptionManager.getEncryptionComparison();
        res.json(comparison);
    } catch (error) {
        console.error('Failed to get encryption comparison:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get encryption comparison',
            error: error.message 
        });
    }
});

/**
 * Generate secure passphrase
 */
router.post('/generate-passphrase', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { length = 32 } = req.body;
        const passphrase = encryptionManager.generateSecurePassphrase(length);
        
        res.json({
            passphrase,
            length: passphrase.length,
            strength: 'Very Strong'
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
 * Validate encryption configuration
 */
router.post('/validate', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { encryptionType, passphrase } = req.body;
        
        const validation = encryptionManager.validateEncryptionConfig(encryptionType, passphrase);
        res.json(validation);
    } catch (error) {
        console.error('Failed to validate encryption config:', error.message);
        res.status(500).json({ 
            detail: 'Failed to validate encryption configuration',
            error: error.message 
        });
    }
});

/**
 * Get repository encryption status
 */
router.get('/repository/:path', authenticateToken, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        
        const status = await encryptionManager.getRepositoryEncryptionStatus(decodedPath);
        
        if (!status) {
            return res.status(404).json({ 
                detail: 'Repository not found' 
            });
        }

        res.json(status);
    } catch (error) {
        console.error('Failed to get repository encryption status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get repository encryption status',
            error: error.message 
        });
    }
});

/**
 * Update repository encryption
 */
router.put('/repository/:path', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path } = req.params;
        const decodedPath = decodeURIComponent(path);
        const { encryptionType, passphrase } = req.body;
        
        if (!encryptionType) {
            return res.status(400).json({ 
                detail: 'Encryption type is required' 
            });
        }

        const result = await encryptionManager.updateRepositoryEncryption(
            decodedPath, 
            encryptionType, 
            passphrase
        );

        res.json(result);
    } catch (error) {
        console.error('Failed to update repository encryption:', error.message);
        res.status(500).json({ 
            detail: 'Failed to update repository encryption',
            error: error.message 
        });
    }
});

/**
 * Get encryption summary
 */
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const summary = await encryptionManager.getEncryptionSummary();
        res.json(summary);
    } catch (error) {
        console.error('Failed to get encryption summary:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get encryption summary',
            error: error.message 
        });
    }
});

/**
 * Check if repository is encrypted
 */
router.get('/is-encrypted/:encryptionType', authenticateToken, (req, res) => {
    try {
        const { encryptionType } = req.params;
        const isEncrypted = encryptionManager.isRepositoryEncrypted(encryptionType);
        
        res.json({
            encryptionType,
            isEncrypted
        });
    } catch (error) {
        console.error('Failed to check encryption status:', error.message);
        res.status(500).json({ 
            detail: 'Failed to check encryption status',
            error: error.message 
        });
    }
});

/**
 * Get encryption security level
 */
router.get('/security-level/:encryptionType', authenticateToken, (req, res) => {
    try {
        const { encryptionType } = req.params;
        const securityLevel = encryptionManager.getEncryptionSecurityLevel(encryptionType);
        
        res.json({
            encryptionType,
            securityLevel,
            description: this.getSecurityLevelDescription(securityLevel)
        });
    } catch (error) {
        console.error('Failed to get security level:', error.message);
        res.status(500).json({ 
            detail: 'Failed to get security level',
            error: error.message 
        });
    }
});

/**
 * Get security level description
 */
function getSecurityLevelDescription(level) {
    const descriptions = {
        0: 'No encryption - data is stored in plain text',
        1: 'Very low security',
        2: 'Low security',
        3: 'Medium security',
        4: 'High security',
        5: 'Very high security'
    };
    
    return descriptions[level] || 'Unknown security level';
}

module.exports = router;
