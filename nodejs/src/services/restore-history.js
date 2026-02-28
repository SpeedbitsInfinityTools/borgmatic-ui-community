/**
 * Restore History Service
 * 
 * Persists the last restore operation per archive in a JSON file.
 * Stores: { archiveName: { destination, destinationType, completedAt, repoPath, paths } }
 */

const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class RestoreHistoryService {
    constructor() {
        this.historyFile = path.join(config.dataDir, 'restore-history.json');
        this.history = {};
        this.loaded = false;
    }

    /**
     * Load history from disk
     */
    async load() {
        if (this.loaded) return;
        
        try {
            if (await fs.pathExists(this.historyFile)) {
                this.history = await fs.readJson(this.historyFile);
                console.log(`📜 Loaded restore history (${Object.keys(this.history).length} entries)`);
            } else {
                this.history = {};
            }
            this.loaded = true;
        } catch (error) {
            console.warn('⚠️ Failed to load restore history:', error.message);
            this.history = {};
            this.loaded = true;
        }
    }

    /**
     * Save history to disk
     */
    async save() {
        try {
            await fs.ensureDir(path.dirname(this.historyFile));
            await fs.writeJson(this.historyFile, this.history, { spaces: 2 });
        } catch (error) {
            console.error('❌ Failed to save restore history:', error.message);
            throw error;
        }
    }

    /**
     * Record a restore operation for an archive
     * @param {string} archiveName - The archive name
     * @param {object} info - Restore information
     * @param {string} info.repoPath - Repository path
     * @param {string} info.destination - Destination path or description
     * @param {string} info.destinationType - 'local' | 'download' | 'original'
     * @param {string[]} [info.paths] - Paths that were restored (optional)
     */
    async recordRestore(archiveName, info) {
        await this.load();
        
        this.history[archiveName] = {
            repoPath: info.repoPath,
            destination: info.destination,
            destinationType: info.destinationType,
            paths: info.paths || [],
            completedAt: new Date().toISOString(),
        };

        await this.save();
        console.log(`📜 Recorded restore for archive: ${archiveName}`);
        
        return this.history[archiveName];
    }

    /**
     * Get restore history for a specific archive
     * @param {string} archiveName - The archive name
     * @returns {object|null} - Restore info or null
     */
    async getArchiveHistory(archiveName) {
        await this.load();
        return this.history[archiveName] || null;
    }

    /**
     * Get all restore history
     * @returns {object} - All history entries keyed by archive name
     */
    async getAllHistory() {
        await this.load();
        return { ...this.history };
    }

    /**
     * Get restore history for a specific repository (all archives)
     * @param {string} repoPath - Repository path
     * @returns {object} - History entries for this repo
     */
    async getRepositoryHistory(repoPath) {
        await this.load();
        
        const repoHistory = {};
        for (const [archiveName, info] of Object.entries(this.history)) {
            if (info.repoPath === repoPath) {
                repoHistory[archiveName] = info;
            }
        }
        return repoHistory;
    }

    /**
     * Clear history for a specific archive
     * @param {string} archiveName - The archive name
     */
    async clearArchiveHistory(archiveName) {
        await this.load();
        
        if (this.history[archiveName]) {
            delete this.history[archiveName];
            await this.save();
        }
    }

    /**
     * Clear all history
     */
    async clearAllHistory() {
        this.history = {};
        await this.save();
    }
}

// Export singleton instance
module.exports = new RestoreHistoryService();
