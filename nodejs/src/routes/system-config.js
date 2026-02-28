const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const configManager = require('../services/config-manager');
const certManager = require('../services/cert-manager');

/**
 * System Configuration Routes
 * For managing application configuration dynamically
 */

/**
 * Get current system configuration
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const config = await configManager.getConfig();
        const certInfo = await certManager.getCertificateInfo();

        res.json({
            success: true,
            data: {
                config: config,
                certificate: certInfo
            }
        });
    } catch (error) {
        console.error('Failed to get system config:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get system configuration'
        });
    }
});

/**
 * Update system configuration
 */
router.put('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { updates } = req.body;

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                success: false,
                detail: 'Invalid configuration updates'
            });
        }

        await configManager.updateEnv(updates);

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            note: 'Server restart required for changes to take effect'
        });
    } catch (error) {
        console.error('Failed to update config:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update configuration'
        });
    }
});

/**
 * Configure domain and CORS
 */
router.post('/domain', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { domain, additional_domains } = req.body;

        if (!domain) {
            return res.status(400).json({
                success: false,
                detail: 'Domain is required'
            });
        }

        // Build domains list
        const domains = [domain];
        if (additional_domains && Array.isArray(additional_domains)) {
            domains.push(...additional_domains);
        }

        // Update DOMAIN in .env
        await configManager.updateEnv({ DOMAIN: domain });

        // Configure CORS
        const corsResult = await configManager.configureCors(domains);

        // Regenerate SSL certificates with new domain
        await certManager.regenerateCertificates();

        res.json({
            success: true,
            message: 'Domain and CORS configured successfully',
            data: {
                domain: domain,
                cors_origins: corsResult.origins
            },
            note: 'Server restart required for changes to take effect'
        });
    } catch (error) {
        console.error('Failed to configure domain:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to configure domain and CORS settings'
        });
    }
});

/**
 * Get SSL certificate info
 */
router.get('/certificate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const certInfo = await certManager.getCertificateInfo();

        if (!certInfo) {
            return res.status(404).json({
                success: false,
                detail: 'No certificate found'
            });
        }

        res.json({
            success: true,
            data: { certificate: certInfo }
        });
    } catch (error) {
        console.error('Failed to get certificate info:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get certificate information'
        });
    }
});

/**
 * Regenerate SSL certificate
 */
router.post('/certificate/regenerate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await certManager.regenerateCertificates();

        const certInfo = await certManager.getCertificateInfo();

        res.json({
            success: true,
            message: 'SSL certificate regenerated successfully',
            data: { certificate: certInfo },
            note: 'Server restart required for new certificate to take effect'
        });
    } catch (error) {
        console.error('Failed to regenerate certificate:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to regenerate SSL certificate'
        });
    }
});

module.exports = router;

