const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const {
    detectRepoVersion,
    getEncryptionOptions,
    getDefaultEncryption,
    getAvailableBorgVersions
} = require('../../services/borg-version-detector');

/**
 * Get available Borg versions and their encryption options
 * GET /api/repositories/borg-versions
 */
router.get('/borg-versions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const versions = await getAvailableBorgVersions();

        res.json({
            success: true,
            data: {
                versions,
                encryption_options: {
                    '1.x': getEncryptionOptions('1.x'),
                    '2.x': getEncryptionOptions('2.x'),
                },
                defaults: {
                    '1.x': getDefaultEncryption('1.x'),
                    '2.x': getDefaultEncryption('2.x'),
                }
            }
        });
    } catch (error) {
        console.error('Failed to get Borg versions:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get Borg versions'
        });
    }
});

/**
 * Detect Borg version of an existing repository
 * POST /api/repositories/detect-version
 */
router.post('/detect-version', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { path: repoPath, passphrase } = req.body;

        if (!repoPath) {
            return res.status(400).json({
                success: false,
                detail: 'Repository path is required'
            });
        }

        console.log(`🔍 Detecting Borg version for: ${repoPath}`);
        const result = await detectRepoVersion(repoPath, passphrase);

        if (result.error) {
            return res.status(400).json({
                success: false,
                detail: result.error
            });
        }

        res.json({
            success: true,
            data: {
                version: result.version,
                borg_binary_path: result.borgPath,
            }
        });
    } catch (error) {
        console.error('Failed to detect Borg version:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to detect Borg version'
        });
    }
});

module.exports = router;
