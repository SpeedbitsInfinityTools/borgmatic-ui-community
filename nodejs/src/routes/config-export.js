/**
 * Configuration Export/Import API Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const yaml = require('js-yaml');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const config = require('../config');
const configExport = require('../services/config-export');
const exportEncryption = require('../services/export-encryption');

function safeYamlLoad(content) {
    // Use a safe schema and limit aliases to reduce DoS risk (billion laughs)
    return yaml.load(content, {
        schema: yaml.JSON_SCHEMA,
        maxAliasCount: 50
    });
}

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/x-yaml' || 
            file.mimetype === 'text/yaml' ||
            file.mimetype === 'text/plain' ||
            file.originalname.endsWith('.yaml') ||
            file.originalname.endsWith('.yml')) {
            cb(null, true);
        } else {
            cb(new Error('Only YAML files are allowed'), false);
        }
    },
});

/**
 * GET /api/config-export/preview
 * Get a preview of what would be exported
 */
router.get('/preview', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const preview = await configExport.exportConfiguration({
            includeSecrets: false,
            includeSchedules: true,
            includeScripts: true,
            includeNotifications: true,
        });

        // Count items
        const summary = {
            repositories: preview.repositories?.length || 0,
            backups: preview.backups?.length || 0,
            schedules: preview.schedules?.length || 0,
            scripts: preview.scripts?.length || 0,
            ssh_keys: preview.ssh_keys?.length || 0,
            has_notification_settings: !!preview.notification_settings,
            has_system_settings: !!preview.system_settings,
        };

        res.json({
            success: true,
            data: { summary },
        });
    } catch (error) {
        console.error('Export preview error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to generate export preview',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/export
 * Export configuration to YAML
 */
router.post('/export', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            encrypted = false,
            includeSecrets = false,
            includeSchedules = true,
            includeScripts = true,
            includeNotifications = true,
        } = req.body;

        // For encrypted export, we always use the instance vault master key (SECRET_KEY / .secret_key).
        // The admin can download/back it up from Settings → Export / Import.
        const masterPassword = encrypted ? config.secretKey : null;

        // Validate key for encrypted export
        if (encrypted) {
            if (!masterPassword) {
                return res.status(400).json({
                    success: false,
                    detail: 'Vault master key (SECRET_KEY) is not configured',
                });
            }
        }

        // Export configuration
        const exportData = await configExport.exportConfiguration({
            includeSecrets: encrypted || includeSecrets,
            includeSchedules,
            includeScripts,
            includeNotifications,
        });

        let output;
        let filename;
        let contentType;

        if (encrypted) {
            // Encrypt the export
            exportData._meta.encrypted = true;
            const yamlContent = yaml.dump(exportData, { noRefs: true, lineWidth: -1 });
            const encryptedData = await exportEncryption.encryptExport(yamlContent, masterPassword);

            // Create encrypted file format
            const encryptedExport = {
                _encrypted: {
                    version: encryptedData.version,
                    algorithm: encryptedData.algorithm,
                    kdf: encryptedData.kdf,
                    kdf_params: encryptedData.kdf_params,
                    salt: encryptedData.salt,
                    iv: encryptedData.iv,
                    auth_tag: encryptedData.auth_tag,
                },
                payload: encryptedData.payload,
            };

            output = yaml.dump(encryptedExport, { noRefs: true, lineWidth: -1 });
            filename = `borgmatic-ui-export-${new Date().toISOString().split('T')[0]}.encrypted.yaml`;
            contentType = 'application/x-yaml';
        } else {
            output = yaml.dump(exportData, { noRefs: true, lineWidth: -1 });
            filename = `borgmatic-ui-export-${new Date().toISOString().split('T')[0]}.yaml`;
            contentType = 'application/x-yaml';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(output);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to export configuration',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/import/preview
 * Preview what would be imported from a file
 */
router.post('/import/preview', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded',
            });
        }

        const content = req.file.buffer.toString('utf8');
        let parsedData;

        try {
            parsedData = safeYamlLoad(content);
        } catch (e) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid YAML file',
                error: e.message,
            });
        }

        // Check if encrypted
        if (parsedData._encrypted) {
            return res.json({
                success: true,
                data: {
                    encrypted: true,
                    version: parsedData._encrypted.version,
                    algorithm: parsedData._encrypted.algorithm,
                    requires_password: true,
                },
            });
        }

        // Standard export - show preview
        const summary = {
            encrypted: false,
            version: parsedData._meta?.version || 'unknown',
            exported_at: parsedData._meta?.exported_at || null,
            repositories: parsedData.repositories?.length || 0,
            backups: parsedData.backups?.length || 0,
            schedules: parsedData.schedules?.length || 0,
            scripts: parsedData.scripts?.length || 0,
            ssh_keys: parsedData.ssh_keys?.length || 0,
            has_notification_settings: !!parsedData.notification_settings,
            has_system_settings: !!parsedData.system_settings,
        };

        res.json({
            success: true,
            data: { summary, requires_password: false },
        });

    } catch (error) {
        console.error('Import preview error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to preview import file',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/decrypt
 * Decrypt an encrypted export file
 */
router.post('/decrypt', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded',
            });
        }

        const { masterPassword } = req.body;
        if (!masterPassword) {
            return res.status(400).json({
                success: false,
                detail: 'Master password is required',
            });
        }

        const content = req.file.buffer.toString('utf8');
        let parsedData;

        try {
            parsedData = safeYamlLoad(content);
        } catch (e) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid YAML file',
                error: e.message,
            });
        }

        if (!parsedData._encrypted || !parsedData.payload) {
            return res.status(400).json({
                success: false,
                detail: 'File is not an encrypted export',
            });
        }

        // Decrypt
        try {
            const decryptedContent = await exportEncryption.decryptExport({
                ...parsedData._encrypted,
                payload: parsedData.payload,
            }, masterPassword);

            const decryptedData = safeYamlLoad(decryptedContent);

            // Return summary
            const summary = {
                encrypted: true,
                decrypted: true,
                version: decryptedData._meta?.version || 'unknown',
                exported_at: decryptedData._meta?.exported_at || null,
                repositories: decryptedData.repositories?.length || 0,
                backups: decryptedData.backups?.length || 0,
                schedules: decryptedData.schedules?.length || 0,
                scripts: decryptedData.scripts?.length || 0,
                ssh_keys: decryptedData.ssh_keys?.length || 0,
                has_notification_settings: !!decryptedData.notification_settings,
                has_system_settings: !!decryptedData.system_settings,
            };

            res.json({
                success: true,
                data: { summary },
            });

        } catch (decryptError) {
            return res.status(400).json({
                success: false,
                detail: 'Decryption failed',
                error: decryptError.message,
            });
        }

    } catch (error) {
        console.error('Decrypt error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to decrypt file',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/view-decrypted
 * Decrypt and return full content for emergency viewer
 */
router.post('/view-decrypted', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded',
            });
        }

        const { masterPassword } = req.body;
        if (!masterPassword) {
            return res.status(400).json({
                success: false,
                detail: 'Master password is required',
            });
        }

        const content = req.file.buffer.toString('utf8');
        let parsedData;

        try {
            parsedData = safeYamlLoad(content);
        } catch (e) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid YAML file',
                error: e.message,
            });
        }

        if (!parsedData._encrypted || !parsedData.payload) {
            return res.status(400).json({
                success: false,
                detail: 'File is not an encrypted export',
            });
        }

        // Decrypt
        try {
            const decryptedContent = await exportEncryption.decryptExport({
                ...parsedData._encrypted,
                payload: parsedData.payload,
            }, masterPassword);

            // Return full decrypted content as YAML string
            res.json({
                success: true,
                data: { 
                    content: decryptedContent,
                    filename: req.file.originalname,
                },
            });

        } catch (decryptError) {
            return res.status(400).json({
                success: false,
                detail: 'Decryption failed - incorrect password',
                error: decryptError.message,
            });
        }

    } catch (error) {
        console.error('View decrypted error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to decrypt file',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/import
 * Import configuration from a file
 */
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                detail: 'No file uploaded',
            });
        }

        const {
            masterPassword = null,
            mergeStrategy = 'skip',
            dryRun = false,
        } = req.body;

        const content = req.file.buffer.toString('utf8');
        let parsedData;

        try {
            parsedData = safeYamlLoad(content);
        } catch (e) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid YAML file',
                error: e.message,
            });
        }

        let importData = parsedData;

        // Handle encrypted file
        if (parsedData._encrypted) {
            if (!masterPassword) {
                return res.status(400).json({
                    success: false,
                    detail: 'Master password is required for encrypted import',
                });
            }

            try {
                const decryptedContent = await exportEncryption.decryptExport({
                    ...parsedData._encrypted,
                    payload: parsedData.payload,
                }, masterPassword);

                importData = safeYamlLoad(decryptedContent);
            } catch (decryptError) {
                return res.status(400).json({
                    success: false,
                    detail: 'Decryption failed: ' + decryptError.message,
                });
            }
        }

        // Perform import
        const result = await configExport.importConfiguration(importData, {
            mergeStrategy,
            dryRun: dryRun === true || dryRun === 'true',
        });

        res.json({
            success: result.success,
            data: result,
        });

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to import configuration',
            error: error.message,
        });
    }
});

/**
 * POST /api/config-export/check-password
 * Check password strength
 */
router.post('/check-password', authenticateToken, (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({
            success: false,
            detail: 'Password is required',
        });
    }

    const strength = exportEncryption.checkPasswordStrength(password);
    res.json({
        success: true,
        data: strength,
    });
});

module.exports = router;

