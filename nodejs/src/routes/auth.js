const express = require('express');
const router = express.Router();
const authService = require('../services/auth');
const { authenticateToken } = require('../middleware/auth');
const sessionManager = require('../services/session-manager');

/**
 * Login endpoint
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                detail: 'Username and password are required' 
            });
        }

        const user = await authService.authenticateUser(username, password);
        if (!user) {
            return res.status(401).json({ 
                detail: 'Username or password incorrect!' 
            });
        }

        // Update last login
        await authService.updateLastLogin(username);

        // Create JWT token (30 minutes expiration)
        const token = authService.createAccessToken({ sub: username });
        const expiresIn = 30 * 60; // 30 minutes in seconds

        // Create session tracking
        sessionManager.createSession(token, username);

        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: expiresIn
        });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ 
            detail: 'Internal server error' 
        });
    }
});

/**
 * Logout endpoint
 */
router.post('/logout', authenticateToken, (req, res) => {
    // Remove session from session manager
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        sessionManager.removeSession(token);
    }
    
    res.json({ 
        message: 'Logged out successfully' 
    });
});

/**
 * Get current user profile
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await authService.getUserProfile(req.user.username);
        if (!user) {
            return res.status(404).json({ 
                detail: 'User not found' 
            });
        }

        res.json(user);
    } catch (error) {
        console.error('Get profile error:', error.message);
        res.status(500).json({ 
            detail: 'Internal server error' 
        });
    }
});

/**
 * Refresh token endpoint - issues a new token extending the session
 */
router.post('/refresh', authenticateToken, (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const oldToken = authHeader && authHeader.split(' ')[1];
        const username = req.user.username;
        
        // Remove old session
        if (oldToken) {
            sessionManager.removeSession(oldToken);
        }
        
        // Create new token with fresh expiration
        const newToken = authService.createAccessToken({ sub: username });
        const expiresIn = 30 * 60; // 30 minutes
        
        // Create new session
        sessionManager.createSession(newToken, username);
        
        console.log(`🔄 Token refreshed for user: ${username}`);
        
        res.json({
            access_token: newToken,
            token_type: 'bearer',
            expires_in: expiresIn
        });
    } catch (error) {
        console.error('Token refresh error:', error.message);
        res.status(500).json({ detail: 'Failed to refresh token' });
    }
});

/**
 * Heartbeat endpoint to keep session alive
 * Also returns a refreshed token to extend the session
 */
router.post('/heartbeat', authenticateToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const oldToken = authHeader && authHeader.split(' ')[1];
    const username = req.user.username;
    
    if (oldToken) {
        // Update activity on old session
        sessionManager.updateActivity(oldToken);
        
        // Issue a new token with fresh expiration
        const newToken = authService.createAccessToken({ sub: username });
        const expiresIn = 30 * 60;
        
        // Remove old session and create new one
        sessionManager.removeSession(oldToken);
        sessionManager.createSession(newToken, username);
        
        const sessionInfo = sessionManager.getSessionInfo(newToken);
        
        res.json({
            success: true,
            message: 'Session refreshed',
            access_token: newToken,
            expires_in: expiresIn,
            session: sessionInfo
        });
    } else {
        res.status(400).json({
            success: false,
            detail: 'No token provided'
        });
    }
});

/**
 * Get session info
 */
router.get('/session', authenticateToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        const sessionInfo = sessionManager.getSessionInfo(token);
        
        if (sessionInfo) {
            res.json({
                success: true,
                session: sessionInfo
            });
        } else {
            res.status(401).json({
                success: false,
                detail: 'Session not found or expired'
            });
        }
    } else {
        res.status(400).json({
            success: false,
            detail: 'No token provided'
        });
    }
});

/**
 * Change password endpoint
 */
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ 
                detail: 'Current password and new password are required' 
            });
        }

        // Verify current password
        const user = await authService.loadAdminUser();
        if (!user) {
            return res.status(404).json({ 
                detail: 'User not found' 
            });
        }

        const isValidPassword = await authService.verifyPassword(current_password, user.password_hash);
        if (!isValidPassword) {
            return res.status(400).json({ 
                detail: 'Current password is incorrect' 
            });
        }

        // Update password
        const newHashedPassword = await authService.hashPassword(new_password);
        user.password_hash = newHashedPassword;
        
        const saved = await authService.saveAdminUser(user);
        if (!saved) {
            return res.status(500).json({ 
                detail: 'Failed to update password' 
            });
        }

        res.json({ 
            message: 'Password updated successfully' 
        });
    } catch (error) {
        console.error('Change password error:', error.message);
        res.status(500).json({ 
            detail: 'Internal server error' 
        });
    }
});

module.exports = router;
