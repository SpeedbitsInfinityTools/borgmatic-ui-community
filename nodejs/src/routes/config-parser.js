const express = require('express');
const router = express.Router();
const configParser = require('../services/config-parser');

/**
 * @route   GET /api/config-parser/parse
 * @desc    Parse all configuration files from borgmatic.d/
 * @access  Private
 */
router.get('/parse', async (req, res) => {
    try {
        const result = await configParser.parseAllConfigs();
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error parsing configs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route   GET /api/config-parser/refresh
 * @desc    Force refresh configuration parsing
 * @access  Private
 */
router.get('/refresh', async (req, res) => {
    try {
        const result = await configParser.refresh();
        res.json({
            success: true,
            data: result,
            message: 'Configuration refreshed successfully'
        });
    } catch (error) {
        console.error('Error refreshing configs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route   GET /api/config-parser/state
 * @desc    Get current parsed state without re-parsing
 * @access  Private
 */
router.get('/state', async (req, res) => {
    try {
        const state = configParser.getCurrentState();
        
        // If never parsed, do initial parse
        if (!state.lastParsed) {
            const result = await configParser.parseAllConfigs();
            return res.json({
                success: true,
                data: result
            });
        }

        res.json({
            success: true,
            data: state
        });
    } catch (error) {
        console.error('Error getting config state:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route   GET /api/config-parser/repositories
 * @desc    Get all repositories with usage status
 * @access  Private
 */
router.get('/repositories', async (req, res) => {
    try {
        const repositories = await configParser.getAllRepositoriesWithUsage();
        res.json({
            success: true,
            data: {
                repositories
            }
        });
    } catch (error) {
        console.error('Error getting repositories:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route   GET /api/config-parser/backups/:repoPath
 * @desc    Get backups that use a specific repository
 * @access  Private
 */
router.get('/backups/:repoPath', async (req, res) => {
    try {
        const repoPath = decodeURIComponent(req.params.repoPath);
        const backups = await configParser.getBackupsUsingRepository(repoPath);
        res.json({
            success: true,
            data: {
                repoPath,
                backups,
                isUsed: backups.length > 0
            }
        });
    } catch (error) {
        console.error('Error getting backups for repository:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
