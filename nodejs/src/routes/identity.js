const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const identityManager = require('../services/identity-manager');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const config = require('../config');

const { getEditionInfo, isFeatureAvailable } = require('../utils/edition');

/**
 * Migrate data from one mode directory to another
 * @param {string} fromMode - Source mode ('standalone', 'client', 'director')
 * @param {string} toMode - Target mode
 * @param {object} options - Migration options
 * @returns {object} Migration result with details
 */
async function migrateModePaths(fromMode, toMode, options = {}) {
    const fromPaths = config.getModeBasedPaths(fromMode);
    const toPaths = config.getModeBasedPaths(toMode);
    
    const result = {
        migrated: [],
        skipped: [],
        errors: [],
        fromDir: fromPaths.dataDir,
        toDir: toPaths.dataDir,
    };
    
    // If paths are the same (e.g., both standalone and client use same dir), no migration needed
    if (fromPaths.dataDir === toPaths.dataDir) {
        result.skipped.push('Same directory - no migration needed');
        return result;
    }
    
    // Check if source exists
    if (!await fs.pathExists(fromPaths.dataDir)) {
        result.skipped.push('Source directory does not exist');
        return result;
    }
    
    // Create target directories
    try {
        await fs.ensureDir(toPaths.configDir);
        await fs.ensureDir(toPaths.dataDir);
        await fs.ensureDir(toPaths.logsDir);
        await fs.ensureDir(toPaths.backupsDir);
        result.migrated.push('Created target directories');
    } catch (error) {
        result.errors.push(`Failed to create target directories: ${error.message}`);
        return result;
    }
    
    // Files to migrate from data directory
    const dataFiles = [
        'passphrases.json',          // Encrypted repository passphrases
        'repository-credentials.json', // Repository credentials
        '.secret_key',               // Encryption key (CRITICAL)
    ];
    
    // Files to migrate from config directory
    const configFiles = [
        'admin.yaml',                // Admin user config
        'saved_schedules.yaml',      // Saved schedules
    ];
    
    // Migrate data files
    for (const file of dataFiles) {
        const srcFile = path.join(fromPaths.dataDir, file);
        const dstFile = path.join(toPaths.dataDir, file);
        
        try {
            if (await fs.pathExists(srcFile)) {
                await fs.copy(srcFile, dstFile, { overwrite: false });
                result.migrated.push(`data/${file}`);
            }
        } catch (error) {
            if (error.message.includes('already exists')) {
                result.skipped.push(`data/${file} (already exists)`);
            } else {
                result.errors.push(`data/${file}: ${error.message}`);
            }
        }
    }
    
    // Migrate config files
    for (const file of configFiles) {
        const srcFile = path.join(fromPaths.configDir, file);
        const dstFile = path.join(toPaths.configDir, file);
        
        try {
            if (await fs.pathExists(srcFile)) {
                await fs.copy(srcFile, dstFile, { overwrite: false });
                result.migrated.push(`config/${file}`);
            }
        } catch (error) {
            if (error.message.includes('already exists')) {
                result.skipped.push(`config/${file} (already exists)`);
            } else {
                result.errors.push(`config/${file}: ${error.message}`);
            }
        }
    }
    
    // Migrate borgmatic.d directory (backup configurations)
    const borgmaticSrc = path.join(fromPaths.configDir, 'borgmatic.d');
    const borgmaticDst = path.join(toPaths.configDir, 'borgmatic.d');
    
    try {
        if (await fs.pathExists(borgmaticSrc)) {
            await fs.ensureDir(borgmaticDst);
            const files = await fs.readdir(borgmaticSrc);
            for (const file of files) {
                const srcFile = path.join(borgmaticSrc, file);
                const dstFile = path.join(borgmaticDst, file);
                if (!await fs.pathExists(dstFile)) {
                    await fs.copy(srcFile, dstFile);
                    result.migrated.push(`borgmatic.d/${file}`);
                } else {
                    result.skipped.push(`borgmatic.d/${file} (already exists)`);
                }
            }
        }
    } catch (error) {
        result.errors.push(`borgmatic.d: ${error.message}`);
    }
    
    console.log(`📦 Migration ${fromMode} → ${toMode}:`, result);
    return result;
}

/**
 * Get current mode (PUBLIC - for login page)
 * Only returns the mode, not sensitive identity information
 */
router.get('/mode', async (req, res) => {
    try {
        const status = await identityManager.getStatus();
        const editionInfo = getEditionInfo();

        res.json({
            success: true,
            data: {
                mode: status.mode || 'not_configured',
                edition: editionInfo.edition,
            }
        });
    } catch (error) {
        console.error('Error getting mode:', error.message);
        res.json({
            success: true,
            data: {
                mode: 'standalone',
                edition: 'commercial',
            }
        });
    }
});

/**
 * Get current mode and identity status
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = await identityManager.getStatus();
        const editionInfo = getEditionInfo();
        
        // Get current paths based on mode
        const currentMode = status.mode || 'standalone';
        const modePaths = config.getModeBasedPaths(currentMode);

        // Surface the system hostname so the frontend can fall back to it
        // as the default "Instance name" when the user hasn't customized one.
        // os.hostname() returns the Linux/Windows host short name (e.g.
        // "MrwSurface7") which is meaningful for distinguishing installs.
        let systemHostname = '';
        try {
            systemHostname = (os.hostname() || '').trim();
        } catch (_) {
            systemHostname = '';
        }

        res.json({
            success: true,
            data: {
                ...status,
                edition: editionInfo.edition,
                features: editionInfo.features,
                available_modes: editionInfo.features,
                system_hostname: systemHostname,
                paths: {
                    config: modePaths.configDir,
                    data: modePaths.dataDir,
                    logs: modePaths.logsDir,
                    backups: modePaths.backupsDir,
                },
                expected_paths: {
                    standalone: config.getModeBasedPaths('standalone'),
                    client: config.getModeBasedPaths('client'),
                    director: config.getModeBasedPaths('director'),
                }
            }
        });
    } catch (error) {
        console.error('Error getting identity status:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to get identity status'
        });
    }
});

/**
 * Set operating mode (first-time setup)
 * This writes to a persistent config file
 */
router.post('/set-mode', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { mode } = req.body;

        // Validate mode
        const validModes = ['standalone', 'client', 'director'];
        if (!validModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                detail: `Invalid mode. Must be one of: ${validModes.join(', ')}`
            });
        }

        // Check edition restrictions
        if (mode === 'director' && !isFeatureAvailable('director')) {
            return res.status(402).json({
                success: false,
                detail: 'Director mode is only available in the Commercial edition. Visit https://www.speedbits.io for more information.',
                upgrade_required: true,
                upgrade_url: 'https://www.speedbits.io',
            });
        }

        // Get mode-specific paths
        const modePaths = config.getModeBasedPaths(mode);
        
        // Ensure directories exist
        await fs.ensureDir(modePaths.configDir);
        await fs.ensureDir(modePaths.dataDir);
        await fs.ensureDir(modePaths.logsDir);
        await fs.ensureDir(modePaths.backupsDir);
        await fs.ensureDir(path.join(modePaths.configDir, 'borgmatic.d'));

        // Write mode to config file in mode-specific directory
        const modeConfigFile = path.join(modePaths.dataDir, 'mode.json');
        await fs.writeJson(modeConfigFile, {
            mode: mode,
            configured_at: new Date().toISOString(),
            configured_by: req.user.username,
            paths: {
                config: modePaths.configDir,
                data: modePaths.dataDir,
            }
        }, { spaces: 2 });

        console.log(`✅ Mode set to: ${mode} by ${req.user.username}`);
        console.log(`📁 Using paths: config=${modePaths.configDir}, data=${modePaths.dataDir}`);

        // Always generate identity for client or director mode
        const identity = await identityManager.generateIdentity(mode);

        res.json({
            success: true,
            data: {
                mode: mode,
                identity: identity,
                paths: {
                    config: modePaths.configDir,
                    data: modePaths.dataDir,
                    logs: modePaths.logsDir,
                },
                message: `Mode set to ${mode}. Please restart the application for changes to take effect.`,
                requires_restart: true
            }
        });
    } catch (error) {
        console.error('Error setting mode:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to set mode'
        });
    }
});

/**
 * Update director listening port
 */
router.put('/director-port', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { port } = req.body;

        // Get current identity
        const identity = await identityManager.getIdentity();

        if (!identity || identity.mode !== 'director') {
            return res.status(400).json({
                success: false,
                detail: 'Not in director mode'
            });
        }

        // Validate port
        const portNum = parseInt(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            return res.status(400).json({
                success: false,
                detail: 'Port must be a number between 1 and 65535'
            });
        }

        // Update identity with new port
        await identityManager.updateIdentity({
            listen_port: portNum
        });

        // Update environment variable
        const configManager = require('../services/config-manager');
        await configManager.updateEnv({
            PORT: portNum.toString()
        });

        console.log(`🔄 Director port updated to ${portNum}, restarting server...`);

        res.json({
            success: true,
            data: {
                message: 'Port updated successfully. Server is restarting...',
                port: portNum,
                requires_restart: true
            }
        });

        // Gracefully shutdown and let process manager restart
        // nodemon/pm2/systemd will restart the server with new port
        setTimeout(() => {
            console.log('🔄 Exiting for restart with new port...');
            process.exit(0);
        }, 500);
    } catch (error) {
        console.error('Error updating director port:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update port'
        });
    }
});

/**
 * Update director connection token
 */
router.put('/director-token', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { connection_token } = req.body;

        // Get current identity
        const identity = await identityManager.getIdentity();

        if (!identity || identity.mode !== 'director') {
            return res.status(400).json({
                success: false,
                detail: 'Not in director mode'
            });
        }

        // Allow empty tokens (for open access)
        // If empty string provided, set to empty, otherwise use the value
        const newToken = connection_token !== undefined ? connection_token.trim() : identity.connection_token;

        // Update identity with new token
        await identityManager.updateIdentity({
            connection_token: newToken
        });

        res.json({
            success: true,
            data: {
                message: 'Connection token updated successfully',
                connection_token: newToken
            }
        });
    } catch (error) {
        console.error('Error updating director token:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update connection token'
        });
    }
});

/**
 * Update client configuration
 */
router.put('/client-config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { client_name, connection_token, director_url } = req.body;

        // Validate (connection_token can be empty for open access)
        if (!client_name || connection_token === undefined || !director_url) {
            return res.status(400).json({
                success: false,
                detail: 'client_name, connection_token (can be empty), and director_url are required'
            });
        }

        // Validate URL format (must include protocol)
        try {
            const url = new URL(director_url);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return res.status(400).json({
                    success: false,
                    detail: 'director_url must use http:// or https:// protocol'
                });
            }
            if (url.port && (parseInt(url.port) < 1 || parseInt(url.port) > 65535)) {
                return res.status(400).json({
                    success: false,
                    detail: 'Invalid port number in URL'
                });
            }
        } catch (err) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid URL format. Example: https://localhost:8000'
            });
        }

        // Update identity
        const identity = await identityManager.updateIdentity({
            client_name,
            connection_token,
            director_url
        });

        res.json({
            success: true,
            data: {
                identity: identity,
                message: 'Client configuration updated successfully'
            }
        });
    } catch (error) {
        console.error('Error updating client config:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update client configuration'
        });
    }
});

/**
 * Update the human-readable instance/display name.
 *
 * This is a mode-agnostic endpoint that lets the user label this Borgmatic UI
 * installation (e.g. "WSL Laptop", "Production Server") so multiple instances
 * can be told apart in the UI. It writes to identity.client_name, which the
 * /identity/status response already exposes as the unified display name
 * (with director_name as a fallback for director mode).
 *
 * Body: { client_name: string }   // empty string clears the override
 * Works in standalone, client, and director modes.
 *
 * Note: PUT /client-config is a separate, client-mode-only endpoint that
 * additionally requires connection_token and director_url; we intentionally
 * do not collapse the two so that Settings > Client Configuration keeps its
 * stricter validation.
 */
router.put('/display-name', authenticateToken, requireAdmin, async (req, res) => {
    try {
        let { client_name } = req.body || {};
        if (typeof client_name !== 'string') {
            return res.status(400).json({
                success: false,
                detail: 'client_name must be a string'
            });
        }
        client_name = client_name.trim();
        if (client_name.length > 80) {
            return res.status(400).json({
                success: false,
                detail: 'client_name must be 80 characters or fewer'
            });
        }

        const identity = await identityManager.updateIdentity({ client_name });

        res.json({
            success: true,
            data: {
                identity,
                message: client_name
                    ? 'Instance name updated'
                    : 'Instance name cleared'
            }
        });
    } catch (error) {
        console.error('Error updating display name:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to update instance name'
        });
    }
});

/**
 * Generate new keypair (reset identity)
 */
router.post('/regenerate-keys', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = await identityManager.getStatus();

        // Delete old identity
        await identityManager.deleteIdentity();

        // Generate new identity
        const identity = await identityManager.generateIdentity(status.mode);

        res.json({
            success: true,
            data: {
                identity: identity,
                message: 'New keypair generated successfully',
                warning: 'You will need to re-approve this client in the Director'
            }
        });
    } catch (error) {
        console.error('Error regenerating keys:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to regenerate keys'
        });
    }
});

/**
 * Switch operating mode (DANGER: Data loss!)
 * Requires manual confirmation by typing "switch"
 */
router.post('/switch-mode', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { new_mode, confirmation } = req.body;

        // Validate confirmation
        if (confirmation !== 'switch') {
            return res.status(400).json({
                success: false,
                detail: 'Confirmation required. You must type "switch" to confirm this action.'
            });
        }

        // Validate mode - director switch (destructive) uses this endpoint
        // Switching between client/standalone uses /toggle-standalone (non-destructive)
        const validModes = ['director', 'standalone'];
        if (!validModes.includes(new_mode)) {
            return res.status(400).json({
                success: false,
                detail: 'Use this endpoint for switching to/from Director mode. For client/standalone switching, use /toggle-standalone'
            });
        }

        // Check edition restrictions
        if (new_mode === 'director' && !isFeatureAvailable('director')) {
            return res.status(402).json({
                success: false,
                detail: 'Director mode is only available in the Commercial edition. Visit https://www.speedbits.io for more information.',
                upgrade_required: true,
                upgrade_url: 'https://www.speedbits.io',
            });
        }

        // Get current mode
        const currentStatus = await identityManager.getStatus();
        const currentMode = currentStatus.mode;

        if (currentMode === new_mode) {
            return res.status(400).json({
                success: false,
                detail: `Already in ${new_mode} mode`
            });
        }

        console.warn(`⚠️  MODE SWITCH: ${currentMode} → ${new_mode} by ${req.user.username}`);

        // Get old and new paths
        const oldPaths = config.getModeBasedPaths(currentMode);
        const newPaths = config.getModeBasedPaths(new_mode);
        
        // Migrate data from old directory to new directory
        let migrationResult = null;
        if (oldPaths.dataDir !== newPaths.dataDir) {
            console.log(`📦 Migrating data: ${oldPaths.dataDir} → ${newPaths.dataDir}`);
            migrationResult = await migrateModePaths(currentMode, new_mode);
        }

        // Delete mode-specific data (in new location)
        const dataLost = [];

        if (currentMode === 'director') {
            // Clear Director server data (registered clients, approvals)
            const clientsFile = path.join(newPaths.dataDir, 'director-clients.json');
            if (await fs.pathExists(clientsFile)) {
                await fs.remove(clientsFile);
                dataLost.push('All registered clients');
                dataLost.push('Client approval history');
            }
        } else if (currentMode === 'client' || currentMode === 'standalone') {
            // Clear Client connection settings (in identity.json)
            dataLost.push('Director connection settings');
            dataLost.push('Client approval status');
        }

        // Delete old identity (will regenerate with new mode)
        await identityManager.deleteIdentity();
        dataLost.push('Cryptographic identity (new keys generated)');

        // Update mode.json in the NEW directory
        await fs.ensureDir(newPaths.dataDir);
        const modeConfigFile = path.join(newPaths.dataDir, 'mode.json');
        await fs.writeJson(modeConfigFile, {
            mode: new_mode,
            configured_at: new Date().toISOString(),
            configured_by: req.user.username,
            switched_from: currentMode,
            switched_at: new Date().toISOString(),
            paths: {
                config: newPaths.configDir,
                data: newPaths.dataDir,
            }
        }, { spaces: 2 });

        // Generate new identity for new mode
        const newIdentity = await identityManager.generateIdentity(new_mode);

        console.log(`✅ Mode switched to: ${new_mode} by ${req.user.username}`);
        console.log(`📁 New paths: config=${newPaths.configDir}, data=${newPaths.dataDir}`);

        res.json({
            success: true,
            data: {
                old_mode: currentMode,
                new_mode: new_mode,
                identity: newIdentity,
                data_lost: dataLost,
                migration: migrationResult,
                new_paths: {
                    config: newPaths.configDir,
                    data: newPaths.dataDir,
                    logs: newPaths.logsDir,
                },
                message: `Mode switched from ${currentMode} to ${new_mode}. Application restart required.`,
                requires_restart: true
            }
        });
    } catch (error) {
        console.error('Error switching mode:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to switch mode'
        });
    }
});

/**
 * Connect to Director (client mode only)
 */
router.post('/connect', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Use getStatus() which reads mode from mode.json (source of truth)
        const status = await identityManager.getStatus();
        const identity = await identityManager.getIdentity();

        if (!identity || status.mode !== 'client') {
            return res.status(400).json({
                success: false,
                detail: 'Not in client mode'
            });
        }

        if (!identity.director_url || !identity.client_name) {
            return res.status(400).json({
                success: false,
                detail: 'Client configuration incomplete. Please set Client Name and Director URL.'
            });
        }
        // Note: connection_token CAN be empty (for open access mode)

        // Try to connect to Director
        const directorClient = require('../services/director-client');

        // Check if already connected
        const connInfo = directorClient.getConnectionInfo();
        if (connInfo.isConnected && connInfo.isAuthenticated) {
            return res.json({
                success: true,
                data: {
                    message: 'Already connected to Director',
                    status: 'connected'
                }
            });
        }

        // Attempt connection
        const result = await directorClient.connect();

        if (result.success) {
            res.json({
                success: true,
                data: {
                    message: 'Successfully connected to Director',
                    status: 'connected',
                    director_url: identity.director_url
                }
            });
        } else {
            res.status(500).json({
                success: false,
                detail: result.error || 'Failed to connect to Director'
            });
        }
    } catch (error) {
        console.error('Connection failed:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Connection failed'
        });
    }
});

/**
 * Disconnect from Director (client mode only)
 */
router.post('/disconnect', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Use getStatus() which reads mode from mode.json (source of truth)
        const status = await identityManager.getStatus();
        const identity = await identityManager.getIdentity();

        if (!identity || status.mode !== 'client') {
            return res.status(400).json({
                success: false,
                detail: 'Not in client mode'
            });
        }

        // Disconnect from Director
        const directorClient = require('../services/director-client');
        await directorClient.disconnect();

        // Only clear connection state, NOT the configuration
        // Keep director_url and connection_token so user can easily reconnect
        await identityManager.updateIdentity({
            last_connected: null,
            connection_status: 'disconnected'
        });

        console.log('✅ Disconnected from Director (configuration preserved)');

        res.json({
            success: true,
            data: {
                message: 'Disconnected from Director',
                status: 'disconnected'
            }
        });
    } catch (error) {
        console.error('Disconnect failed:', error.message);
        res.status(500).json({
            success: false,
            detail: error.message || 'Disconnect failed'
        });
    }
});

/**
 * Toggle between standalone and client modes (non-destructive)
 * - standalone → client: Just changes mode, user can configure director later
 * - client → standalone: Disconnects from director and clears director settings
 */
router.post('/toggle-standalone', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const currentStatus = await identityManager.getStatus();
        const currentMode = currentStatus.mode;

        // Only allow toggling between standalone and client
        if (currentMode !== 'standalone' && currentMode !== 'client') {
            return res.status(400).json({
                success: false,
                detail: 'This endpoint only works for switching between standalone and client modes. Use /switch-mode to switch to/from Director mode.'
            });
        }

        const newMode = currentMode === 'standalone' ? 'client' : 'standalone';

        console.log(`🔄 Mode toggle: ${currentMode} → ${newMode} by ${req.user.username}`);

        // If switching FROM client TO standalone, disconnect and clear director settings
        if (currentMode === 'client') {
            try {
                const directorClient = require('../services/director-client');
                const connInfo = directorClient.getConnectionInfo();
                if (connInfo.isConnected) {
                    await directorClient.disconnect();
                    console.log('   ✓ Disconnected from Director');
                }
            } catch (err) {
                console.log('   ℹ️ No active Director connection to close');
            }

            // Clear director-related settings from identity
            await identityManager.updateIdentity({
                director_url: null,
                connection_token: null,
                approved: false,
                last_connected: null,
                connection_status: 'disconnected'
            });
            console.log('   ✓ Cleared Director connection settings');
        }

        // Update mode.json
        const modeConfigFile = path.join(config.dataDir, 'mode.json');
        await fs.writeJson(modeConfigFile, {
            mode: newMode,
            configured_at: new Date().toISOString(),
            configured_by: req.user.username,
            toggled_from: currentMode
        }, { spaces: 2 });

        // Also update mode in identity.json so all mode checks are consistent
        await identityManager.updateIdentity({
            mode: newMode
        });

        console.log(`✅ Switched to ${newMode} mode`);

        res.json({
            success: true,
            data: {
                old_mode: currentMode,
                new_mode: newMode,
                message: currentMode === 'client' 
                    ? 'Switched to standalone mode. Director connection cleared.'
                    : 'Switched to client mode. You can now configure a Director connection.',
                requires_restart: false
            }
        });
    } catch (error) {
        console.error('Error toggling mode:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to toggle mode'
        });
    }
});

/**
 * Validate a client's connection token (director mode only)
 * Called by clients during test-connection to verify their token is correct
 * This endpoint does NOT require authentication - it's a public validation endpoint
 */
router.post('/validate-client-token', async (req, res) => {
    try {
        const identity = await identityManager.getIdentity();

        if (!identity || identity.mode !== 'director') {
            return res.status(400).json({
                success: false,
                detail: 'This endpoint is only available on Director instances'
            });
        }

        const clientToken = req.body.connection_token || '';
        const directorToken = identity.connection_token || '';

        // If director has no token set, allow any client (open access mode)
        if (!directorToken) {
            return res.json({
                success: true,
                data: {
                    message: 'Director is in open access mode - no token required',
                    open_access: true
                }
            });
        }

        // Check if tokens match
        if (clientToken === directorToken) {
            return res.json({
                success: true,
                data: {
                    message: 'Connection token is valid',
                    open_access: false
                }
            });
        }

        // Token mismatch
        return res.status(401).json({
            success: false,
            detail: 'Invalid connection token. Please check the token and try again.'
        });

    } catch (error) {
        console.error('Token validation error:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to validate token'
        });
    }
});

/**
 * Test connection to Director (client mode only)
 * Accepts optional director_url and connection_token in body to test before saving
 */
router.post('/test-connection', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Use getStatus() which reads mode from mode.json (source of truth)
        const status = await identityManager.getStatus();
        const identity = await identityManager.getIdentity();

        if (!identity || status.mode !== 'client') {
            return res.status(400).json({
                success: false,
                detail: 'Not in client mode'
            });
        }

        // Use provided values from request body, or fall back to saved identity
        const testUrl = req.body.director_url?.trim() || identity.director_url;
        const testToken = req.body.connection_token?.trim() ?? identity.connection_token;

        if (!testUrl) {
            return res.status(400).json({
                success: false,
                detail: 'Director URL not provided'
            });
        }

        // Validate URL format
        let parsedUrl;
        try {
            parsedUrl = new URL(testUrl);
        } catch (err) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid Director URL format. Use format: https://hostname:port'
            });
        }

        // Test connectivity AND token validation with Director
        const https = require('https');
        const http = require('http');
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        // Step 1: Check if Director is reachable via health endpoint
        const healthCheck = new Promise((resolve, reject) => {
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: '/api/health',
                method: 'GET',
                timeout: 5000,
                rejectUnauthorized: false // Allow self-signed certs for local testing
            };

            const testReq = client.request(options, (testRes) => {
                let data = '';
                testRes.on('data', chunk => data += chunk);
                testRes.on('end', () => {
                    if (testRes.statusCode === 200) {
                        try {
                            const health = JSON.parse(data);
                            resolve({ success: true, health });
                        } catch (e) {
                            resolve({ success: true });
                        }
                    } else {
                        reject(new Error(`Director returned status ${testRes.statusCode}`));
                    }
                });
            });

            testReq.on('error', (err) => {
                reject(new Error(`Cannot reach Director: ${err.message}`));
            });

            testReq.on('timeout', () => {
                testReq.destroy();
                reject(new Error('Connection timed out'));
            });

            testReq.end();
        });

        await healthCheck;

        // Step 2: Validate the connection token with Director
        const tokenCheck = new Promise((resolve, reject) => {
            const postData = JSON.stringify({ connection_token: testToken });

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: '/api/identity/validate-client-token',
                method: 'POST',
                timeout: 5000,
                rejectUnauthorized: false,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const testReq = client.request(options, (testRes) => {
                let data = '';
                testRes.on('data', chunk => data += chunk);
                testRes.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        if (testRes.statusCode === 200 && result.success) {
                            resolve({ valid: true, message: result.data?.message || 'Token is valid' });
                        } else {
                            resolve({ valid: false, message: result.detail || 'Invalid connection token' });
                        }
                    } catch (e) {
                        resolve({ valid: false, message: 'Could not validate token' });
                    }
                });
            });

            testReq.on('error', (err) => {
                // If token validation endpoint doesn't exist, just warn but allow connection
                resolve({ valid: true, message: 'Token validation not available (older Director version)', warning: true });
            });

            testReq.on('timeout', () => {
                testReq.destroy();
                resolve({ valid: true, message: 'Token validation timed out', warning: true });
            });

            testReq.write(postData);
            testReq.end();
        });

        const tokenResult = await tokenCheck;

        if (!tokenResult.valid) {
            return res.status(400).json({
                success: false,
                detail: tokenResult.message
            });
        }

        res.json({
            success: true,
            data: {
                message: tokenResult.warning
                    ? `Director is reachable. ${tokenResult.message}`
                    : `Director is reachable and token is valid!`,
                director_url: testUrl,
                token_valid: tokenResult.valid,
                token_provided: !!testToken
            }
        });

    } catch (error) {
        console.error('Error testing connection:', error.message);
        res.status(400).json({
            success: false,
            detail: error.message || 'Failed to test connection to Director'
        });
    }
});

/**
 * Factory reset - completely reset the Borgmatic UI instance
 * This deletes ALL data and configurations, returning to a fresh state
 */
router.post('/factory-reset', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { confirmation, regenerate_secret_key } = req.body;

        // Require exact confirmation
        if (confirmation !== 'RESET') {
            return res.status(400).json({
                success: false,
                detail: 'Confirmation required. You must type "RESET" to confirm this action.'
            });
        }

        console.warn(`🚨 FACTORY RESET initiated by ${req.user.username}${regenerate_secret_key ? ' (with SECRET_KEY regeneration)' : ''}`);

        const deletedItems = [];
        const errors = [];

        // Get current paths
        const currentMode = config.mode || 'standalone';
        const paths = config.getModeBasedPaths(currentMode);

        // 1. Delete passphrases.json (encrypted repository passphrases)
        const passphrasesFile = path.join(paths.dataDir, 'passphrases.json');
        try {
            if (await fs.pathExists(passphrasesFile)) {
                await fs.remove(passphrasesFile);
                deletedItems.push('Encrypted repository passphrases');
            }
        } catch (e) {
            errors.push(`passphrases.json: ${e.message}`);
        }

        // 2. Delete repository-credentials.json
        const repoCredentialsFile = path.join(paths.dataDir, 'repository-credentials.json');
        try {
            if (await fs.pathExists(repoCredentialsFile)) {
                await fs.remove(repoCredentialsFile);
                deletedItems.push('Repository credentials');
            }
        } catch (e) {
            errors.push(`repository-credentials.json: ${e.message}`);
        }

        // 3. Delete mode.json (operating mode)
        const modeFile = path.join(paths.dataDir, 'mode.json');
        try {
            if (await fs.pathExists(modeFile)) {
                await fs.remove(modeFile);
                deletedItems.push('Operating mode configuration');
            }
        } catch (e) {
            errors.push(`mode.json: ${e.message}`);
        }

        // 4. Delete identity.json (cryptographic identity)
        const identityFile = path.join(paths.dataDir, 'identity.json');
        try {
            if (await fs.pathExists(identityFile)) {
                await fs.remove(identityFile);
                deletedItems.push('Cryptographic identity');
            }
        } catch (e) {
            errors.push(`identity.json: ${e.message}`);
        }

        // 5. Delete director-clients.json (registered clients)
        const clientsFile = path.join(paths.dataDir, 'director-clients.json');
        try {
            if (await fs.pathExists(clientsFile)) {
                await fs.remove(clientsFile);
                deletedItems.push('Registered Director clients');
            }
        } catch (e) {
            errors.push(`director-clients.json: ${e.message}`);
        }

        // 6. Delete SSH keys data
        const sshKeysFile = path.join(paths.dataDir, 'ssh-keys.yaml');
        try {
            if (await fs.pathExists(sshKeysFile)) {
                await fs.remove(sshKeysFile);
                deletedItems.push('SSH keys configuration');
            }
        } catch (e) {
            errors.push(`ssh-keys.yaml: ${e.message}`);
        }

        // 7. Delete all borgmatic backup configurations
        const borgmaticDir = path.join(paths.configDir, 'borgmatic.d');
        try {
            if (await fs.pathExists(borgmaticDir)) {
                const files = await fs.readdir(borgmaticDir);
                for (const file of files) {
                    await fs.remove(path.join(borgmaticDir, file));
                }
                deletedItems.push(`Backup configurations (${files.length} files)`);
            }
        } catch (e) {
            errors.push(`borgmatic.d: ${e.message}`);
        }

        // 8. Delete repositories-unused.yaml (unused repositories list)
        const unusedReposFile = path.join(paths.configDir, 'repositories-unused.yaml');
        try {
            if (await fs.pathExists(unusedReposFile)) {
                await fs.remove(unusedReposFile);
                deletedItems.push('Unused repositories list');
            }
        } catch (e) {
            errors.push(`repositories-unused.yaml: ${e.message}`);
        }

        // 9. Delete backups-metadata.yaml
        const backupsMetadataFile = path.join(paths.configDir, 'backups-metadata.yaml');
        try {
            if (await fs.pathExists(backupsMetadataFile)) {
                await fs.remove(backupsMetadataFile);
                deletedItems.push('Backups metadata');
            }
        } catch (e) {
            errors.push(`backups-metadata.yaml: ${e.message}`);
        }

        // 10. Delete retention-profiles.yaml
        const retentionProfilesFile = path.join(paths.configDir, 'retention-profiles.yaml');
        try {
            if (await fs.pathExists(retentionProfilesFile)) {
                await fs.remove(retentionProfilesFile);
                deletedItems.push('Retention profiles');
            }
        } catch (e) {
            errors.push(`retention-profiles.yaml: ${e.message}`);
        }

        // 11. Delete saved schedules
        const schedulesFile = path.join(paths.configDir, 'saved_schedules.yaml');
        try {
            if (await fs.pathExists(schedulesFile)) {
                await fs.remove(schedulesFile);
                deletedItems.push('Saved backup schedules');
            }
        } catch (e) {
            errors.push(`saved_schedules.yaml: ${e.message}`);
        }

        // 12. Delete custom scripts
        const scriptsFile = path.join(paths.configDir, 'scripts.json');
        const scriptsDir = path.join(paths.configDir, 'scripts');
        try {
            if (await fs.pathExists(scriptsFile)) {
                await fs.remove(scriptsFile);
                deletedItems.push('Custom scripts metadata');
            }
            if (await fs.pathExists(scriptsDir)) {
                await fs.remove(scriptsDir);
                deletedItems.push('Custom scripts');
            }
        } catch (e) {
            errors.push(`scripts: ${e.message}`);
        }

        // 13. Delete passwords.yaml (legacy)
        const passwordsFile = path.join(paths.configDir, 'passwords.yaml');
        try {
            if (await fs.pathExists(passwordsFile)) {
                await fs.remove(passwordsFile);
                deletedItems.push('Legacy passwords file');
            }
        } catch (e) {
            errors.push(`passwords.yaml: ${e.message}`);
        }

        // 14. Delete deployments.json
        const deploymentsFile = path.join(paths.dataDir, 'deployments.json');
        try {
            if (await fs.pathExists(deploymentsFile)) {
                await fs.remove(deploymentsFile);
                deletedItems.push('Deployment configurations');
            }
        } catch (e) {
            errors.push(`deployments.json: ${e.message}`);
        }

        // 15. Delete templates data
        const templatesDir = path.join(paths.dataDir, 'templates');
        try {
            if (await fs.pathExists(templatesDir)) {
                await fs.remove(templatesDir);
                deletedItems.push('Template configurations');
            }
        } catch (e) {
            errors.push(`templates: ${e.message}`);
        }

        // 16. Optionally regenerate SECRET_KEY
        if (regenerate_secret_key) {
            const secretKeyFile = path.join(paths.dataDir, '.secret_key');
            try {
                if (await fs.pathExists(secretKeyFile)) {
                    await fs.remove(secretKeyFile);
                    deletedItems.push('SECRET_KEY (will be regenerated on restart)');
                    console.warn('🔑 SECRET_KEY deleted - will regenerate on next startup');
                }
            } catch (e) {
                errors.push(`.secret_key: ${e.message}`);
            }
        }

        // NOTE: We do NOT delete:
        // - .secret_key (unless regenerate_secret_key is true)
        // - admin.yaml (user needs to be able to log back in)
        // - SSL certificates (expensive to regenerate)

        // Clear the config parser cache so it doesn't show stale data
        try {
            const configParser = require('../services/config-parser');
            configParser.lastParsed = null;
            configParser.parsedConfigs = [];
            configParser.unusedRepositories = [];
            console.log('📄 Config parser cache cleared');
        } catch (e) {
            console.warn('Could not clear config parser cache:', e.message);
        }

        console.log(`✅ Factory reset complete. Deleted: ${deletedItems.length} items, Errors: ${errors.length}`);

        res.json({
            success: true,
            data: {
                message: 'Factory reset complete. Please restart the application.',
                deleted: deletedItems,
                errors: errors.length > 0 ? errors : undefined,
                requires_restart: true,
                secret_key_regenerated: !!regenerate_secret_key,
                note: regenerate_secret_key 
                    ? 'Admin credentials preserved. SECRET_KEY regenerated - you must re-enter all repository passphrases when accessing encrypted repos.'
                    : 'Admin credentials and SECRET_KEY preserved. Stored passphrases were deleted - re-enter them when you create new repository connections.'
            }
        });

    } catch (error) {
        console.error('Error during factory reset:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to complete factory reset: ' + error.message
        });
    }
});

module.exports = router;

