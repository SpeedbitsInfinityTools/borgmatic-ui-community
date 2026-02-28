const crypto = require('crypto');
const authService = require('../services/auth');
const sessionManager = require('../services/session-manager');

const DEBUG_AUTH = process.env.DEBUG_AUTH === 'true' || false; // Set to true to enable
const debugLog = (...args) => DEBUG_AUTH && console.log(...args);

function sanitizeUrlForLogs(url) {
    if (!url) return url;

    // Mask encoded S3 credentials: s3%3AACCESS%3ASECRET%40...
    // Note: access/secret can contain many characters; we conservatively mask everything until %40 (@)
    let sanitized = url.replace(/s3%3A[^%]+%3A[^%]+%40/gi, 's3%3A***%40');

    // Also try decoded masking, then re-use decoded string for logs (more readable)
    try {
        const decoded = decodeURIComponent(url);
        const maskedDecoded = decoded
            // Mask Borg 2.x S3 form: s3:ACCESS:SECRET@...
            .replace(/^s3:[^:]+:[^@]+@/i, 's3:***@')
            // Mask any access_token-style query params if present
            .replace(/([?&](?:access_token|token|jwt)=)[^&]+/gi, '$1***');
        sanitized = maskedDecoded;
    } catch (e) {
        // ignore decode errors; keep encoded sanitized
    }

    return sanitized;
}

// API Key for automated tools (Infinity Tools, CI/CD, etc.)
const INFINITY_TOOLS_API_KEY = process.env.INFINITY_TOOLS_API_KEY || null;

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch (e) {
        return false;
    }
}

/**
 * Middleware to authenticate JWT tokens OR API Key
 */
const authenticateToken = async (req, res, next) => {
    // Auth logging is debug-only to avoid log spam and leaking sensitive URLs (e.g. s3:ACCESS:SECRET@...)
    debugLog('🔐 [auth middleware] Request received:', req.method, req.path, sanitizeUrlForLogs(req.url));
    try {
        // Check for API Key first (for automated tools)
        const apiKey = req.headers['x-api-key'];
        if (apiKey && INFINITY_TOOLS_API_KEY) {
            // Use constant-time comparison to prevent timing attacks
            if (secureCompare(apiKey, INFINITY_TOOLS_API_KEY)) {
                // API Key auth - create synthetic admin user
                req.user = {
                    username: 'infinity-tools',
                    is_admin: true,
                    is_active: true,
                    role: 'api-key',
                    api_key_auth: true
                };
                debugLog('🔐 [auth middleware] API Key authentication successful');
                return next();
            } else {
                return res.status(401).json({
                    detail: 'Invalid API key',
                    error: 'API key authentication failed'
                });
            }
        }

        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                detail: 'Could not validate credentials',
                error: 'No token provided'
            });
        }

        // Verify JWT token
        const decoded = authService.verifyToken(token);
        if (!decoded) {
            return res.status(401).json({
                detail: 'Could not validate credentials',
                error: 'Invalid token'
            });
        }

        // Check if this is an internal proxy request (bypass session validation)
        const isInternalProxy = req.headers['x-internal-proxy'] === 'true';

        if (!isInternalProxy) {
            // Check session validity (inactivity timeout) for external requests only
            if (!sessionManager.isSessionValid(token)) {
                return res.status(401).json({
                    detail: 'Session expired due to inactivity',
                    error: 'Session expired',
                    session_expired: true
                });
            }

            // Update activity timestamp (every request counts as activity)
            sessionManager.updateActivity(token);
        } else {
            debugLog('🔓 Internal proxy request - bypassing session validation');
        }

        // Get user from YAML file
        const user = await authService.getUserProfile(decoded.sub);
        if (!user) {
            return res.status(401).json({
                detail: 'Could not validate credentials',
                error: 'User not found'
            });
        }

        if (!user.is_active) {
            return res.status(400).json({
                detail: 'Inactive user',
                error: 'User account is disabled'
            });
        }

        req.user = user;
        debugLog('🔐 [auth middleware] Authentication successful, calling next() for:', req.method, req.path);
        next();
    } catch (error) {
        debugLog('🔐 [auth middleware] Authentication error:', error.message);
        debugLog('🔐 [auth middleware] Error stack:', error.stack);
        console.error('Authentication middleware error:', error.message);
        return res.status(401).json({
            detail: 'Could not validate credentials',
            error: 'Authentication failed'
        });
    }
};

/**
 * Middleware to require admin privileges
 */
const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({
            detail: 'Not enough permissions',
            error: 'Admin access required'
        });
    }
    next();
};

/**
 * Middleware to require active user
 */
const requireActiveUser = (req, res, next) => {
    if (!req.user || !req.user.is_active) {
        return res.status(400).json({
            detail: 'Inactive user',
            error: 'User account is disabled'
        });
    }
    next();
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireActiveUser
};
