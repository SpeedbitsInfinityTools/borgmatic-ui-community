const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const yaml = require('js-yaml');
const config = require('../config');

/**
 * Template Manager Service
 * Handles template storage and management for Director mode
 */
class TemplateManager {
    constructor() {
        this.templatesDir = path.join(config.dataDir, 'templates');
        this.schedulesDir = path.join(this.templatesDir, 'schedules');
        this.backupsDir = path.join(this.templatesDir, 'backups');
        this.repositoriesDir = path.join(this.templatesDir, 'repositories');
    }

    /**
     * Initialize template directories
     */
    async initialize() {
        try {
            await fs.ensureDir(this.schedulesDir);
            await fs.ensureDir(this.backupsDir);
            await fs.ensureDir(this.repositoriesDir);
            console.log('✅ Template manager initialized');
        } catch (error) {
            console.error('Failed to initialize template manager:', error.message);
            throw error;
        }
    }

    /**
     * Get all templates of a specific type
     */
    async getTemplates(type) {
        try {
            const dir = this._getTypeDir(type);
            const files = await fs.readdir(dir);
            const templates = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const template = await fs.readJson(path.join(dir, file));
                    templates.push(template);
                }
            }

            return templates.sort((a, b) => 
                new Date(b.created_at) - new Date(a.created_at)
            );
        } catch (error) {
            console.error(`Failed to get ${type} templates:`, error.message);
            return [];
        }
    }

    /**
     * Get single template by ID
     */
    async getTemplate(type, templateId) {
        try {
            const dir = this._getTypeDir(type);
            const templateFile = path.join(dir, `${templateId}.json`);

            if (!await fs.pathExists(templateFile)) {
                return null;
            }

            return await fs.readJson(templateFile);
        } catch (error) {
            console.error('Failed to get template:', error.message);
            return null;
        }
    }

    /**
     * Create new template
     */
    async createTemplate(type, templateData) {
        try {
            const dir = this._getTypeDir(type);
            const templateId = uuidv4();

            const template = {
                id: templateId,
                type: type,
                name: templateData.name,
                description: templateData.description || '',
                config: templateData.config,
                status: templateData.status || 'draft', // draft or complete
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                created_by: templateData.created_by || 'admin'
            };

            // For backup templates, extract summary data
            if (type === 'backup' || type === 'backups') {
                template.sources_summary = templateData.config?.sources || [];
                template.repositories_summary = templateData.config?.repositories || [];
                template.retention_profile_id = templateData.config?.retention_profile_id;
            }

            // For repository templates, add pattern fields
            if (type === 'repository' || type === 'repositories') {
                template.path_pattern = templateData.path_pattern || templateData.config?.path_pattern;
                template.encryption = templateData.encryption || templateData.config?.encryption || 'repokey-blake2';
                template.repository_type = templateData.repository_type || templateData.config?.repository_type || 'local';
                template.ssh_key_id = templateData.ssh_key_id || templateData.config?.ssh_key_id;
            }

            const templateFile = path.join(dir, `${templateId}.json`);
            await fs.writeJson(templateFile, template, { spaces: 2 });

            console.log(`✅ Template created: ${template.name} (${type}) - Status: ${template.status}`);
            return template;
        } catch (error) {
            console.error('Failed to create template:', error.message);
            throw error;
        }
    }

    /**
     * Update existing template
     */
    async updateTemplate(type, templateId, updates) {
        try {
            const template = await this.getTemplate(type, templateId);

            if (!template) {
                throw new Error('Template not found');
            }

            // Update fields
            if (updates.name) template.name = updates.name;
            if (updates.description !== undefined) template.description = updates.description;
            if (updates.config) template.config = updates.config;
            if (updates.status) template.status = updates.status;
            template.updated_at = new Date().toISOString();

            // For backup templates, update summary data
            if ((type === 'backup' || type === 'backups') && updates.config) {
                template.sources_summary = updates.config.sources || template.sources_summary || [];
                template.repositories_summary = updates.config.repositories || template.repositories_summary || [];
                template.retention_profile_id = updates.config.retention_profile_id || template.retention_profile_id;
            }

            // For repository templates, update pattern fields
            if (type === 'repository' || type === 'repositories') {
                if (updates.path_pattern !== undefined) template.path_pattern = updates.path_pattern;
                if (updates.encryption) template.encryption = updates.encryption;
                if (updates.repository_type) template.repository_type = updates.repository_type;
                if (updates.ssh_key_id !== undefined) template.ssh_key_id = updates.ssh_key_id;
            }

            const dir = this._getTypeDir(type);
            const templateFile = path.join(dir, `${templateId}.json`);
            await fs.writeJson(templateFile, template, { spaces: 2 });

            console.log(`✅ Template updated: ${template.name} - Status: ${template.status}`);
            return template;
        } catch (error) {
            console.error('Failed to update template:', error.message);
            throw error;
        }
    }

    /**
     * Delete template
     */
    async deleteTemplate(type, templateId) {
        try {
            const dir = this._getTypeDir(type);
            const templateFile = path.join(dir, `${templateId}.json`);

            if (!await fs.pathExists(templateFile)) {
                throw new Error('Template not found');
            }

            await fs.remove(templateFile);
            console.log(`🗑️ Template deleted: ${templateId}`);

            return { success: true };
        } catch (error) {
            console.error('Failed to delete template:', error.message);
            throw error;
        }
    }

    /**
     * Clone existing backup/schedule/repo as template
     */
    async cloneAsTemplate(type, sourceData, templateName, description, createdBy) {
        try {
            const template = await this.createTemplate(type, {
                name: templateName,
                description: description,
                config: sourceData,
                created_by: createdBy
            });

            return template;
        } catch (error) {
            console.error('Failed to clone as template:', error.message);
            throw error;
        }
    }

    /**
     * Get template directory for type
     */
    _getTypeDir(type) {
        switch (type) {
            case 'schedule':
            case 'schedules':
                return this.schedulesDir;
            case 'backup':
            case 'backups':
                return this.backupsDir;
            case 'repository':
            case 'repositories':
                return this.repositoriesDir;
            default:
                throw new Error(`Invalid template type: ${type}`);
        }
    }

    /**
     * Get all templates (all types)
     */
    async getAllTemplates() {
        try {
            const schedules = await this.getTemplates('schedules');
            const backups = await this.getTemplates('backups');
            const repositories = await this.getTemplates('repositories');

            return {
                schedules: schedules,
                backups: backups,
                repositories: repositories,
                total: schedules.length + backups.length + repositories.length
            };
        } catch (error) {
            console.error('Failed to get all templates:', error.message);
            return {
                schedules: [],
                backups: [],
                repositories: [],
                total: 0
            };
        }
    }

    /**
     * Expand path pattern with variables
     * Supports: {hostname}, {client_id}, {date}, {datetime}
     */
    expandPathPattern(pattern, variables = {}) {
        if (!pattern) {
            return '';
        }
        
        let expanded = pattern;

        // Default variables
        const defaults = {
            hostname: require('os').hostname(),
            date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
            datetime: new Date().toISOString().replace(/:/g, '-').split('.')[0], // YYYY-MM-DDTHH-MM-SS
        };

        // Merge with provided variables
        const allVars = { ...defaults, ...variables };

        // Replace variables
        for (const [key, value] of Object.entries(allVars)) {
            const regex = new RegExp(`\\{${key}\\}`, 'g');
            expanded = expanded.replace(regex, String(value || ''));
        }

        return expanded;
    }

    /**
     * Validate template status
     * Check if template has all required fields to be marked as complete
     */
    validateTemplateStatus(type, template) {
        switch (type) {
            case 'backup':
            case 'backups':
                // Backup templates need name, sources, repositories, and retention
                return !!(
                    template.name &&
                    template.config?.sources?.length > 0 &&
                    template.config?.repositories?.length > 0 &&
                    template.config?.retention_profile_id
                );
            
            case 'repository':
            case 'repositories':
                // Repository templates need name, path pattern, and encryption
                return !!(
                    template.name &&
                    (template.path_pattern || template.config?.path_pattern) &&
                    (template.encryption || template.config?.encryption)
                );
            
            case 'schedule':
            case 'schedules':
                // Schedule templates need name and schedule config
                return !!(
                    template.name &&
                    template.config?.frequency
                );
            
            default:
                return false;
        }
    }

    /**
     * Auto-update template status based on validation
     */
    async autoUpdateStatus(type, templateId) {
        try {
            const template = await this.getTemplate(type, templateId);
            if (!template) {
                return null;
            }

            const isValid = this.validateTemplateStatus(type, template);
            const newStatus = isValid ? 'complete' : 'draft';

            if (template.status !== newStatus) {
                return await this.updateTemplate(type, templateId, { status: newStatus });
            }

            return template;
        } catch (error) {
            console.error('Failed to auto-update template status:', error.message);
            return null;
        }
    }

    /**
     * Initialize system templates (SpeedBits Standard, etc.)
     * These are read-only templates provided by the system
     */
    async initializeSystemTemplates() {
        try {
            // SpeedBits/Infinity Tools Standard Template
            const speedbitsTemplate = {
                id: 'speedbits-standard',
                type: 'backup',
                name: 'SpeedBits Standard',
                description: 'Complete backup solution for Infinity Tools installations - backs up /opt/speedbits and auto-discovers databases on the borgmatic-db network',
                is_system_template: true,
                version: '1.1.0', // Bump version to force template refresh with new hook format
                status: 'complete',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                created_by: 'system',
                
                config: {
                    sources: [
                        {
                            type: 'local',
                            path: '/opt/speedbits',
                            label: 'SpeedBits Applications & Data'
                        }
                    ],
                    
                    auto_discover_databases: true,
                    database_network: 'borgmatic-db',
                    database_types: ['mariadb', 'postgresql', 'sqlite', 'mongodb'],
                    
                    repositories: [],
                    
                    exclude_patterns: [
                        '*.tmp',
                        '*.log',
                        '*/logs/*',
                        '*/cache/*',
                        '*/tmp/*',
                        '*/.git/*',
                        '*/node_modules/*',
                        '*/venv/*',
                        '*/__pycache__/*',
                        '*/database-dumps/*'
                    ],
                    
                    retention_profile_id: 'profile-standard',
                    schedule_id: null,
                    
                    exclude_caches: true,
                    upload_rate_limit: 0,
                    archive_name_format: '{hostname}-speedbits-{now}',
                    check_frequency: '2 weeks',
                    log_file: '/var/log/borgmatic.log',
                    log_level: 'info',
                    
                    hooks: {
                        before_backup: [
                            'echo "Starting SpeedBits Standard backup..."',
                            'bash /app/scripts/borgmatic-database-discovery.sh notify'
                        ],
                        after_backup: [
                            'echo "SpeedBits Standard backup completed."'
                        ],
                        on_error: []
                    }
                },
                
                sources_summary: [
                    {
                        type: 'local',
                        path: '/opt/speedbits',
                        label: 'SpeedBits Applications & Data'
                    }
                ],
                
                repositories_summary: [],
                retention_profile_id: 'profile-standard'
            };

            const templateFile = path.join(this.backupsDir, 'speedbits-standard.json');
            
            // Only create if it doesn't exist
            if (!await fs.pathExists(templateFile)) {
                await fs.writeJson(templateFile, speedbitsTemplate, { spaces: 2 });
                console.log('✅ SpeedBits Standard template initialized');
            } else {
                // Update existing template to ensure it has the latest config
                const existing = await fs.readJson(templateFile);
                if (existing.version !== speedbitsTemplate.version) {
                    await fs.writeJson(templateFile, {
                        ...speedbitsTemplate,
                        created_at: existing.created_at // Preserve original creation date
                    }, { spaces: 2 });
                    console.log('✅ SpeedBits Standard template updated to v' + speedbitsTemplate.version);
                }
            }
        } catch (error) {
            console.error('Failed to initialize system templates:', error.message);
        }
    }

    /**
     * Check if template is a system template
     */
    isSystemTemplate(template) {
        return template && template.is_system_template === true;
    }
}

module.exports = new TemplateManager();

