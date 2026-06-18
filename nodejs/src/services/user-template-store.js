const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * User Template Store
 *
 * Persists user-created backup templates (exported from existing backup jobs or
 * imported from a file) as JSON files on disk so they appear on the Templates
 * page. This is intentionally separate from the built-in one-click templates and
 * from the Director deployment templates: it just stores reusable backup-job
 * blueprints for any mode (standalone, client, director).
 *
 * Stored shape (one file per template, `<id>.json`):
 *   { id, name, description, created_at, template: <exported backup template JSON> }
 */
class UserTemplateStore {
    constructor() {
        this.dir = path.join(config.dataDir, 'user-templates');
    }

    async _ensureDir() {
        await fs.ensureDir(this.dir);
    }

    _filePath(id) {
        // Guard against path traversal: only allow the id we generated.
        const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeId) {
            throw new Error('Invalid template id');
        }
        return path.join(this.dir, `${safeId}.json`);
    }

    /**
     * List all saved user templates, newest first.
     */
    async list() {
        await this._ensureDir();
        const files = await fs.readdir(this.dir);
        const templates = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const entry = await fs.readJson(path.join(this.dir, file));
                if (entry && entry.id) {
                    templates.push(entry);
                }
            } catch (error) {
                console.error(`Skipping unreadable user template ${file}:`, error.message);
            }
        }
        return templates.sort((a, b) =>
            new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );
    }

    /**
     * Get a single saved template by id.
     */
    async get(id) {
        await this._ensureDir();
        const filePath = this._filePath(id);
        if (!await fs.pathExists(filePath)) {
            return null;
        }
        return fs.readJson(filePath);
    }

    /**
     * Save a new user template.
     * @param {{name: string, description?: string, template: object}} input
     */
    async save({ name, description, template }) {
        await this._ensureDir();

        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('Template name is required');
        }
        if (!template || typeof template !== 'object' || Array.isArray(template)) {
            throw new Error('Template payload is required');
        }

        const entry = {
            id: uuidv4(),
            name: name.trim(),
            description: typeof description === 'string' ? description.trim() : '',
            created_at: new Date().toISOString(),
            template,
        };

        await fs.writeJson(this._filePath(entry.id), entry, { spaces: 2 });
        return entry;
    }

    /**
     * Delete a saved template by id. Returns true if a file was removed.
     */
    async remove(id) {
        await this._ensureDir();
        const filePath = this._filePath(id);
        if (!await fs.pathExists(filePath)) {
            return false;
        }
        await fs.remove(filePath);
        return true;
    }
}

module.exports = new UserTemplateStore();
