function shellSingleQuote(value) {
    // Safe single-quote escaping for POSIX shells: ' -> '"'"'
    const s = String(value ?? '');
    return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function isSafeRemotePath(remotePath) {
    if (typeof remotePath !== 'string' || remotePath.length === 0) return false;
    if (!remotePath.startsWith('/')) return false;
    if (remotePath.includes('..')) return false;
    if (remotePath.includes('\0') || remotePath.includes('\n') || remotePath.includes('\r')) return false;
    // Keep it intentionally conservative because this is executed via remote shell.
    // Allow typical absolute paths only.
    return /^\/[A-Za-z0-9._\-\/]+$/.test(remotePath);
}

async function testLogFileWrite(logFilePath) {
    const fs = require('fs-extra');
    const path = require('path');

    if (!logFilePath || !logFilePath.trim()) {
        return { success: true }; // No log file specified, skip check
    }

    try {
        const normalizedPath = logFilePath.trim();
        const logDir = path.dirname(normalizedPath);

        // Ensure directory exists
        await fs.ensureDir(logDir);

        // Try to write a test entry to the log file
        const testContent = `# Borgmatic UI log file test - ${new Date().toISOString()}\n`;
        await fs.appendFile(normalizedPath, testContent);

        // If we get here, write was successful
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `Cannot write to log file "${logFilePath}": ${error.message}. Please check file permissions or choose a different path.`
        };
    }
}

module.exports = {
    shellSingleQuote,
    isSafeRemotePath,
    testLogFileWrite
};
