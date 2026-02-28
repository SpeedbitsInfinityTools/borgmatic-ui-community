/**
 * Script Manager Service
 * Manages pre/post backup scripts with a central library
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execAsync = promisify(exec);

class ScriptManager {
    constructor() {
        this.scriptsDir = path.join(config.configDir, 'scripts');
        this.scriptsConfigFile = path.join(config.configDir, 'scripts.json');
        this.defaultScripts = this.getDefaultScripts();
    }

    /**
     * Initialize scripts directory and config
     */
    async init() {
        await fs.ensureDir(this.scriptsDir);

        // Create scripts.json if it doesn't exist
        if (!await fs.pathExists(this.scriptsConfigFile)) {
            await this.saveConfig({
                scripts: [],
                version: 1
            });
        }
    }

    /**
     * Get default script templates
     */
    getDefaultScripts() {
        return [
            {
                id: 'stop-docker',
                name: 'Stop Docker Containers',
                description: 'Stops all running Docker containers before backup to ensure data consistency',
                category: 'docker',
                icon: '🐳',
                isTemplate: true,
                hook_type: 'before_backup',
                script: `#!/bin/bash
# Stop all running Docker containers
echo "Stopping Docker containers..."
running_containers=$(docker ps -q)
if [ -n "$running_containers" ]; then
    docker stop $running_containers
    echo "Stopped $(echo "$running_containers" | wc -l) containers"
else
    echo "No running containers to stop"
fi
`,
                timeout: 300,
                run_condition: 'always'
            },
            {
                id: 'start-docker',
                name: 'Start Docker Containers',
                description: 'Starts previously stopped Docker containers after backup completes',
                category: 'docker',
                icon: '🐳',
                isTemplate: true,
                hook_type: 'after_backup',
                script: `#!/bin/bash
# Start all Docker containers
echo "Starting Docker containers..."
docker start $(docker ps -aq)
echo "Containers started"
`,
                timeout: 300,
                run_condition: 'always'
            },
            {
                id: 'mysql-dump',
                name: 'MySQL Database Dump',
                description: 'Creates a MySQL database dump before backup',
                category: 'database',
                icon: '🗄️',
                isTemplate: true,
                hook_type: 'before_backup',
                script: `#!/bin/bash
# MySQL dump before backup
# Configure these variables:
MYSQL_USER="root"
MYSQL_PASSWORD=""
MYSQL_DATABASE="mydb"
DUMP_PATH="/tmp/mysql-backup.sql"

echo "Creating MySQL dump..."
mysqldump -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" > "$DUMP_PATH"
echo "MySQL dump created at $DUMP_PATH"
`,
                timeout: 600,
                run_condition: 'always'
            },
            {
                id: 'postgres-dump',
                name: 'PostgreSQL Database Dump',
                description: 'Creates a PostgreSQL database dump before backup',
                category: 'database',
                icon: '🐘',
                isTemplate: true,
                hook_type: 'before_backup',
                script: `#!/bin/bash
# PostgreSQL dump before backup
# Configure these variables:
PG_DATABASE="mydb"
DUMP_PATH="/tmp/postgres-backup.sql"

echo "Creating PostgreSQL dump..."
pg_dump "$PG_DATABASE" > "$DUMP_PATH"
echo "PostgreSQL dump created at $DUMP_PATH"
`,
                timeout: 600,
                run_condition: 'always'
            },
            {
                id: 'notify-slack',
                name: 'Notify Slack on Error',
                description: 'Sends a notification to Slack when backup fails',
                category: 'notification',
                icon: '📢',
                isTemplate: true,
                hook_type: 'on_error',
                script: `#!/bin/bash
# Send Slack notification on error
# Configure this variable:
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

curl -X POST -H 'Content-type: application/json' \\
    --data '{"text":"⚠️ Backup failed! Check logs for details."}' \\
    "$SLACK_WEBHOOK_URL"
`,
                timeout: 30,
                run_condition: 'on_error'
            },
            {
                id: 'cleanup-temp',
                name: 'Cleanup Temp Files',
                description: 'Removes temporary files created during backup',
                category: 'maintenance',
                icon: '🧹',
                isTemplate: true,
                hook_type: 'after_backup',
                script: `#!/bin/bash
# Cleanup temporary files
echo "Cleaning up temporary files..."
rm -rf /tmp/backup-temp-*
rm -rf /tmp/mysql-backup.sql
rm -rf /tmp/postgres-backup.sql
echo "Cleanup complete"
`,
                timeout: 60,
                run_condition: 'always'
            },
            {
                id: 'sync-check',
                name: 'Sync Filesystem',
                description: 'Forces filesystem sync before backup to ensure all data is written',
                category: 'system',
                icon: '💾',
                isTemplate: true,
                hook_type: 'before_backup',
                script: `#!/bin/bash
# Sync filesystem before backup
echo "Syncing filesystem..."
sync
echo "Filesystem synced"
`,
                timeout: 60,
                run_condition: 'always'
            }
        ];
    }

    /**
     * Load scripts configuration
     */
    async loadConfig() {
        await this.init();
        try {
            const content = await fs.readFile(this.scriptsConfigFile, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to load scripts config:', error.message);
            return { scripts: [], version: 1 };
        }
    }

    /**
     * Save scripts configuration
     */
    async saveConfig(config) {
        await fs.writeFile(this.scriptsConfigFile, JSON.stringify(config, null, 2));
    }

    /**
     * Get all scripts (templates + custom)
     */
    async getAllScripts() {
        const config = await this.loadConfig();
        const templates = this.defaultScripts.map(s => ({ ...s, isTemplate: true }));
        const customScripts = config.scripts.map(s => ({ ...s, isTemplate: false }));

        return [...templates, ...customScripts];
    }

    /**
     * Get scripts by hook type
     */
    async getScriptsByHookType(hookType) {
        const allScripts = await this.getAllScripts();
        return allScripts.filter(s => s.hook_type === hookType);
    }

    /**
     * Get a script by ID
     */
    async getScript(id) {
        const allScripts = await this.getAllScripts();
        return allScripts.find(s => s.id === id);
    }

    /**
     * Create a new script
     */
    async createScript(scriptData) {
        const config = await this.loadConfig();

        const script = {
            id: uuidv4(),
            name: scriptData.name,
            description: scriptData.description || '',
            category: scriptData.category || 'custom',
            icon: scriptData.icon || '📜',
            hook_type: scriptData.hook_type || 'before_backup',
            script: scriptData.script,
            timeout: scriptData.timeout || 300,
            run_condition: scriptData.run_condition || 'always',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            used_by: []
        };

        // Save script file
        const scriptPath = path.join(this.scriptsDir, `${script.id}.sh`);
        await fs.writeFile(scriptPath, script.script);
        await fs.chmod(scriptPath, 0o755);

        // Save to config
        config.scripts.push(script);
        await this.saveConfig(config);

        return script;
    }

    /**
     * Update an existing script
     */
    async updateScript(id, updates) {
        const config = await this.loadConfig();
        const index = config.scripts.findIndex(s => s.id === id);

        if (index === -1) {
            throw new Error('Script not found');
        }

        const script = {
            ...config.scripts[index],
            ...updates,
            updated_at: new Date().toISOString()
        };

        // Update script file if content changed
        if (updates.script) {
            const scriptPath = path.join(this.scriptsDir, `${id}.sh`);
            await fs.writeFile(scriptPath, updates.script);
            await fs.chmod(scriptPath, 0o755);
        }

        config.scripts[index] = script;
        await this.saveConfig(config);

        return script;
    }

    /**
     * Delete a script
     */
    async deleteScript(id) {
        const config = await this.loadConfig();
        const index = config.scripts.findIndex(s => s.id === id);

        if (index === -1) {
            throw new Error('Script not found');
        }

        // Check if script is in use
        if (config.scripts[index].used_by && config.scripts[index].used_by.length > 0) {
            throw new Error(`Script is in use by ${config.scripts[index].used_by.length} backup(s)`);
        }

        // Remove script file
        const scriptPath = path.join(this.scriptsDir, `${id}.sh`);
        await fs.remove(scriptPath).catch(() => { });

        // Remove from config
        config.scripts.splice(index, 1);
        await this.saveConfig(config);
    }

    /**
     * Copy a template to create a custom script
     */
    async copyTemplate(templateId, customizations = {}) {
        const template = this.defaultScripts.find(s => s.id === templateId);
        if (!template) {
            throw new Error('Template not found');
        }

        return this.createScript({
            name: customizations.name || `${template.name} (Copy)`,
            description: customizations.description || template.description,
            category: template.category,
            icon: template.icon,
            hook_type: customizations.hook_type || template.hook_type,
            script: customizations.script || template.script,
            timeout: customizations.timeout || template.timeout,
            run_condition: customizations.run_condition || template.run_condition
        });
    }

    /**
     * Test a script (dry run)
     */
    async testScript(scriptContent, timeout = 30) {
        // Create temporary script file
        const tmpFile = path.join('/tmp', `borgmatic-test-${Date.now()}.sh`);

        try {
            await fs.writeFile(tmpFile, scriptContent);
            await fs.chmod(tmpFile, 0o755);

            // Execute with timeout
            const startTime = Date.now();
            const { stdout, stderr } = await execAsync(tmpFile, {
                timeout: timeout * 1000,
                env: {
                    ...process.env,
                    BORGMATIC_TEST: 'true',
                    BORGMATIC_DRY_RUN: 'true'
                }
            });

            const duration = Date.now() - startTime;

            return {
                success: true,
                output: stdout,
                errors: stderr,
                duration_ms: duration
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                output: error.stdout || '',
                errors: error.stderr || ''
            };
        } finally {
            await fs.remove(tmpFile).catch(() => { });
        }
    }

    /**
     * Get script execution path for borgmatic hooks
     */
    async getScriptPath(id) {
        // Check if it's a template
        const template = this.defaultScripts.find(s => s.id === id);
        if (template) {
            // Create a temporary copy for templates
            const scriptPath = path.join(this.scriptsDir, `template-${id}.sh`);
            await fs.writeFile(scriptPath, template.script);
            await fs.chmod(scriptPath, 0o755);
            return scriptPath;
        }

        // Return path to custom script
        return path.join(this.scriptsDir, `${id}.sh`);
    }

    /**
     * Generate hooks section for borgmatic config
     */
    async generateHooksConfig(beforeScriptIds = [], afterScriptIds = [], onErrorScriptIds = []) {
        const hooks = {};

        if (beforeScriptIds.length > 0) {
            hooks.before_backup = [];
            for (const id of beforeScriptIds) {
                const scriptPath = await this.getScriptPath(id);
                hooks.before_backup.push(scriptPath);
            }
        }

        if (afterScriptIds.length > 0) {
            hooks.after_backup = [];
            for (const id of afterScriptIds) {
                const scriptPath = await this.getScriptPath(id);
                hooks.after_backup.push(scriptPath);
            }
        }

        if (onErrorScriptIds.length > 0) {
            hooks.on_error = [];
            for (const id of onErrorScriptIds) {
                const scriptPath = await this.getScriptPath(id);
                hooks.on_error.push(scriptPath);
            }
        }

        return hooks;
    }

    /**
     * Update which backups use a script
     */
    async updateScriptUsage(scriptId, backupId, isUsed) {
        const config = await this.loadConfig();
        const script = config.scripts.find(s => s.id === scriptId);

        if (!script) return; // Template scripts don't track usage

        if (!script.used_by) script.used_by = [];

        if (isUsed && !script.used_by.includes(backupId)) {
            script.used_by.push(backupId);
        } else if (!isUsed) {
            script.used_by = script.used_by.filter(id => id !== backupId);
        }

        await this.saveConfig(config);
    }

    /**
     * Get script categories
     */
    getCategories() {
        return [
            { id: 'docker', name: 'Docker', icon: '🐳' },
            { id: 'database', name: 'Database', icon: '🗄️' },
            { id: 'notification', name: 'Notification', icon: '📢' },
            { id: 'maintenance', name: 'Maintenance', icon: '🧹' },
            { id: 'system', name: 'System', icon: '💾' },
            { id: 'custom', name: 'Custom', icon: '📜' }
        ];
    }

    /**
     * Get script execution history
     */
    async getScriptHistory(scriptId, limit = 10) {
        // For now, return empty - would need a separate log/history file
        return [];
    }
}

module.exports = new ScriptManager();

