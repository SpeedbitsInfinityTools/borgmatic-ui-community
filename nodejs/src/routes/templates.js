const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const templateManager = require('../services/template-manager');
const identityManager = require('../services/identity-manager');
const infinityToolsActivator = require('../services/templates/template-manager');
const canaryFile = require('../services/canary-file');

// Configure multer for file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept JSON and YAML files
        if (file.mimetype === 'application/json' ||
            file.originalname.match(/\.(json|yml|yaml)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Only JSON and YAML files are allowed'));
        }
    }
});

/**
 * Template Management Routes
 * For managing reusable templates in Director mode
 */

// Middleware to ensure Director mode
async function requireDirectorMode(req, res, next) {
    try {
        const identity = await identityManager.getIdentity();

        if (!identity || identity.mode !== 'director') {
            return res.status(403).json({
                success: false,
                detail: 'Director mode required for template management'
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

// ===================================================================
// INFINITY TOOLS ROUTES (must come BEFORE generic /:type routes!)
// These work in ALL modes (standalone, client, director)
// ===================================================================

/**
 * GET /api/templates/infinity-tools/status
 * Check if Infinity Tools template is activated
 * Also returns auto-discovered paths from /etc/infinitytools.conf
 */
router.get('/infinity-tools/status', authenticateToken, async (req, res) => {
    try {
        const isActivated = infinityToolsActivator.isTemplateActivated('infinity-tools');
        const template = infinityToolsActivator.getTemplate('infinity-tools');
        
        // Get auto-discovered paths from Infinity Tools config
        const discoveredPaths = await infinityToolsActivator.getInfinityToolsPaths();
        
        // Build the suggested backup source path (with /host prefix for Docker)
        const suggestedBackupSource = `/host${discoveredPaths.dataRoot}`;

        res.json({
            success: true,
            data: {
                activated: isActivated,
                template: template,
                discovered_paths: {
                    ...discoveredPaths,
                    suggested_backup_source: suggestedBackupSource
                }
            }
        });
    } catch (error) {
        console.error('Failed to get Infinity Tools template status:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

/**
 * POST /api/templates/infinity-tools/activate
 * Activate built-in Infinity Tools backup template
 * Does NOT require Director mode - works in any mode
 */
router.post('/infinity-tools/activate', authenticateToken, requireAdmin, async (req, res) => {
    console.log('📥 /infinity-tools/activate endpoint hit');
    const redactedBody = { ...(req.body || {}) };
    if (redactedBody.passphrase) {
        redactedBody.passphrase = '[REDACTED]';
    }
    console.log('📥 Request body:', JSON.stringify(redactedBody, null, 2));
    try {
        const { passphrase, repository_option, repository_path, repository_id, log_file_path, borg_version, backup_source_path } = req.body;
        const fs = require('fs-extra');
        const path = require('path');
        console.log('📥 Parsed request successfully');

        // Validate backup source path when provided
        if (backup_source_path !== undefined) {
            const normalizedBackupSourcePath = String(backup_source_path).trim();
            if (!normalizedBackupSourcePath) {
                return res.status(400).json({
                    success: false,
                    detail: 'Backup source path cannot be empty.',
                    error_code: 'INVALID_BACKUP_SOURCE_PATH'
                });
            }
            if (!normalizedBackupSourcePath.startsWith('/')) {
                return res.status(400).json({
                    success: false,
                    detail: 'Backup source path must be an absolute path.',
                    error_code: 'INVALID_BACKUP_SOURCE_PATH'
                });
            }
        }

        // Pre-validation for "create new repository" option
        if (repository_option === 'create' && repository_path) {
            // Check if path already exists
            if (await fs.pathExists(repository_path)) {
                // Check if it's already a borg repository
                const configPath = path.join(repository_path, 'config');
                const dataPath = path.join(repository_path, 'data');

                if (await fs.pathExists(configPath) || await fs.pathExists(dataPath)) {
                    return res.status(400).json({
                        success: false,
                        detail: 'A Borg repository already exists at this path. Please select "Use existing repository" or choose a different path.',
                        error_code: 'REPO_EXISTS'
                    });
                }

                // Path exists but is not a borg repo - check if writable
                try {
                    const testFile = path.join(repository_path, '.borgmatic-test-write');
                    await fs.writeFile(testFile, 'test');
                    await fs.remove(testFile);
                } catch (writeError) {
                    return res.status(400).json({
                        success: false,
                        detail: `Permission denied: Cannot write to "${repository_path}". Please check directory permissions for your user or choose a different path.`,
                        error_code: 'PERMISSION_DENIED'
                    });
                }
            } else {
                // Path doesn't exist - check if we can create it
                const parentDir = path.dirname(repository_path);
                try {
                    if (!await fs.pathExists(parentDir)) {
                        // Parent doesn't exist - check if we can create it by testing access to its parent
                        const grandparentDir = path.dirname(parentDir);
                        if (await fs.pathExists(grandparentDir)) {
                            await fs.access(grandparentDir, fs.constants.W_OK);
                        } else {
                            // Deep path - just try to see if we have write access somewhere up the chain
                            throw new Error('Parent directory does not exist');
                        }
                    } else {
                        // Parent exists, check if writable
                        await fs.access(parentDir, fs.constants.W_OK);
                    }
                } catch (writeError) {
                    return res.status(400).json({
                        success: false,
                        detail: `Permission denied: Cannot create directory at "${repository_path}". Please check permissions for your user or choose a different path.`,
                        error_code: 'PERMISSION_DENIED'
                    });
                }
            }
        }

        // Pre-validation for log file path - test actual file write
        if (log_file_path) {
            try {
                const normalizedPath = log_file_path.trim();
                const logDir = path.dirname(normalizedPath);
                
                // Ensure directory exists
                await fs.ensureDir(logDir);
                
                // Try to write a test entry to the log file
                const testContent = `# Borgmatic UI log file test - ${new Date().toISOString()}\n`;
                await fs.appendFile(normalizedPath, testContent);
            } catch (writeError) {
                return res.status(400).json({
                    success: false,
                    detail: `Cannot write to log file "${log_file_path}". Please check file permissions or choose a different path (e.g., in your home directory).`,
                    error_code: 'LOG_PATH_PERMISSION_DENIED'
                });
            }
        }

        console.log('🚀 Starting Infinity Tools template activation with options:', {
            repository_option,
            repository_path,
            repository_id,
            log_file_path,
            borg_version,
            backup_source_path,
            hasPassphrase: !!passphrase
        });

        let result;
        try {
            result = await infinityToolsActivator.activateInfinityToolsTemplate({
                passphrase: passphrase || 'AUTO_GENERATE',
                repository_option: repository_option || 'create',
                repository_path: repository_path,
                repository_id: repository_id,
                log_file_path: log_file_path,
                borg_version: borg_version || '1.x',
                backup_source_path: backup_source_path ? String(backup_source_path).trim() : undefined
            });
        } catch (activationError) {
            console.error('❌ Template activation threw error:', activationError);
            console.error('❌ Stack trace:', activationError?.stack);
            throw activationError;
        }

        console.log('✅ Template activation completed successfully');

        res.status(201).json({
            success: true,
            partial_success: result.partial_success || false,
            message: result.message || 'Infinity Tools backup template activated successfully',
            warnings: result.warnings || [],
            data: result
        });
    } catch (error) {
        console.error('Failed to activate Infinity Tools template:', error);
        console.error('Error stack:', error?.stack);

        // Map common errors to user-friendly messages
        let status = 500;
        let detail = error.message;
        let errorCode = 'ACTIVATION_FAILED';

        if (error.message.includes('already activated')) {
            status = 409;
            errorCode = 'ALREADY_ACTIVATED';
        } else if (error.message.includes('retention profile') || error.message.includes('Invalid retention')) {
            detail = 'Could not find retention profiles. Please try refreshing the page or contact support.';
            errorCode = 'RETENTION_ERROR';
        } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            status = 400;
            detail = 'Permission denied: Cannot access the repository path. Please check permissions for your user.';
            errorCode = 'PERMISSION_DENIED';
        } else if (error.message.includes('ENOENT')) {
            status = 400;
            detail = 'Path not found: The specified directory does not exist.';
            errorCode = 'PATH_NOT_FOUND';
        } else if (error.message.includes('repository already exists') || error.message.includes('A repository already')) {
            status = 400;
            detail = 'A Borg repository already exists at this path. Please select "Use existing repository" or choose a different path.';
            errorCode = 'REPO_EXISTS';
        }

        res.status(status).json({
            success: false,
            detail: detail,
            error_code: errorCode
        });
    }
});

/**
 * DELETE /api/templates/infinity-tools
 * Deactivate Infinity Tools template
 */
router.delete('/infinity-tools', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await infinityToolsActivator.deactivateInfinityToolsTemplate();

        res.json({
            success: true,
            message: 'Infinity Tools template deactivated',
            data: result
        });
    } catch (error) {
        console.error('Failed to deactivate Infinity Tools template:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// ===================================================================
// LINUX SERVER TEMPLATE ROUTES (must come BEFORE generic /:type routes!)
// These work in ALL modes (standalone, client, director)
// ===================================================================

/**
 * GET /api/templates/linux-server/status
 * Check if the Linux Server template is activated and return its definition
 * (including selectable categories) so the UI can render the activation modal.
 */
router.get('/linux-server/status', authenticateToken, async (req, res) => {
    try {
        const isActivated = infinityToolsActivator.isTemplateActivated('linux-server');
        const template = infinityToolsActivator.getTemplate('linux-server');

        res.json({
            success: true,
            data: {
                activated: isActivated,
                template: template
            }
        });
    } catch (error) {
        console.error('Failed to get Linux Server template status:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

/**
 * POST /api/templates/linux-server/activate
 * Activate the built-in Linux Server backup template.
 * Body: { categories?: string[], passphrase?, repository_option?, repository_path?, repository_id?, log_file_path?, borg_version? }
 */
router.post('/linux-server/activate', authenticateToken, requireAdmin, async (req, res) => {
    console.log('📥 /linux-server/activate endpoint hit');
    try {
        const { passphrase, repository_option, repository_path, repository_id, log_file_path, borg_version, categories } = req.body;
        const fs = require('fs-extra');
        const path = require('path');

        // Validate categories when provided
        if (categories !== undefined && !Array.isArray(categories)) {
            return res.status(400).json({
                success: false,
                detail: 'categories must be an array of category ids.',
                error_code: 'INVALID_CATEGORIES'
            });
        }

        // Allowlist category ids against the template definition to avoid acting
        // on unknown/typo'd ids that would silently produce an empty backup.
        if (Array.isArray(categories)) {
            const linuxTemplate = infinityToolsActivator.getTemplate('linux-server');
            const validIds = new Set((linuxTemplate?.categories || []).map((c) => c.id));
            const unknown = categories.filter((id) => !validIds.has(id));
            if (unknown.length > 0) {
                return res.status(400).json({
                    success: false,
                    detail: `Unknown backup categor${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}.`,
                    error_code: 'INVALID_CATEGORIES'
                });
            }
            if (categories.length === 0) {
                return res.status(400).json({
                    success: false,
                    detail: 'Select at least one backup category to activate this template.',
                    error_code: 'NO_CATEGORIES_SELECTED'
                });
            }
        }

        // Pre-validation for "create new repository" option
        if (repository_option === 'create' && repository_path) {
            if (await fs.pathExists(repository_path)) {
                const configPath = path.join(repository_path, 'config');
                const dataPath = path.join(repository_path, 'data');

                if (await fs.pathExists(configPath) || await fs.pathExists(dataPath)) {
                    return res.status(400).json({
                        success: false,
                        detail: 'A Borg repository already exists at this path. Please select "Use existing repository" or choose a different path.',
                        error_code: 'REPO_EXISTS'
                    });
                }

                try {
                    const testFile = path.join(repository_path, '.borgmatic-test-write');
                    await fs.writeFile(testFile, 'test');
                    await fs.remove(testFile);
                } catch (writeError) {
                    return res.status(400).json({
                        success: false,
                        detail: `Permission denied: Cannot write to "${repository_path}". Please check directory permissions for your user or choose a different path.`,
                        error_code: 'PERMISSION_DENIED'
                    });
                }
            } else {
                const parentDir = path.dirname(repository_path);
                try {
                    if (!await fs.pathExists(parentDir)) {
                        const grandparentDir = path.dirname(parentDir);
                        if (await fs.pathExists(grandparentDir)) {
                            await fs.access(grandparentDir, fs.constants.W_OK);
                        } else {
                            throw new Error('Parent directory does not exist');
                        }
                    } else {
                        await fs.access(parentDir, fs.constants.W_OK);
                    }
                } catch (writeError) {
                    return res.status(400).json({
                        success: false,
                        detail: `Permission denied: Cannot create directory at "${repository_path}". Please check permissions for your user or choose a different path.`,
                        error_code: 'PERMISSION_DENIED'
                    });
                }
            }
        }

        // Pre-validation for log file path - test actual file write
        if (log_file_path) {
            try {
                const normalizedPath = log_file_path.trim();
                const logDir = path.dirname(normalizedPath);
                await fs.ensureDir(logDir);
                const testContent = `# Borgmatic UI log file test - ${new Date().toISOString()}\n`;
                await fs.appendFile(normalizedPath, testContent);
            } catch (writeError) {
                return res.status(400).json({
                    success: false,
                    detail: `Cannot write to log file "${log_file_path}". Please check file permissions or choose a different path (e.g., in your home directory).`,
                    error_code: 'LOG_PATH_PERMISSION_DENIED'
                });
            }
        }

        console.log('🚀 Starting Linux Server template activation with options:', {
            repository_option,
            repository_path,
            repository_id,
            log_file_path,
            borg_version,
            categories,
            hasPassphrase: !!passphrase
        });

        const result = await infinityToolsActivator.activateLinuxServerTemplate({
            categories: Array.isArray(categories) ? categories : undefined,
            passphrase: passphrase || 'AUTO_GENERATE',
            repository_option: repository_option || 'create',
            repository_path: repository_path,
            repository_id: repository_id,
            log_file_path: log_file_path,
            borg_version: borg_version || '1.x'
        });

        res.status(201).json({
            success: true,
            partial_success: result.partial_success || false,
            message: result.message || 'Linux Server backup template activated successfully',
            warnings: result.warnings || [],
            data: result
        });
    } catch (error) {
        console.error('Failed to activate Linux Server template:', error);

        let status = 500;
        let detail = error.message;
        let errorCode = 'ACTIVATION_FAILED';

        if (error.message.includes('already activated')) {
            status = 409;
            errorCode = 'ALREADY_ACTIVATED';
        } else if (error.message.includes('at least one')) {
            status = 400;
            errorCode = 'NO_CATEGORIES';
        } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            status = 400;
            detail = 'Permission denied: Cannot access the repository path. Please check permissions for your user.';
            errorCode = 'PERMISSION_DENIED';
        } else if (error.message.includes('ENOENT')) {
            status = 400;
            detail = 'Path not found: The specified directory does not exist.';
            errorCode = 'PATH_NOT_FOUND';
        } else if (error.message.includes('repository already exists') || error.message.includes('A repository already')) {
            status = 400;
            detail = 'A Borg repository already exists at this path. Please select "Use existing repository" or choose a different path.';
            errorCode = 'REPO_EXISTS';
        }

        res.status(status).json({
            success: false,
            detail: detail,
            error_code: errorCode
        });
    }
});

/**
 * DELETE /api/templates/linux-server
 * Deactivate the Linux Server template
 */
router.delete('/linux-server', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await infinityToolsActivator.deactivateLinuxServerTemplate();

        res.json({
            success: true,
            message: 'Linux Server template deactivated',
            data: result
        });
    } catch (error) {
        console.error('Failed to deactivate Linux Server template:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

/**
 * GET /api/templates/canary-status
 * Get canary file status (ransomware protection)
 */
router.get('/canary-status', authenticateToken, async (req, res) => {
    try {
        const status = await canaryFile.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Failed to get canary status:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to get canary file status',
            error: error.message
        });
    }
});

/**
 * POST /api/templates/canary-reset
 * Reset canary file
 */
router.post('/canary-reset', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await canaryFile.reset();

        if (!result.success) {
            return res.status(500).json({
                success: false,
                detail: result.error
            });
        }

        res.json({
            success: true,
            message: 'Canary file reset successfully',
            data: result
        });
    } catch (error) {
        console.error('Failed to reset canary:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to reset canary file',
            error: error.message
        });
    }
});

/**
 * Import template from file
 * POST /api/templates/import
 */
router.post('/import', authenticateToken, requireDirectorMode, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded'
            });
        }

        // Parse file content
        let templateData;
        const fileContent = req.file.buffer.toString('utf8');

        try {
            // Try JSON first
            if (req.file.originalname.match(/\.json$/i)) {
                templateData = JSON.parse(fileContent);
            } else {
                // Try YAML
                const yaml = require('js-yaml');
                templateData = yaml.load(fileContent);
            }
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                detail: `Failed to parse file: ${parseError.message}`
            });
        }

        // Validate template structure
        if (!templateData.name) {
            return res.status(400).json({
                success: false,
                detail: 'Template must have a name'
            });
        }

        if (!templateData.type) {
            templateData.type = 'backup'; // Default type
        }

        // Ensure unique name
        const existingTemplates = await templateManager.getTemplatesByType(templateData.type);
        const nameExists = existingTemplates.backups.some(t => t.name === templateData.name);

        if (nameExists) {
            templateData.name = `${templateData.name} (Imported)`;
        }

        // Create template
        const template = await templateManager.createTemplate(
            templateData.type,
            templateData,
            req.user.username
        );

        res.status(201).json({
            success: true,
            message: 'Template imported successfully',
            data: { template }
        });
    } catch (error) {
        console.error('Failed to import template:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to import template'
        });
    }
});

// ===================================================================
// GENERAL TEMPLATE ROUTES
// ===================================================================

/**
 * Get all templates (all types)
 * Works in all modes - Director mode gets full template management,
 * other modes get read-only access + Infinity Tools template
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Check if in Director mode for full template management
        const identity = await identityManager.getIdentity();
        const isDirector = identity?.mode === 'director';

        if (isDirector) {
            // Full template management
            const templates = await templateManager.getAllTemplates();
            res.json({
                success: true,
                data: templates
            });
        } else {
            // Non-director modes: Return built-in templates only (like Infinity Tools)
            const builtInTemplates = infinityToolsActivator.getAllTemplates();
            res.json({
                success: true,
                data: {
                    backups: builtInTemplates,
                    schedules: [],
                    repositories: []
                }
            });
        }
    } catch (error) {
        console.error('Failed to get templates:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get templates'
        });
    }
});

// ===================================================================
// DIRECTOR-ONLY ROUTES (generic /:type patterns MUST come last!)
// ===================================================================

/**
 * Get templates by type
 */
router.get('/:type', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type } = req.params;
        const templates = await templateManager.getTemplates(type);

        res.json({
            success: true,
            data: {
                type: type,
                templates: templates,
                count: templates.length
            }
        });
    } catch (error) {
        console.error('Failed to get templates:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get templates'
        });
    }
});

/**
 * Get single template
 */
router.get('/:type/:template_id', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type, template_id } = req.params;
        const template = await templateManager.getTemplate(type, template_id);

        if (!template) {
            return res.status(404).json({
                success: false,
                detail: 'Template not found'
            });
        }

        res.json({
            success: true,
            data: { template }
        });
    } catch (error) {
        console.error('Failed to get template:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get template'
        });
    }
});

/**
 * Create new template
 */
router.post('/:type', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type } = req.params;
        const { name, description, config } = req.body;

        if (!name || !config) {
            return res.status(400).json({
                success: false,
                detail: 'Name and config are required'
            });
        }

        const template = await templateManager.createTemplate(type, {
            name: name,
            description: description,
            config: config,
            created_by: req.user.username
        });

        res.json({
            success: true,
            data: { template },
            message: 'Template created successfully'
        });
    } catch (error) {
        console.error('Failed to create template:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to create template'
        });
    }
});

/**
 * Update template
 */
router.put('/:type/:template_id', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type, template_id } = req.params;
        const updates = req.body;

        // Check if system template
        const existing = await templateManager.getTemplate(type, template_id);
        if (templateManager.isSystemTemplate(existing)) {
            return res.status(403).json({
                success: false,
                detail: 'Cannot edit system template. Clone it to create your own version.'
            });
        }

        const template = await templateManager.updateTemplate(type, template_id, updates);

        res.json({
            success: true,
            data: { template },
            message: 'Template updated successfully'
        });
    } catch (error) {
        console.error('Failed to update template:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to update template'
        });
    }
});

/**
 * Delete template
 */
router.delete('/:type/:template_id', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type, template_id } = req.params;

        // Check if system template
        const existing = await templateManager.getTemplate(type, template_id);
        if (templateManager.isSystemTemplate(existing)) {
            return res.status(403).json({
                success: false,
                detail: 'Cannot delete system template.'
            });
        }

        await templateManager.deleteTemplate(type, template_id);

        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete template:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to delete template'
        });
    }
});

/**
 * Clone existing item as template
 */
router.post('/:type/clone', authenticateToken, requireDirectorMode, async (req, res) => {
    try {
        const { type } = req.params;
        const { name, description, source_config } = req.body;

        if (!name || !source_config) {
            return res.status(400).json({
                success: false,
                detail: 'Name and source_config are required'
            });
        }

        const template = await templateManager.cloneAsTemplate(
            type,
            source_config,
            name,
            description,
            req.user.username
        );

        res.json({
            success: true,
            data: { template },
            message: 'Template created from existing configuration'
        });
    } catch (error) {
        console.error('Failed to clone as template:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Failed to clone as template'
        });
    }
});

module.exports = router;
