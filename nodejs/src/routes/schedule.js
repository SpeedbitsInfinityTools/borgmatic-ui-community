const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const scheduleManager = require('../services/schedule-manager');

/**
 * Get all schedules
 * GET /api/schedule
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const schedules = await scheduleManager.getAllSchedules();
        
        res.json({
            success: true,
            data: { schedules }
        });
    } catch (error) {
        console.error('Failed to get schedules:', error.message);
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

/**
 * Get a specific schedule
 * GET /api/schedule/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const schedule = await scheduleManager.getSchedule(req.params.id);
        
        if (!schedule) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }

        res.json({
            success: true,
            data: schedule
        });
    } catch (error) {
        console.error('Failed to get schedule:', error.message);
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

/**
 * Create a new schedule
 * POST /api/schedule
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, cron_expression, description, enabled } = req.body;

        if (!name || !cron_expression) {
            return res.status(400).json({ 
                success: false,
                error: 'Name and cron expression are required' 
            });
        }

        const schedule = await scheduleManager.createSchedule({
            name,
            cron_expression,
            description,
            enabled
        });
        
        res.status(201).json({
            success: true,
            message: 'Schedule created successfully',
            data: schedule
        });
    } catch (error) {
        console.error('Failed to create schedule:', error.message);
        const status = error.message.includes('Invalid cron') ? 400 : 500;
        res.status(status).json({ 
            success: false,
            error: error.message
        });
    }
});

/**
 * Update a schedule
 * PUT /api/schedule/:id
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const schedule = await scheduleManager.updateSchedule(req.params.id, req.body);

        res.json({
            success: true,
            message: 'Schedule updated successfully',
            data: schedule
        });
    } catch (error) {
        console.error('Failed to update schedule:', error.message);
        const status = error.message.includes('not found') ? 404 :
                      error.message.includes('Invalid cron') ? 400 : 500;
        res.status(status).json({ 
            success: false,
            error: error.message
        });
    }
});

/**
 * Delete a schedule
 * DELETE /api/schedule/:id
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await scheduleManager.deleteSchedule(req.params.id);

        res.json({
            success: true,
            message: 'Schedule deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete schedule:', error.message);
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ 
            success: false,
            error: error.message
        });
    }
});

module.exports = router;