const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const borgmaticCLI = require('../services/borgmatic-cli');
const borgmaticConfig = require('../services/borgmatic-config');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// In-memory job storage (in production, use Redis or database)
const backupJobs = new Map();

/**
 * Start a manual backup operation
 */
router.post('/start', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { repository, config_file, comment, stats, progress, list, json, dry_run } = req.body;
        
        // Generate unique job ID
        const jobId = uuidv4();
        
        // Create backup job record
        const backupJob = {
            id: jobId,
            repository: repository || 'default',
            config_file: config_file || null,
            comment: comment || null,
            stats: stats !== false,
            progress: progress !== false,
            list: list || false,
            json: json || false,
            dry_run: dry_run || false,
            status: 'running',
            started_at: new Date().toISOString(),
            completed_at: null,
            progress_percent: 0,
            error_message: null,
            logs: '',
            user_id: req.user.username
        };
        
        // Store job in memory
        backupJobs.set(jobId, backupJob);
        
        // Send initial progress update (if WebSocket is implemented)
        // TODO: Implement real-time events
        
        // Get repository passphrase if repository is specified
        let passphrase = null;
        if (repository) {
            try {
                // Get passphrase from borgmatic config
                const config = await borgmaticConfig.loadConfig();
                passphrase = config.storage?.encryption_passphrase || null;
            } catch (error) {
                console.warn('Could not retrieve passphrase:', error.message);
            }
        }
        
        // Execute backup asynchronously
        executeBackup(jobId, backupJob, passphrase);
        
        res.json({
            success: true,
            data: {
                job_id: jobId,
                status: 'running',
                message: 'Backup job started'
            }
        });
    } catch (error) {
        console.error('Failed to start backup:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to start backup' 
        });
    }
});

/**
 * Execute backup operation asynchronously
 */
async function executeBackup(jobId, backupJob, passphrase) {
    const job = backupJobs.get(jobId);
    if (!job) return;
    
    try {
        // Update job status
        job.status = 'running';
        job.progress_percent = 10;
        job.logs = 'Starting backup...\n';
        
        // Execute borgmatic create command with all options
        const result = await borgmaticCLI.createBackup({
            repository: backupJob.repository,
            config_file: backupJob.config_file,
            comment: backupJob.comment,
            stats: backupJob.stats,
            progress: backupJob.progress,
            list: backupJob.list,
            json: backupJob.json,
            dry_run: backupJob.dry_run,
            passphrase: passphrase
        });
        
        if (result.success) {
            job.status = 'completed';
            job.progress_percent = 100;
            job.completed_at = new Date().toISOString();
            job.logs += result.stdout || '';
            
            console.log(`Backup completed successfully for job ${jobId}`);
        } else {
            job.status = 'failed';
            job.progress_percent = 0;
            job.completed_at = new Date().toISOString();
            job.error_message = result.error || 'Unknown error';
            job.logs += result.stderr || '';
            
            console.error(`Backup failed for job ${jobId}:`, result.error);
        }
    } catch (error) {
        job.status = 'failed';
        job.progress_percent = 0;
        job.completed_at = new Date().toISOString();
        job.error_message = error.message;
        job.logs += `Error: ${error.message}\n`;
        
        console.error(`Backup error for job ${jobId}:`, error.message);
    }
    
    // Update job in storage
    backupJobs.set(jobId, job);
    
    // TODO: Send real-time update via WebSocket
}

/**
 * Get backup job status
 */
router.get('/status/:jobId', authenticateToken, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = backupJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({ 
                success: false,
                detail: 'Backup job not found' 
            });
        }
        
        res.json({
            success: true,
            data: {
                id: job.id,
                repository: job.repository,
                status: job.status,
                started_at: job.started_at,
                completed_at: job.completed_at,
                progress: job.progress_percent,
                error_message: job.error_message,
                logs: job.logs
            }
        });
    } catch (error) {
        console.error('Failed to get backup status:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to get backup status' 
        });
    }
});

/**
 * Cancel a running backup job
 */
router.delete('/cancel/:jobId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = backupJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({ 
                success: false,
                detail: 'Backup job not found' 
            });
        }
        
        if (job.status !== 'running') {
            return res.status(400).json({ 
                success: false,
                detail: 'Can only cancel running jobs' 
            });
        }
        
        // Update job status
        job.status = 'cancelled';
        job.completed_at = new Date().toISOString();
        job.logs += 'Backup cancelled by user\n';
        
        // TODO: Implement actual process cancellation
        // This would require tracking the child process and killing it
        
        backupJobs.set(jobId, job);
        
        console.log(`Backup cancelled for job ${jobId} by user ${req.user.username}`);
        
        res.json({
            success: true,
            data: {
                message: 'Backup cancelled successfully'
            }
        });
    } catch (error) {
        console.error('Failed to cancel backup:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to cancel backup' 
        });
    }
});

/**
 * Get backup job logs
 */
router.get('/logs/:jobId', authenticateToken, async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = backupJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({ 
                success: false,
                detail: 'Backup job not found' 
            });
        }
        
        res.json({
            success: true,
            data: {
                job_id: job.id,
                logs: job.logs || '',
                error_message: job.error_message || ''
            }
        });
    } catch (error) {
        console.error('Failed to get backup logs:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to get backup logs' 
        });
    }
});

/**
 * Get all backup jobs for the current user
 */
router.get('/jobs', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, status } = req.query;
        const userJobs = [];
        
        // Filter jobs by user and status
        for (const [jobId, job] of backupJobs.entries()) {
            if (job.user_id === req.user.username) {
                if (!status || job.status === status) {
                    userJobs.push({
                        id: job.id,
                        repository: job.repository,
                        status: job.status,
                        started_at: job.started_at,
                        completed_at: job.completed_at,
                        progress: job.progress_percent
                    });
                }
            }
        }
        
        // Sort by started_at descending
        userJobs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
        
        // Apply limit
        const limitedJobs = userJobs.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            data: {
                jobs: limitedJobs,
                total: userJobs.length
            }
        });
    } catch (error) {
        console.error('Failed to get backup jobs:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to get backup jobs' 
        });
    }
});

/**
 * Get backup statistics
 */
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const userJobs = [];
        
        // Get all jobs for the current user
        for (const [jobId, job] of backupJobs.entries()) {
            if (job.user_id === req.user.username) {
                userJobs.push(job);
            }
        }
        
        // Calculate statistics
        const stats = {
            total_jobs: userJobs.length,
            completed_jobs: userJobs.filter(job => job.status === 'completed').length,
            failed_jobs: userJobs.filter(job => job.status === 'failed').length,
            running_jobs: userJobs.filter(job => job.status === 'running').length,
            cancelled_jobs: userJobs.filter(job => job.status === 'cancelled').length
        };
        
        // Calculate success rate
        const finishedJobs = stats.completed_jobs + stats.failed_jobs;
        stats.success_rate = finishedJobs > 0 ? (stats.completed_jobs / finishedJobs) * 100 : 0;
        
        // Get recent activity (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentJobs = userJobs.filter(job => new Date(job.started_at) > oneDayAgo);
        stats.recent_jobs = recentJobs.length;
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Failed to get backup stats:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to get backup statistics' 
        });
    }
});

/**
 * Clean up old completed jobs (maintenance endpoint)
 */
router.post('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { olderThanDays = 30 } = req.body;
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
        let cleanedCount = 0;
        
        // Clean up old completed/failed/cancelled jobs
        for (const [jobId, job] of backupJobs.entries()) {
            if (job.status !== 'running' && new Date(job.started_at) < cutoffDate) {
                backupJobs.delete(jobId);
                cleanedCount++;
            }
        }
        
        res.json({
            success: true,
            data: {
                message: `Cleaned up ${cleanedCount} old backup jobs`,
                cleaned_count: cleanedCount
            }
        });
    } catch (error) {
        console.error('Failed to cleanup backup jobs:', error.message);
        res.status(500).json({ 
            success: false,
            detail: 'Failed to cleanup backup jobs' 
        });
    }
});

module.exports = router;