const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Try mount via RCD API
 * NOTE: The mount happens on the HOST where RCD is running.
 * The mount_path must exist and be accessible on the host.
 */
router.post('/try-mount', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { rclone_remote, rclone_path, mount_path } = req.body;

        if (!rclone_remote || !mount_path) {
            return res.status(400).json({
                success: false,
                detail: 'Rclone remote and mount path are required'
            });
        }

        // Validate mount path
        if (!mount_path.startsWith('/')) {
            return res.status(400).json({
                success: false,
                detail: 'Mount path must be an absolute path'
            });
        }

        // Prevent path traversal in mount path
        if (mount_path.includes('..')) {
            return res.status(400).json({
                success: false,
                detail: 'Path traversal is not allowed in mount path'
            });
        }

        // Block sensitive system paths
        const sensitivePatterns = [
            /^\/etc\//, /^\/root\//, /^\/boot\//, /^\/sys\//, /^\/proc\//, /^\/dev\//,
            /\/\.ssh\//, /\/\.gnupg\//, /^\/usr\//, /^\/bin\//, /^\/sbin\//
        ];
        for (const pattern of sensitivePatterns) {
            if (pattern.test(mount_path)) {
                return res.status(403).json({
                    success: false,
                    detail: 'Cannot mount to system directories'
                });
            }
        }

        // Validate remote name (security)
        if (!/^[a-zA-Z0-9_-]+$/.test(rclone_remote)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid rclone remote name'
            });
        }

        const rcloneRCD = require('../../services/rclone-rcd');
        const normalizedRemotePath = rclone_path ? rclone_path.replace(/^\/+/, '') : '';

        console.log(`🔧 Trying to mount ${rclone_remote}:${normalizedRemotePath} to ${mount_path} via RCD`);

        try {
            // Check if RCD is available
            const isAvailable = await rcloneRCD.isAvailable();
            if (!isAvailable) {
                return res.status(503).json({
                    success: false,
                    detail: 'Rclone RCD is not running. Start rclone rcd on the host (port 5572).'
                });
            }

            // Check if already mounted
            const mounts = await rcloneRCD.listMounts();
            if (mounts.some(m => m.MountPoint === mount_path)) {
                return res.status(400).json({
                    success: false,
                    detail: 'Path is already mounted. Please unmount first.'
                });
            }

            // Mount via RCD (this runs on the HOST)
            await rcloneRCD.mount(rclone_remote, normalizedRemotePath, mount_path);
            console.log(`✅ Mount created via RCD: ${mount_path}`);

            // Wait a bit for mount to establish
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify mount exists
            const mountsAfter = await rcloneRCD.listMounts();
            const mounted = mountsAfter.some(m => m.MountPoint === mount_path);

            if (mounted) {
                // Unmount (it was just a test)
                try {
                    await rcloneRCD.unmount(mount_path);
                    console.log(`✅ Unmounted test mount via RCD: ${mount_path}`);
                } catch (unmountErr) {
                    console.warn(`⚠️  Failed to unmount test mount: ${unmountErr.message}`);
                }

                return res.json({
                    success: true,
                    message: 'Mount test successful. Remote is accessible via RCD.'
                });
            } else {
                return res.status(500).json({
                    success: false,
                    detail: 'Mount test failed. Check rclone remote configuration and permissions.'
                });
            }
        } catch (mountErr) {
            console.error('❌ RCD mount test error:', mountErr.message);
            return res.status(500).json({
                success: false,
                detail: `Mount test failed: ${mountErr.message}`
            });
        }
    } catch (error) {
        console.error('Failed to try mount:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to try mount: ' + error.message
        });
    }
});

/**
 * Create persistent mount via RCD API
 * NOTE: The mount is managed by RCD on the HOST. 
 * To make it truly persistent across RCD restarts, you may need to configure
 * rclone's automount feature or create a systemd service on the host for RCD.
 */
router.post('/create-persistent-mount', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { rclone_remote, rclone_path, mount_path, repository_id } = req.body;

        if (!rclone_remote || !mount_path) {
            return res.status(400).json({
                success: false,
                detail: 'Rclone remote and mount path are required'
            });
        }

        // Validate mount path
        if (!mount_path.startsWith('/')) {
            return res.status(400).json({
                success: false,
                detail: 'Mount path must be an absolute path'
            });
        }

        // Prevent path traversal in mount path
        if (mount_path.includes('..')) {
            return res.status(400).json({
                success: false,
                detail: 'Path traversal is not allowed in mount path'
            });
        }

        // Block sensitive system paths
        const sensitivePatterns = [
            /^\/etc\//, /^\/root\//, /^\/boot\//, /^\/sys\//, /^\/proc\//, /^\/dev\//,
            /\/\.ssh\//, /\/\.gnupg\//, /^\/usr\//, /^\/bin\//, /^\/sbin\//
        ];
        for (const pattern of sensitivePatterns) {
            if (pattern.test(mount_path)) {
                return res.status(403).json({
                    success: false,
                    detail: 'Cannot mount to system directories'
                });
            }
        }

        // Validate remote name (security)
        if (!/^[a-zA-Z0-9_-]+$/.test(rclone_remote)) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid rclone remote name'
            });
        }

        const rcloneRCD = require('../../services/rclone-rcd');
        const normalizedRemotePath = rclone_path ? rclone_path.replace(/^\/+/, '') : '';

        // Generate a mount ID for tracking
        const mountId = `borgmatic-${repository_id || uuidv4().split('-')[0]}`;

        console.log(`🔧 Creating persistent mount via RCD: ${rclone_remote}:${normalizedRemotePath} -> ${mount_path}`);

        try {
            // Check if RCD is available
            const isAvailable = await rcloneRCD.isAvailable();
            if (!isAvailable) {
                return res.status(503).json({
                    success: false,
                    detail: 'Rclone RCD is not running. Start rclone rcd on the host (port 5572).'
                });
            }

            // Check if already mounted
            const mounts = await rcloneRCD.listMounts();
            if (mounts.some(m => m.MountPoint === mount_path)) {
                return res.status(400).json({
                    success: false,
                    detail: 'Path is already mounted.'
                });
            }

            // Mount via RCD (this runs on the HOST)
            await rcloneRCD.mount(rclone_remote, normalizedRemotePath, mount_path);

            // Wait a bit for mount to establish
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify mount exists
            const mountsAfter = await rcloneRCD.listMounts();
            const mounted = mountsAfter.some(m => m.MountPoint === mount_path);

            if (mounted) {
                console.log(`✅ Persistent mount created via RCD: ${mount_path}`);
                return res.json({
                    success: true,
                    message: 'Mount created successfully via RCD. Note: Mount persists while RCD is running.',
                    mount_id: mountId,
                    mount_path: mount_path
                });
            } else {
                return res.status(500).json({
                    success: false,
                    detail: 'Mount command succeeded but mount not found. Check RCD logs.'
                });
            }
        } catch (mountErr) {
            console.error('❌ RCD mount error:', mountErr.message);
            return res.status(500).json({
                success: false,
                detail: `Failed to create mount: ${mountErr.message}`
            });
        }
    } catch (error) {
        console.error('Failed to create persistent mount:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to create persistent mount: ' + error.message
        });
    }
});

/**
 * Remove mount via RCD API
 * Accepts mount path as URL-encoded parameter
 */
router.delete('/remove-persistent-mount/:mountPath(*)', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const mountPathParam = req.params.mountPath || '';
        const decoded = decodeURIComponent(mountPathParam);
        const mountPath = decoded.startsWith('/') ? decoded : `/${decoded}`;

        // Validate mount path
        if (!mountPath || !mountPath.startsWith('/')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid mount path'
            });
        }

        const rcloneRCD = require('../../services/rclone-rcd');

        console.log(`🔧 Removing mount via RCD: ${mountPath}`);

        try {
            // Check if RCD is available
            const isAvailable = await rcloneRCD.isAvailable();
            if (!isAvailable) {
                return res.status(503).json({
                    success: false,
                    detail: 'Rclone RCD is not running.'
                });
            }

            // Check if mounted
            const mounts = await rcloneRCD.listMounts();
            const mount = mounts.find(m => m.MountPoint === mountPath);
            
            if (!mount) {
                return res.status(404).json({
                    success: false,
                    detail: 'Mount not found'
                });
            }

            // Unmount via RCD
            await rcloneRCD.unmount(mountPath);

            console.log(`✅ Mount removed via RCD: ${mountPath}`);
            return res.json({
                success: true,
                message: 'Mount removed successfully'
            });
        } catch (unmountErr) {
            console.error('❌ RCD unmount error:', unmountErr.message);
            return res.status(500).json({
                success: false,
                detail: `Failed to remove mount: ${unmountErr.message}`
            });
        }
    } catch (error) {
        console.error('Failed to remove mount:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to remove mount: ' + error.message
        });
    }
});

/**
 * List all current RCD mounts
 */
router.get('/list-mounts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rcloneRCD = require('../../services/rclone-rcd');

        const isAvailable = await rcloneRCD.isAvailable();
        if (!isAvailable) {
            return res.status(503).json({
                success: false,
                detail: 'Rclone RCD is not running.'
            });
        }

        const mounts = await rcloneRCD.listMounts();
        
        return res.json({
            success: true,
            data: {
                mounts: mounts.map(m => ({
                    mountPoint: m.MountPoint,
                    fs: m.Fs,
                    mountedOn: m.MountedOn
                })),
                count: mounts.length
            }
        });
    } catch (error) {
        console.error('Failed to list mounts:', error.message);
        res.status(500).json({
            success: false,
            detail: 'Failed to list mounts: ' + error.message
        });
    }
});

module.exports = router;
