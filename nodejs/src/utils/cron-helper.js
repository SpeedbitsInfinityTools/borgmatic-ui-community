const cron = require('node-cron');

/**
 * Calculate the next run time for a cron expression
 * @param {string} cronExpression - Cron expression (e.g., "0 2 * * *")
 * @returns {Date|null} - Next execution date or null if invalid
 */
function getNextRunTime(cronExpression) {
    if (!cronExpression) return null;
    
    try {
        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            return null;
        }

        // Parse cron expression
        const parts = cronExpression.trim().split(/\s+/);
        if (parts.length < 5) return null;

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

        const now = new Date();
        let next = new Date(now);
        next.setSeconds(0);
        next.setMilliseconds(0);

        // Simple calculation for common cases
        // For minute
        if (minute !== '*') {
            const targetMinute = parseInt(minute);
            next.setMinutes(targetMinute);
            if (next <= now) {
                next.setHours(next.getHours() + 1);
            }
        }

        // For hour
        if (hour !== '*') {
            const targetHour = parseInt(hour);
            next.setHours(targetHour);
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
        }

        // For simple daily jobs (most common case)
        if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            // Daily job - just set to next occurrence of the time
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
        }

        // For weekly jobs
        if (dayOfWeek !== '*' && dayOfMonth === '*') {
            const targetDay = parseInt(dayOfWeek);
            const currentDay = next.getDay();
            let daysUntil = targetDay - currentDay;
            if (daysUntil <= 0) {
                daysUntil += 7;
            }
            next.setDate(next.getDate() + daysUntil);
        }

        return next;
    } catch (error) {
        console.error('Error calculating next run time:', error);
        return null;
    }
}

/**
 * Format next run time for display
 * @param {string} cronExpression - Cron expression
 * @returns {string} - Formatted next run time
 */
function formatNextRunTime(cronExpression) {
    const nextRun = getNextRunTime(cronExpression);
    if (!nextRun) return 'Unable to calculate';
    
    const now = new Date();
    const diff = nextRun.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours < 1) {
        return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else if (hours < 24) {
        return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
        const days = Math.floor(hours / 24);
        return `in ${days} day${days !== 1 ? 's' : ''}`;
    }
}

module.exports = {
    getNextRunTime,
    formatNextRunTime
};
