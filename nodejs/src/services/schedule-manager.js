const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const config = require('../config');

/**
 * Schedule Manager
 * Manages cron schedules and executes backups using node-cron
 */
class ScheduleManager {
    constructor() {
        this.schedulesPath = path.join(config.configDir, 'saved_schedules.yaml');
        this.cronJobs = new Map(); // Active cron jobs
        this.runningBackups = new Set(); // Track running backups
    }

    /**
     * Initialize schedule manager on startup
     * Restores cron jobs for all active backups
     */
    async initialize() {
        console.log('🕒 Initializing schedule manager...');
        try {
            // Ensure schedules file exists with defaults
            await this.getAllSchedules();
            
            // Restore cron jobs for all active backups
            await this.restoreActiveBackupJobs();
            
            console.log('✅ Schedule manager initialized');
        } catch (error) {
            console.error('❌ Failed to initialize schedule manager:', error.message);
        }
    }

    /**
     * Restore cron jobs for all active backups on startup
     * This ensures scheduled backups continue running after container restart
     */
    async restoreActiveBackupJobs() {
        // Lazy-load to avoid circular dependency
        const backupManager = require('./backup-manager');
        
        const backups = await backupManager.getAllBackups();
        const schedules = await this.getAllSchedules();
        
        let restoredCount = 0;
        
        for (const backup of backups) {
            if (backup.is_active && backup.schedule_id) {
                const schedule = schedules.find(s => s.id === backup.schedule_id);
                if (schedule) {
                    if (!cron.validate(schedule.cron_expression)) {
                        console.warn(`⚠️  Invalid cron expression "${schedule.cron_expression}" for schedule ${schedule.id}`);
                        continue;
                    }
                    try {
                        this.startCronJob(
                            backup.schedule_id,
                            backup.id,
                            backup.filename,
                            schedule.cron_expression
                        );
                        restoredCount++;
                    } catch (error) {
                        console.warn(`⚠️  Failed to restore cron job for backup ${backup.name || backup.id}: ${error.message}`);
                    }
                } else {
                    console.warn(`⚠️  Schedule ${backup.schedule_id} not found for backup ${backup.name || backup.id}`);
                }
            }
        }
        
        if (restoredCount > 0) {
            console.log(`🕒 Restored ${restoredCount} scheduled backup job(s)`);
        } else {
            console.log('🕒 No active scheduled backups to restore');
        }
    }

    /**
     * Get all saved schedules
     */
    async getAllSchedules() {
        try {
            await fs.ensureFile(this.schedulesPath);
            const content = await fs.readFile(this.schedulesPath, 'utf8');
            
            if (!content.trim()) {
                await this.initializeDefaultSchedules();
                return await this.getAllSchedules();
            }

            const data = yaml.load(content) || {};
            return data.schedules || [];
        } catch (error) {
            console.error('Failed to get schedules:', error);
            throw error;
        }
    }

    /**
     * Initialize default schedules
     */
    async initializeDefaultSchedules() {
        const defaultSchedules = {
            schedules: [
                {
                    id: 'schedule-daily-2am',
                    name: 'Daily at 2 AM',
                    description: 'Runs every day at 2:00 AM',
                    cron_expression: '0 2 * * *',
                    created_at: new Date().toISOString()
                },
                {
                    id: 'schedule-weekly-sunday',
                    name: 'Weekly on Sunday',
                    description: 'Runs every Sunday at 3:00 AM',
                    cron_expression: '0 3 * * 0',
                    created_at: new Date().toISOString()
                },
                {
                    id: 'schedule-hourly',
                    name: 'Every Hour',
                    description: 'Runs at the start of every hour',
                    cron_expression: '0 * * * *',
                    created_at: new Date().toISOString()
                }
            ]
        };

        await fs.writeFile(
            this.schedulesPath,
            yaml.dump(defaultSchedules, { indent: 2 })
        );

        console.log('✓ Initialized default schedules');
    }

    /**
     * Get a specific schedule by ID
     */
    async getSchedule(scheduleId) {
        const schedules = await this.getAllSchedules();
        return schedules.find(s => s.id === scheduleId);
    }

    /**
     * Create a new schedule
     */
    async createSchedule(scheduleData) {
        try {
            const scheduleId = `schedule-${uuidv4().split('-')[0]}-${Date.now().toString(36)}`;
            
            // Validate cron expression
            if (!cron.validate(scheduleData.cron_expression)) {
                throw new Error('Invalid cron expression');
            }

            const content = await fs.readFile(this.schedulesPath, 'utf8');
            const data = yaml.load(content) || { schedules: [] };

            const newSchedule = {
                id: scheduleId,
                name: scheduleData.name,
                description: scheduleData.description || '',
                cron_expression: scheduleData.cron_expression,
                created_at: new Date().toISOString()
            };

            data.schedules = data.schedules || [];
            data.schedules.push(newSchedule);

            await fs.writeFile(
                this.schedulesPath,
                yaml.dump(data, { indent: 2 })
            );

            console.log(`✓ Created schedule: ${scheduleData.name}`);
            return newSchedule;
        } catch (error) {
            console.error('Failed to create schedule:', error);
            throw error;
        }
    }

    /**
     * Update a schedule
     */
    async updateSchedule(scheduleId, updates) {
        try {
            // Validate cron expression if provided
            if (updates.cron_expression && !cron.validate(updates.cron_expression)) {
                throw new Error('Invalid cron expression');
            }

            const content = await fs.readFile(this.schedulesPath, 'utf8');
            const data = yaml.load(content) || { schedules: [] };

            const scheduleIndex = data.schedules.findIndex(s => s.id === scheduleId);
            if (scheduleIndex === -1) {
                throw new Error('Schedule not found');
            }

            data.schedules[scheduleIndex] = {
                ...data.schedules[scheduleIndex],
                ...updates,
                id: scheduleId, // Ensure ID doesn't change
                updated_at: new Date().toISOString()
            };

            await fs.writeFile(
                this.schedulesPath,
                yaml.dump(data, { indent: 2 })
            );

            console.log(`✓ Updated schedule: ${scheduleId}`);
            return data.schedules[scheduleIndex];
        } catch (error) {
            console.error('Failed to update schedule:', error);
            throw error;
        }
    }

    /**
     * Delete a schedule
     */
    async deleteSchedule(scheduleId) {
        try {
            const content = await fs.readFile(this.schedulesPath, 'utf8');
            const data = yaml.load(content) || { schedules: [] };

            const initialLength = data.schedules.length;
            data.schedules = data.schedules.filter(s => s.id !== scheduleId);

            if (data.schedules.length === initialLength) {
                throw new Error('Schedule not found');
            }

            await fs.writeFile(
                this.schedulesPath,
                yaml.dump(data, { indent: 2 })
            );

            // Stop all cron jobs tied to this schedule
            const prefix = `${scheduleId}-`;
            for (const jobKey of this.cronJobs.keys()) {
                if (jobKey === scheduleId || jobKey.startsWith(prefix)) {
                    this.stopCronJob(jobKey);
                }
            }

            console.log(`✓ Deleted schedule: ${scheduleId}`);
            return true;
        } catch (error) {
            console.error('Failed to delete schedule:', error);
            throw error;
        }
    }

    /**
     * Start a cron job for a backup
     */
    startCronJob(scheduleId, backupId, backupConfigPath, cronExpression) {
        // Stop existing job if any
        this.stopCronJob(`${scheduleId}-${backupId}`);

        const jobKey = `${scheduleId}-${backupId}`;
        
        console.log(`🕒 Starting cron job: ${jobKey} with expression: ${cronExpression}`);

        const job = cron.schedule(cronExpression, async () => {
            // Prevent overlapping backups
            if (this.runningBackups.has(backupId)) {
                console.log(`⏭️  Skipping backup ${backupId} - already running`);
                return;
            }

            this.runningBackups.add(backupId);
            console.log(`🚀 Executing backup: ${backupId}`);

            try {
                // Run the same execution path as manual runs so we:
                // - run create/prune/compact
                // - set BORG_PASSPHRASE from vault
                // - handle SSH password auth via SSHPASS/BORG_RSH
                // - emit SSE progress + update backup metadata
                const backupExecutor = require('./backup-executor');
                await backupExecutor.executeBackup(backupId);
                console.log(`✅ Scheduled backup completed: ${backupId}`);
            } catch (error) {
                console.error(`❌ Scheduled backup failed: ${backupId}`);
                console.error(error?.message || error);
            } finally {
                this.runningBackups.delete(backupId);
            }
        });

        this.cronJobs.set(jobKey, job);
        console.log(`✓ Cron job started: ${jobKey}`);
    }

    /**
     * Stop a cron job
     */
    stopCronJob(jobKey) {
        if (this.cronJobs.has(jobKey)) {
            this.cronJobs.get(jobKey).stop();
            this.cronJobs.delete(jobKey);
            console.log(`✓ Cron job stopped: ${jobKey}`);
        }
    }

    /**
     * Stop all cron jobs
     */
    stopAllCronJobs() {
        for (const [jobKey, job] of this.cronJobs.entries()) {
            job.stop();
            console.log(`✓ Stopped cron job: ${jobKey}`);
        }
        this.cronJobs.clear();
    }

    /**
     * Get active cron jobs
     */
    getActiveCronJobs() {
        return Array.from(this.cronJobs.keys());
    }

    /**
     * Get human-readable next run time for cron expression
     */
    getNextRunTime(cronExpression) {
        try {
            // Create a temporary cron job to get next run time
            const tempJob = cron.schedule(cronExpression, () => {}, { scheduled: false });
            // Note: node-cron doesn't provide next run time directly
            // We'll need to use a library like cron-parser for this
            return 'Scheduled'; // Placeholder
        } catch (error) {
            return 'Invalid';
        }
    }
}

module.exports = new ScheduleManager();
