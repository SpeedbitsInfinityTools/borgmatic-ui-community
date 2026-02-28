const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

/**
 * Session Manager
 * Tracks active sessions and their last activity time
 * Sessions are persisted to disk to survive server restarts
 */
class SessionManager {
    constructor() {
        this.sessions = new Map(); // tokenHash -> { username, lastActivity, createdAt }
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes in milliseconds
        this.cleanupInterval = 5 * 60 * 1000; // Clean up every 5 minutes
        this.sessionFile = path.join(config.dataDir, '.sessions.json');
        this.saveDebounceTimer = null;

        // Load persisted sessions
        this.loadSessions();

        // Start cleanup task
        this.startCleanupTask();
    }

    /**
     * Load sessions from disk (survives server restarts)
     */
    loadSessions() {
        try {
            if (fs.existsSync(this.sessionFile)) {
                const data = fs.readFileSync(this.sessionFile, 'utf8');
                const parsed = JSON.parse(data);

                // Filter out expired sessions
                const now = Date.now();
                let loadedCount = 0;
                for (const [tokenHash, session] of Object.entries(parsed)) {
                    const timeSinceActivity = now - session.lastActivity;
                    if (timeSinceActivity <= this.sessionTimeout) {
                        this.sessions.set(tokenHash, session);
                        loadedCount++;
                    }
                }

                if (loadedCount > 0) {
                    console.log(`📂 Restored ${loadedCount} session(s) from disk`);
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not load sessions from disk:', error.message);
        }
    }

    /**
     * Save sessions to disk (debounced to avoid excessive writes)
     */
    saveSessions() {
        // Debounce to avoid writing too frequently
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }

        this.saveDebounceTimer = setTimeout(() => {
            try {
                const sessionsObj = Object.fromEntries(this.sessions);
                fs.ensureDirSync(path.dirname(this.sessionFile));
                fs.writeFileSync(this.sessionFile, JSON.stringify(sessionsObj), { mode: 0o600 });
            } catch (error) {
                console.warn('⚠️ Could not save sessions to disk:', error.message);
            }
        }, 1000); // Write at most once per second
    }

    /**
     * Create a hash of the token for storage (to avoid storing full tokens)
     */
    hashToken(token) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Create a new session
     */
    createSession(token, username) {
        const tokenHash = this.hashToken(token);
        const now = Date.now();

        this.sessions.set(tokenHash, {
            username,
            lastActivity: now,
            createdAt: now
        });

        console.log(`📝 Session created for user: ${username}`);
        this.saveSessions();
    }

    /**
     * Update session activity (heartbeat)
     */
    updateActivity(token) {
        const tokenHash = this.hashToken(token);
        const session = this.sessions.get(tokenHash);

        if (!session) {
            return false;
        }

        session.lastActivity = Date.now();
        this.saveSessions(); // Debounced - won't write on every request
        return true;
    }

    /**
     * Check if session is valid (not expired)
     */
    isSessionValid(token) {
        const tokenHash = this.hashToken(token);
        const session = this.sessions.get(tokenHash);

        if (!session) {
            return false;
        }

        const now = Date.now();
        const timeSinceActivity = now - session.lastActivity;

        if (timeSinceActivity > this.sessionTimeout) {
            // Session expired due to inactivity
            this.removeSession(token);
            console.log(`⏰ Session expired for user: ${session.username} (${Math.round(timeSinceActivity / 1000 / 60)} minutes inactive)`);
            return false;
        }

        return true;
    }

    /**
     * Remove a session (logout)
     */
    removeSession(token) {
        const tokenHash = this.hashToken(token);
        const session = this.sessions.get(tokenHash);

        if (session) {
            console.log(`🚪 Session removed for user: ${session.username}`);
        }

        this.sessions.delete(tokenHash);
        this.saveSessions();
    }

    /**
     * Get session info
     */
    getSessionInfo(token) {
        const tokenHash = this.hashToken(token);
        const session = this.sessions.get(tokenHash);

        if (!session) {
            return null;
        }

        const now = Date.now();
        const inactiveDuration = now - session.lastActivity;
        const sessionDuration = now - session.createdAt;
        const timeUntilExpiry = this.sessionTimeout - inactiveDuration;

        return {
            username: session.username,
            lastActivity: new Date(session.lastActivity).toISOString(),
            createdAt: new Date(session.createdAt).toISOString(),
            inactiveMinutes: Math.floor(inactiveDuration / 1000 / 60),
            sessionMinutes: Math.floor(sessionDuration / 1000 / 60),
            expiresInMinutes: Math.floor(timeUntilExpiry / 1000 / 60),
            expiresInSeconds: Math.floor(timeUntilExpiry / 1000),
            isValid: timeUntilExpiry > 0
        };
    }

    /**
     * Clean up expired sessions
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [tokenHash, session] of this.sessions.entries()) {
            const timeSinceActivity = now - session.lastActivity;

            if (timeSinceActivity > this.sessionTimeout) {
                console.log(`🧹 Cleaning up expired session for user: ${session.username}`);
                this.sessions.delete(tokenHash);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`✅ Cleaned up ${cleanedCount} expired session(s)`);
            this.saveSessions();
        }
    }

    /**
     * Start automatic cleanup task
     */
    startCleanupTask() {
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, this.cleanupInterval);

        console.log(`🔄 Session cleanup task started (runs every ${this.cleanupInterval / 1000 / 60} minutes)`);
    }

    /**
     * Get statistics
     */
    getStats() {
        const now = Date.now();
        const sessions = Array.from(this.sessions.values());

        return {
            activeSessions: sessions.length,
            sessionTimeout: this.sessionTimeout / 1000 / 60, // in minutes
            sessions: sessions.map(s => ({
                username: s.username,
                inactiveMinutes: Math.floor((now - s.lastActivity) / 1000 / 60),
                sessionMinutes: Math.floor((now - s.createdAt) / 1000 / 60)
            }))
        };
    }
}

// Export singleton instance
module.exports = new SessionManager();

