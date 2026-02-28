/**
 * Script Management API Routes
 * Manages pre/post backup scripts
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const scriptManager = require('../services/script-manager');

/**
 * GET /api/scripts
 * Get all scripts (templates + custom)
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { hook_type, category } = req.query;
        let scripts = await scriptManager.getAllScripts();

        if (hook_type) {
            scripts = scripts.filter(s => s.hook_type === hook_type);
        }

        if (category) {
            scripts = scripts.filter(s => s.category === category);
        }

        res.json({
            success: true,
            data: {
                scripts,
                total: scripts.length
            }
        });
    } catch (error) {
        console.error('Failed to get scripts:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/scripts/categories
 * Get script categories
 */
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const categories = scriptManager.getCategories();
        res.json({
            success: true,
            data: { categories }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/scripts/templates
 * Get only template scripts
 */
router.get('/templates', authenticateToken, async (req, res) => {
    try {
        const templates = scriptManager.getDefaultScripts();
        res.json({
            success: true,
            data: {
                scripts: templates,
                total: templates.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/scripts/:id
 * Get a specific script
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const script = await scriptManager.getScript(req.params.id);
        
        if (!script) {
            return res.status(404).json({
                success: false,
                error: 'Script not found'
            });
        }

        res.json({
            success: true,
            data: script
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scripts
 * Create a new script
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, description, category, icon, hook_type, script, timeout, run_condition } = req.body;

        if (!name || !script) {
            return res.status(400).json({
                success: false,
                error: 'Name and script content are required'
            });
        }

        const newScript = await scriptManager.createScript({
            name,
            description,
            category,
            icon,
            hook_type,
            script,
            timeout,
            run_condition
        });

        res.status(201).json({
            success: true,
            data: newScript
        });
    } catch (error) {
        console.error('Failed to create script:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scripts/copy-template/:templateId
 * Copy a template to create a custom script
 */
router.post('/copy-template/:templateId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { templateId } = req.params;
        const customizations = req.body;

        const newScript = await scriptManager.copyTemplate(templateId, customizations);

        res.status(201).json({
            success: true,
            data: newScript
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/scripts/:id
 * Update a script
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const script = await scriptManager.updateScript(id, updates);

        res.json({
            success: true,
            data: script
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/scripts/:id
 * Delete a script
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await scriptManager.deleteScript(req.params.id);

        res.json({
            success: true,
            message: 'Script deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scripts/:id/test
 * Test a script execution
 */
router.post('/:id/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const script = await scriptManager.getScript(req.params.id);
        
        if (!script) {
            return res.status(404).json({
                success: false,
                error: 'Script not found'
            });
        }

        const result = await scriptManager.testScript(script.script, script.timeout || 30);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scripts/test-content
 * Test a script from content (for editor preview)
 */
router.post('/test-content', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { script, timeout = 30 } = req.body;

        if (!script) {
            return res.status(400).json({
                success: false,
                error: 'Script content is required'
            });
        }

        const result = await scriptManager.testScript(script, timeout);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/scripts/generate-hooks
 * Generate hooks configuration for a backup
 */
router.post('/generate-hooks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { before_backup = [], after_backup = [], on_error = [] } = req.body;

        const hooks = await scriptManager.generateHooksConfig(
            before_backup,
            after_backup,
            on_error
        );

        res.json({
            success: true,
            data: hooks
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

